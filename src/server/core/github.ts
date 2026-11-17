import { AppError } from './errors';

export const GITHUB_TOKEN_URL = 'https://github.com/settings/personal-access-tokens';

export interface GitHubTokenInfo {
  login: string | null;
  scopes: string[];
  tokenType: 'classic' | 'fine-grained';
}

// Classic PATs expose their scopes in `x-oauth-scopes`. Only accept the
// read-only scopes needed for identity/org discovery; anything else could
// grant write access somewhere. Fine-grained PATs do not expose their
// permissions to the token itself, so they are accepted after a read probe.
const SAFE_CLASSIC_SCOPES = new Set([
  'read:user',
  'user:email',
  'read:org',
  'read:public_key',
  'read:gpg_key',
  'read:ssh_signing_key',
  'read:packages',
  'read:project',
  'read:discussion',
  'read:audit_log',
  'read:repo_hook',
  'read:enterprise',
  'notifications',
]);

function headers(token: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'Loom/0.1',
    authorization: `Bearer ${token}`,
  };
}

async function call(apiBase: string, path: string, token: string): Promise<Response> {
  try {
    return await fetch(`${apiBase.replace(/\/+$/, '')}${path}`, {
      headers: headers(token),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new AppError(
      'provider_error',
      `Could not reach GitHub to validate the token: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Verify that a GitHub token is usable and that it does not advertise
 * write-capable classic scopes. Throws AppError when it should be rejected.
 */
export async function inspectGitHubToken(apiBase: string, token: string): Promise<GitHubTokenInfo> {
  const trimmed = token.trim();
  if (!trimmed) throw new AppError('bad_request', 'Enter a GitHub token.');

  let response = await call(apiBase, '/user', trimmed);
  let login: string | null = null;

  if (response.status === 401) {
    throw new AppError('bad_request', 'GitHub rejected this token. Check that it is valid and not expired.');
  }
  if (response.ok) {
    const profile = (await response.json()) as { login?: string };
    login = profile.login ?? null;
  } else {
    // A valid fine-grained token with very narrow permissions can still be
    // checked against an endpoint that requires no repository permission.
    const fallback = await call(apiBase, '/rate_limit', trimmed);
    if (!fallback.ok) {
      throw new AppError(
        'bad_request',
        `GitHub rejected this token (HTTP ${response.status}). Check its permissions and expiration.`,
      );
    }
    response = fallback;
  }

  const scopeHeader = response.headers.get('x-oauth-scopes');
  const scopes = (scopeHeader ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
  const tokenType: GitHubTokenInfo['tokenType'] = scopeHeader === null ? 'fine-grained' : 'classic';
  const unsafe = scopes.filter((scope) => !SAFE_CLASSIC_SCOPES.has(scope));

  if (unsafe.length) {
    throw new AppError(
      'bad_request',
      `This token has write-capable scopes (${unsafe.join(', ')}). Create a fine-grained read-only token with only Contents: Read and Metadata: Read at ${GITHUB_TOKEN_URL}`,
    );
  }

  return { login, scopes, tokenType };
}
