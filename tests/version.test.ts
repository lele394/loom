import { afterEach, describe, expect, it, vi } from 'vitest';
import { latestLoomVersion } from '../src/server/core/version';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GitHub version check', () => {
  it('reads the latest commit version from package.json at that commit', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              sha: 'abcdef1234567',
              html_url: 'https://github.com/lele394/loom/commit/abcdef1234567',
              commit: { committer: { date: '2026-11-23T12:00:00Z' } },
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version: '0.2.8' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(latestLoomVersion(true)).resolves.toEqual({
      version: '0.2.8',
      commitSha: 'abcdef1234567',
      commitUrl: 'https://github.com/lele394/loom/commit/abcdef1234567',
      committedAt: '2026-11-23T12:00:00Z',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an invalid remote package version', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ sha: 'abcdef1234567' }]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version: 'next' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(latestLoomVersion(true)).rejects.toThrow(
      'does not contain a major.minor.commit version',
    );
  });
});
