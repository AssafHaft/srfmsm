import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncError, fingerprint, fromBase64, normalizeSyncSettings, readRemote, toBase64, writeRemote } from '../src/lib/githubSync';

const settings = normalizeSyncSettings({ owner: 'me', repo: 'data', path: 'shiftmaster-data.json', token: 'tok' });

// Minimal in-memory stand-in for the GitHub contents API
function fakeGithub() {
  let file: { sha: string; content: string } | null = null;
  let n = 0;
  const calls: { method: string; url: string; body?: any }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
    if ((init.headers as any)?.Authorization !== 'Bearer tok') return json(401, { message: 'Bad credentials' });
    if (url.endsWith('/repos/me/data')) return json(200, { private: true, full_name: 'me/data', default_branch: 'main' });
    if (method === 'GET') return file ? json(200, { sha: file.sha, content: file.content, encoding: 'base64' }) : json(404, { message: 'Not Found' });
    if (method === 'PUT') {
      if (file && body.sha !== file.sha) return json(409, { message: 'does not match' });
      if (!file && body.sha) return json(409, { message: 'no file' });
      file = { sha: `sha${++n}`, content: body.content };
      return json(200, { content: { sha: file.sha } });
    }
    return json(500, {});
  });
  return { fetchMock, calls, get file() { return file; } };
}

afterEach(() => vi.unstubAllGlobals());

describe('GitHub sync', () => {
  it('encodes Hebrew text safely', () => {
    const text = JSON.stringify({ name: 'גולן חדד', emoji: '🌙' });
    expect(fromBase64(toBase64(text))).toBe(text);
  });

  it('fills defaults and trims settings', () => {
    const s = normalizeSyncSettings({ owner: ' me ', token: ' x ', path: '/a/b.json' });
    expect(s).toMatchObject({ owner: 'me', token: 'x', path: 'a/b.json', repo: 'shiftmaster-data', autoCheck: true });
  });

  it('saves, reads back, and detects a newer save from another device', async () => {
    const gh = fakeGithub();
    vi.stubGlobal('fetch', gh.fetchMock);
    expect(await readRemote(settings)).toBeNull();
    const sha1 = await writeRemote(settings, '{"v":1,"n":"דן"}', undefined, 'save 1');
    const remote = await readRemote(settings);
    expect(remote).toEqual({ sha: sha1, text: '{"v":1,"n":"דן"}' });
    // another device saves on top of sha1
    await writeRemote(settings, '{"v":2}', sha1, 'save 2');
    // this device still thinks sha1 is current -> conflict, nothing overwritten
    await expect(writeRemote(settings, '{"v":3}', sha1, 'save 3')).rejects.toMatchObject({ kind: 'conflict' });
    expect((await readRemote(settings))!.text).toBe('{"v":2}');
    expect(gh.calls.filter(c => c.method === 'PUT').every(c => c.url.endsWith('/repos/me/data/contents/shiftmaster-data.json'))).toBe(true);
  });

  it('reports a rejected token', async () => {
    vi.stubGlobal('fetch', fakeGithub().fetchMock);
    await expect(readRemote({ ...settings, token: 'wrong' })).rejects.toBeInstanceOf(SyncError);
    await expect(readRemote({ ...settings, token: 'wrong' })).rejects.toMatchObject({ kind: 'auth' });
  });

  it('fingerprints change with the data', () => {
    expect(fingerprint('a')).not.toBe(fingerprint('b'));
    expect(fingerprint('same')).toBe(fingerprint('same'));
  });
});
