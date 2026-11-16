export interface Clock {
  now(): Date;
  iso(): string;
}

export const systemClock: Clock = {
  now: () => new Date(),
  iso: () => new Date().toISOString(),
};

export function fixedClock(at: string | Date): Clock {
  const date = typeof at === 'string' ? new Date(at) : new Date(at.getTime());
  return {
    now: () => new Date(date.getTime()),
    iso: () => date.toISOString(),
  };
}

/** Advanceable clock for tests. */
export function mutableClock(at: string | Date = new Date()): Clock & { advance(ms: number): void } {
  let current = typeof at === 'string' ? new Date(at) : new Date(at.getTime());
  return {
    now: () => new Date(current.getTime()),
    iso: () => current.toISOString(),
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
  };
}
