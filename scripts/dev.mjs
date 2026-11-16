import { spawn } from 'node:child_process';

const env = { ...process.env, LOOM_DEV_WEB_URL: process.env.LOOM_DEV_WEB_URL ?? 'http://localhost:5173' };

const server = spawn('npm', ['run', 'dev:server'], { stdio: 'inherit', env });
const web = spawn('npm', ['run', 'dev:web'], { stdio: 'inherit', env });
let stopping = false;

function stop(signal) {
  if (stopping) return;
  stopping = true;
  server.kill(signal);
  web.kill(signal);
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
server.on('exit', (code) => {
  if (!stopping && code) stop('SIGTERM');
});
web.on('exit', (code) => {
  if (!stopping && code) stop('SIGTERM');
});
