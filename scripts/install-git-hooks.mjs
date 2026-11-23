import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runGit = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
const existing = runGit(['config', '--get', 'core.hooksPath']);

if (existing.status === 0 && existing.stdout.trim() !== '.githooks') {
  console.warn(
    `Loom did not replace the existing Git hook path (${existing.stdout.trim()}). Set core.hooksPath to .githooks to enable version bumps.`,
  );
  process.exit(0);
}

const configured = runGit(['config', 'core.hooksPath', '.githooks']);
if (configured.status !== 0) {
  console.warn('Git hooks were not installed (this may not be a Git checkout).');
  process.exit(0);
}
console.log('Installed Loom Git hooks (.githooks).');
