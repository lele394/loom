export interface LatestLoomVersion {
  version: string;
  commitSha: string;
  commitUrl: string;
  committedAt: string | null;
}

interface GithubCommit {
  sha: string;
  html_url?: string;
  commit?: {
    author?: { date?: string };
    committer?: { date?: string };
  };
}

let cached: { value: LatestLoomVersion; expiresAt: number } | null = null;
let pending: Promise<LatestLoomVersion> | null = null;

function validVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
}

async function fetchLatestVersion(): Promise<LatestLoomVersion> {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'Loom-version-check',
  };
  const commitResponse = await fetch(
    'https://api.github.com/repos/lele394/loom/commits?per_page=1',
    { headers, signal: AbortSignal.timeout(12_000) },
  );
  if (!commitResponse.ok) {
    throw new Error(`GitHub returned HTTP ${commitResponse.status} while checking the latest commit.`);
  }
  const commits = (await commitResponse.json()) as GithubCommit[];
  const latest = commits[0];
  if (!latest?.sha) throw new Error('GitHub did not return the latest repository commit.');

  const packageResponse = await fetch(
    `https://raw.githubusercontent.com/lele394/loom/${encodeURIComponent(latest.sha)}/package.json`,
    { signal: AbortSignal.timeout(12_000) },
  );
  if (!packageResponse.ok) {
    throw new Error(`Could not read package.json at the latest commit (HTTP ${packageResponse.status}).`);
  }
  const packageJson = (await packageResponse.json()) as { version?: unknown };
  if (!validVersion(packageJson.version)) {
    throw new Error('The repository package.json does not contain a major.minor.commit version.');
  }
  return {
    version: packageJson.version,
    commitSha: latest.sha,
    commitUrl: latest.html_url ?? `https://github.com/lele394/loom/commit/${latest.sha}`,
    committedAt: latest.commit?.committer?.date ?? latest.commit?.author?.date ?? null,
  };
}

export function latestLoomVersion(force = false): Promise<LatestLoomVersion> {
  if (force) cached = null;
  if (!force && cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  if (pending) return pending;
  pending = fetchLatestVersion()
    .then((value) => {
      cached = { value, expiresAt: Date.now() + 5 * 60_000 };
      return value;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
