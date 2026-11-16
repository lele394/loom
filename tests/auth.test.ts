import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, TEST_PASSWORD, type TestHarness } from './helpers';

let harness: TestHarness;
beforeEach(async () => {
  harness = await createTestHarness();
});
afterEach(async () => {
  await harness.cleanup();
});

describe('auth and CSRF', () => {
  it('sets security headers and no-store on API responses', async () => {
    const health = await harness.app.inject({ method: 'GET', url: '/healthz' });
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(String(health.headers['content-security-policy'])).toContain("default-src 'self'");
    const meta = await harness.request('GET', '/meta');
    expect(meta.headers['cache-control']).toBe('no-store');
    expect(meta.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('reports setup completion and keeps a session', async () => {
    const session = await harness.request('GET', '/auth/session');
    expect(session.status).toBe(200);
    expect(session.body.setupRequired).toBe(false);
    expect(session.body.user.username).toBe('tester');
    expect(session.body.csrfToken).toBeTruthy();
  });

  it('rejects unsafe requests without a CSRF header', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: harness.cookieHeader(), 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'No CSRF' }),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('csrf_invalid');
  });

  it('rejects writes with a bad CSRF token', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: harness.cookieHeader(), 'x-csrf-token': 'wrong', 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Bad token' }),
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects unauthenticated API reads', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/projects' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a wrong password and accepts the right one', async () => {
    const wrong = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'tester', password: 'definitely-not-it' },
    });
    expect(wrong.statusCode).toBe(401);
    const right = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'tester', password: TEST_PASSWORD },
    });
    expect(right.statusCode).toBe(200);
  });

  it('accepts login from a local dev frontend on another port', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://localhost:5173' },
      payload: { username: 'tester', password: TEST_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
  });

  it('accepts login when Origin matches the request host', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://loom.local:8787', host: 'loom.local:8787' },
      payload: { username: 'tester', password: TEST_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
  });

  it('rejects a foreign Origin on login', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { username: 'tester', password: TEST_PASSWORD },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('csrf_invalid');
  });

  it('rejects a literal null Origin', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'null' },
      payload: { username: 'tester', password: TEST_PASSWORD },
    });
    expect(response.statusCode).toBe(403);
  });

  it('keeps production strict about loopback ports unless allowed', async () => {
    const prod = await createTestHarness({ username: 'produser', env: 'production' });
    try {
      const otherPort = await prod.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: 'http://localhost:5173' },
        payload: { username: 'produser', password: TEST_PASSWORD },
      });
      expect(otherPort.statusCode).toBe(403);
      const anotherHost = await prod.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: 'http://localhost:8787', host: 'localhost:8787' },
        payload: { username: 'produser', password: TEST_PASSWORD },
      });
      expect(anotherHost.statusCode).toBe(200);
    } finally {
      await prod.cleanup();
    }
  });

  it('honours x-forwarded-host from a trusted proxy', async () => {
    const proxied = await createTestHarness({ username: 'proxyuser', env: 'production', trustProxy: true });
    try {
      const response = await proxied.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: {
          origin: 'https://loom.example.com',
          host: '127.0.0.1:8787',
          'x-forwarded-host': 'loom.example.com',
        },
        payload: { username: 'proxyuser', password: TEST_PASSWORD },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await proxied.cleanup();
    }
  });

  it('refuses a second setup', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { username: 'another', password: 'another-password-1' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('setup_complete');
  });

  it('changes the password and invalidates other sessions', async () => {
    const other = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'tester', password: TEST_PASSWORD },
    });
    const otherCookie = other.cookies.find((cookie) => cookie.name === 'loom_session')!.value;
    const change = await harness.request('POST', '/auth/password', {
      currentPassword: TEST_PASSWORD,
      newPassword: 'new-test-password-456',
    });
    expect(change.status).toBe(200);
    const oldSession = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/meta',
      headers: { cookie: `loom_session=${otherCookie}` },
    });
    expect(oldSession.statusCode).toBe(401);
    const login = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'tester', password: 'new-test-password-456' },
    });
    expect(login.statusCode).toBe(200);
  });
});
