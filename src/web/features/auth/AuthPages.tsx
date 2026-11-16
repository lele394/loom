import { useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { useSession } from '../../app/session';
import type { PublicUser } from '../../../shared/types';

export function AuthPage({ mode }: { mode: 'login' | 'setup' }) {
  const { refresh, logoLabel } = useSession();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [timezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  });
  const [starterProject, setStarterProject] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (mode === 'setup' && password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'setup') {
        await api.post<{ user: PublicUser }>('/auth/setup', {
          username,
          password,
          displayName,
          timezone,
          starterProject,
        });
      } else {
        await api.post<{ user: PublicUser }>('/auth/login', { username, password });
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <span
            className="mark"
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: 'var(--accent)',
              color: 'var(--accent-contrast)',
              display: 'grid',
              placeItems: 'center',
              fontSize: 18,
            }}
          >
            ◫
          </span>
          {logoLabel}
        </div>
        <h1>{mode === 'setup' ? 'Create your research workspace' : 'Welcome back'}</h1>
        <p className="sub">
          {mode === 'setup'
            ? 'One account, running on your machine. Your notes and files stay in your data directory.'
            : 'Sign in to your private research OS.'}
        </p>
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <label className="field">
            <span className="label">Username</span>
            <input
              className="input"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          {mode === 'setup' ? (
            <label className="field">
              <span className="label">Display name</span>
              <input
                className="input"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="How should Loom greet you?"
              />
            </label>
          ) : null}
          <label className="field">
            <span className="label">Password</span>
            <input
              className="input"
              type="password"
              autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={mode === 'setup' ? 10 : 1}
              required
            />
            {mode === 'setup' ? <span className="help">At least 10 characters. Use a password manager.</span> : null}
          </label>
          {mode === 'setup' ? (
            <>
              <label className="field">
                <span className="label">Confirm password</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  required
                />
              </label>
              <div className="field">
                <span className="label">Timezone</span>
                <div className="input" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                  {timezone}
                </div>
                <span className="help">Used for daily journal dates. You can change it later.</span>
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={starterProject}
                  onChange={(event) => setStarterProject(event.target.checked)}
                />
                Create a starter project with a board
              </label>
            </>
          ) : null}
          {error ? <div className="error-text" role="alert">{error}</div> : null}
          <button className="btn primary" style={{ padding: '10px 14px' }} disabled={busy} type="submit">
            {busy ? 'Please wait…' : mode === 'setup' ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <div className="auth-foot">
          {mode === 'setup'
            ? 'Your password is hashed locally with scrypt. There is no cloud account.'
            : 'This instance is local. If you forgot your password, run npm run reset-password on the server.'}
        </div>
      </div>
    </div>
  );
}
