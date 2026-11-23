import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const packagePath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(packageJson.version ?? '');

if (!match) {
  throw new Error(`Expected package.json version to be major.minor.commit, got "${packageJson.version}".`);
}

let historyCount = 0;
try {
  historyCount = Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim());
} catch {
  // The first commit in a new repository has no HEAD yet.
}

const [, major, minor, currentCommit] = match;
const expectedForNextCommit = historyCount + 1;
// Keeping a version already calculated for this HEAD makes retries and
// `git commit --amend` idempotent; a larger manual counter remains monotonic.
const nextCommit = Number(currentCommit) === expectedForNextCommit
  ? Number(currentCommit)
  : Math.max(expectedForNextCommit, Number(currentCommit) + 1);
const nextVersion = `${major}.${minor}.${nextCommit}`;

if (packageJson.version !== nextVersion) {
  packageJson.version = nextVersion;
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const lockJson = JSON.parse(readFileSync(lockPath, 'utf8'));
  lockJson.version = nextVersion;
  if (lockJson.packages?.['']) lockJson.packages[''].version = nextVersion;
  writeFileSync(lockPath, `${JSON.stringify(lockJson, null, 2)}\n`);
}

const staged = spawnSync('git', ['add', '--', 'package.json', 'package-lock.json'], {
  cwd: root,
  stdio: 'inherit',
});
if (staged.status !== 0) {
  throw new Error('Could not stage the automatically updated package version.');
}

console.log(`Loom version for this commit: ${nextVersion}`);
