import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 26-char Crockford base32 ULID: 10 chars of time + 16 chars of randomness. */
export function ulid(now = Date.now()): string {
  let time = Math.floor(now);
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = ALPHABET[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  const bytes = randomBytes(16);
  let randomPart = '';
  for (let i = 0; i < 16; i++) {
    randomPart += ALPHABET[(bytes[i] ?? 0) % 32];
  }
  return timePart + randomPart;
}

export function newId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

export const ID_PREFIXES = {
  user: 'usr',
  project: 'prj',
  column: 'col',
  object: 'obj',
  note: 'note',
  noteVersion: 'ver',
  block: 'blk',
  task: 'tsk',
  reference: 'ref',
  experiment: 'exp',
  question: 'que',
  inbox: 'inb',
  tag: 'tag',
  link: 'lnk',
  event: 'evt',
  job: 'job',
  digest: 'dgt',
  revision: 'rev',
  chunk: 'chk',
  backup: 'bkp',
  attachment: 'att',
  bookmark: 'bkm',
  conversation: 'cnv',
  message: 'msg',
  provider: 'aip',
  session: 'ses',
  request: 'req',
} as const;
