import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Ctx } from '../ctx';
import { AppError } from '../core/errors';
import { constantTimeEqual } from '../core/crypto';
import { API_PREFIX } from '../../shared/constants';

export const SESSION_COOKIE = 'loom_session';
export const CSRF_COOKIE = 'loom_csrf';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const PUBLIC_PATHS = new Set([
  `${API_PREFIX}/auth/session`,
  `${API_PREFIX}/auth/setup`,
  `${API_PREFIX}/auth/login`,
]);

export function isPublicApiPath(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return PUBLIC_PATHS.has(path);
}

export function setSessionCookies(
  ctx: Ctx,
  reply: FastifyReply,
  token: string,
  csrfToken: string,
): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.secureCookies,
    maxAge: MAX_AGE_SECONDS,
  });
  reply.setCookie(CSRF_COOKIE, csrfToken, {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure: ctx.config.secureCookies,
    maxAge: MAX_AGE_SECONDS,
  });
}

export function clearSessionCookies(ctx: Ctx, reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function headerHost(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const first = raw.split(',')[0]?.trim().toLowerCase();
  return first || null;
}

/** Hosts the browser may legitimately be talking to (Host plus proxy forwarding). */
function requestHosts(ctx: Ctx, request: FastifyRequest): string[] {
  const hosts = new Set<string>();
  const host = headerHost(request.headers.host);
  if (host) hosts.add(host);
  if (ctx.config.trustProxy) {
    const forwarded = headerHost(request.headers['x-forwarded-host']);
    if (forwarded) hosts.add(forwarded);
  }
  return [...hosts];
}

export function originAllowed(ctx: Ctx, request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  // Non-browser clients (curl, tests, CLIs) do not send Origin; CSRF tokens still apply.
  if (!origin) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    // Includes the literal "null" origin used by sandboxed documents and file:// pages.
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const host = parsed.host.toLowerCase();
  if (requestHosts(ctx, request).includes(host)) return true;

  // Development servers may pick another port (5174, 4173, …) or use 127.0.0.1
  // while the browser says localhost. Only relax this outside production.
  if (ctx.config.env !== 'production' && LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
    return true;
  }

  return ctx.config.allowedOrigins.some((allowed) => {
    try {
      return new URL(allowed).host.toLowerCase() === host;
    } catch {
      return allowed === origin;
    }
  });
}

export function installAuthGuard(app: FastifyInstance, ctx: Ctx): void {
  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);

    if (unsafe && !originAllowed(ctx, request)) {
      request.log.warn(
        {
          origin: request.headers.origin,
          host: request.headers.host,
          forwardedHost: request.headers['x-forwarded-host'],
          allowedOrigins: ctx.config.allowedOrigins,
          trustProxy: ctx.config.trustProxy,
        },
        'rejected cross-origin write',
      );
      throw new AppError(
        'csrf_invalid',
        'Cross-origin request rejected. Use the same host and port as the server, or set LOOM_ALLOWED_ORIGIN.',
        { origin: request.headers.origin ?? null },
      );
    }
    if (isPublicApiPath(request.url)) return;

    if (ctx.maintenance.restoring && unsafe) {
      throw new AppError('restore_in_progress');
    }

    const token = request.cookies[SESSION_COOKIE];
    const session = ctx.services.auth?.session(token);
    if (!session) throw new AppError('unauthenticated');
    const user = ctx.services.auth.userForSession(session);
    request.user = user;
    request.sessionId = session.id;
    request.csrfToken = session.csrfToken;

    if (unsafe) {
      const provided = request.headers['x-csrf-token'];
      const value = Array.isArray(provided) ? provided[0] : provided;
      if (!value || !constantTimeEqual(session.csrfToken, value)) {
        throw new AppError('csrf_invalid');
      }
    }
  });
}
