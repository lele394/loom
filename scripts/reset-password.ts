import { randomBytes } from 'node:crypto';
import { loadConfig, loadDotEnv } from '../src/server/config';
import { openDatabase } from '../src/server/db';
import { runMigrations } from '../src/server/db/migrate';
import { hashPassword } from '../src/server/core/crypto';

loadDotEnv();
const config = loadConfig();
const db = openDatabase(config.dbPath);
runMigrations(db);

const username = process.argv[2] ?? process.env.LOOM_USERNAME;
if (!username) {
  const users = db.prepare('SELECT username FROM users').all() as { username: string }[];
  console.error('Usage: npm run reset-password -- <username>');
  console.error('Existing users:', users.map((user) => user.username).join(', ') || '(none — run setup in the browser)');
  db.close();
  process.exit(1);
}

const user = db.prepare('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE').get(username) as
  | { id: string; username: string }
  | undefined;
if (!user) {
  console.error(`No user named "${username}".`);
  db.close();
  process.exit(1);
}

let password = process.argv[3] ?? process.env.LOOM_NEW_PASSWORD;
let generated = false;
if (!password) {
  password = randomBytes(15).toString('base64url');
  generated = true;
}
if (password.length < 10) {
  console.error('The new password must be at least 10 characters.');
  db.close();
  process.exit(1);
}
if (password.toLowerCase().includes(user.username.toLowerCase())) {
  console.error('The password must not contain the username.');
  db.close();
  process.exit(1);
}

const now = new Date().toISOString();
const tx = db.transaction(() => {
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(password),
    now,
    user.id,
  );
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
});
tx();
db.close();

console.log(`Password reset for "${user.username}". All sessions were signed out.`);
if (generated) console.log(`New password: ${password}`);
console.log('Store it in your password manager now; it will not be shown again.');
