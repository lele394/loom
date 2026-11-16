import { loadDotEnv } from '../src/server/config';
import { closeContext, createContext } from '../src/server/ctx';

loadDotEnv();
const ctx = await createContext();
const user = ctx.db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as
  | { id: string }
  | undefined;
if (!user) {
  console.error('No account exists yet. Complete setup in the browser first.');
  closeContext(ctx);
  process.exit(1);
}
const kind = process.argv[2] === 'auto' ? 'auto' : 'manual';
try {
  const backup = await ctx.services.backup.create(kind, user.id);
  console.log(`Backup created: ${ctx.services.backup.filePath(backup)}`);
  console.log(`Size: ${backup.size} bytes · checksum: ${backup.checksum}`);
} finally {
  closeContext(ctx);
}
