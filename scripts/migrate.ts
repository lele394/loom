import { loadDotEnv } from '../src/server/config';
import { closeContext, createContext } from '../src/server/ctx';

loadDotEnv();
const ctx = await createContext();
const version = ctx.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
  version: number | null;
};
console.log(`Database is at schema version ${version.version ?? 0}. Migrations applied.`);
closeContext(ctx);
