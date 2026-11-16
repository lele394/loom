import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import { newId } from '../../core/ids';
import {
  constantTimeEqual,
  dummyPasswordCheck,
  hashPassword,
  randomToken,
  sha256,
  verifyPassword,
} from '../../core/crypto';
import { AppError, notFound } from '../../core/errors';
import { isIanaTimeZone } from '../../core/time';
import type { PublicUser } from '../../../shared/types';

export interface SessionRecord {
  id: string;
  userId: string;
  csrfToken: string;
  expiresAt: string;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  is_admin: number;
  timezone: string;
  created_at: string;
  updated_at: string;
}

function mapUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    timezone: row.timezone,
    isAdmin: row.is_admin === 1,
  };
}

const SESSION_DAYS = 30;
const DENY_PASSWORDS = new Set(['password123', '1234567890', 'qwertyuiop', 'password1234']);

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  setupRequired(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    return row.count === 0;
  }

  userCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count;
  }

  findUser(id: string): PublicUser {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    if (!row) throw notFound('User');
    return mapUser(row);
  }

  private validatePassword(password: string, username: string): void {
    if (password.length < 10) throw new AppError('bad_request', 'Use at least 10 characters for the password.');
    if (password.toLowerCase().includes(username.toLowerCase())) {
      throw new AppError('bad_request', 'The password must not contain the username.');
    }
    if (DENY_PASSWORDS.has(password.toLowerCase())) {
      throw new AppError('bad_request', 'That password is too common.');
    }
  }

  setup(input: {
    username: string;
    password: string;
    displayName?: string;
    timezone?: string;
  }): { user: PublicUser; token: string } {
    if (!this.setupRequired()) throw new AppError('setup_complete');
    const username = input.username.trim();
    this.validatePassword(input.password, username);
    const timezone = input.timezone && isIanaTimeZone(input.timezone) ? input.timezone : 'UTC';
    const now = this.clock.iso();
    const id = newId('usr');
    const hash = hashPassword(input.password);
    const tx = this.db.transaction(() => {
      const count = this.userCount();
      if (count > 0) throw new AppError('setup_complete');
      this.db
        .prepare(
          `INSERT INTO users (id, username, display_name, password_hash, is_admin, timezone, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .run(id, username, input.displayName?.trim() || username, hash, timezone, now, now);
    });
    tx();
    const token = this.createSession(id, {});
    return { user: this.findUser(id), token };
  }

  login(
    username: string,
    password: string,
    meta: { ip?: string; userAgent?: string },
  ): { user: PublicUser; token: string } {
    const row = this.db
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
      .get(username.trim()) as UserRow | undefined;
    if (!row) {
      dummyPasswordCheck(password);
      throw new AppError('unauthenticated', 'Invalid username or password.');
    }
    if (!verifyPassword(password, row.password_hash)) {
      throw new AppError('unauthenticated', 'Invalid username or password.');
    }
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(this.clock.iso());
    const token = this.createSession(row.id, meta);
    return { user: mapUser(row), token };
  }

  createSession(userId: string, meta: { ip?: string; userAgent?: string }): string {
    const token = randomToken(32);
    const now = this.clock.now();
    const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, csrf_token, created_at, expires_at, last_seen_at, user_agent, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId('ses'),
        userId,
        sha256(token),
        randomToken(24),
        now.toISOString(),
        expires.toISOString(),
        now.toISOString(),
        meta.userAgent?.slice(0, 300) ?? null,
        meta.ip?.slice(0, 80) ?? null,
      );
    return token;
  }

  session(token: string | undefined): SessionRecord | null {
    if (!token) return null;
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE token_hash = ?')
      .get(sha256(token)) as
      | {
          id: string;
          user_id: string;
          csrf_token: string;
          expires_at: string;
          last_seen_at: string;
        }
      | undefined;
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < this.clock.now().getTime()) {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
      return null;
    }
    const lastSeen = new Date(row.last_seen_at).getTime();
    if (this.clock.now().getTime() - lastSeen > 5 * 60_000) {
      this.db
        .prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
        .run(this.clock.iso(), row.id);
    }
    return { id: row.id, userId: row.user_id, csrfToken: row.csrf_token, expiresAt: row.expires_at };
  }

  userForSession(session: SessionRecord): PublicUser {
    return this.findUser(session.userId);
  }

  csrfMatches(session: SessionRecord, provided: string | undefined): boolean {
    if (!provided) return false;
    return constantTimeEqual(session.csrfToken, provided);
  }

  logout(token: string | undefined): void {
    if (!token) return;
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }

  logoutAll(userId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    keepSessionId: string,
  ): void {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (!row) throw notFound('User');
    if (!verifyPassword(currentPassword, row.password_hash)) {
      throw new AppError('unauthenticated', 'Current password is incorrect.');
    }
    this.validatePassword(newPassword, row.username);
    const hash = hashPassword(newPassword);
    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
        .run(hash, this.clock.iso(), userId);
      this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, keepSessionId);
    });
    tx();
  }

  updateProfile(userId: string, patch: { displayName?: string; timezone?: string }): PublicUser {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (!row) throw notFound('User');
    if (patch.timezone && !isIanaTimeZone(patch.timezone)) {
      throw new AppError('bad_request', 'Unknown timezone.');
    }
    this.db
      .prepare('UPDATE users SET display_name = ?, timezone = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.displayName?.trim() || row.display_name,
        patch.timezone ?? row.timezone,
        this.clock.iso(),
        userId,
      );
    return this.findUser(userId);
  }

  pruneExpired(): number {
    return this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(this.clock.iso()).changes;
  }
}
