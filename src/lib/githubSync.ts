// Save/load all app data as one JSON file in a GitHub repository, using the
// GitHub REST "contents" API and a fine-grained personal access token.
// The token is kept only in this browser's storage; it is never part of
// backups or of the synced file.

export interface SyncSettings {
  owner: string;
  repo: string;
  branch: string; // empty = the repository's default branch
  path: string;
  token: string;
  autoCheck: boolean;
}

export interface RemoteFile {
  sha: string;
  text: string;
}

export type SyncErrorKind = 'auth' | 'notFound' | 'conflict' | 'network' | 'other';

export class SyncError extends Error {
  constructor(public kind: SyncErrorKind, message: string) {
    super(message);
  }
}

export const defaultSyncSettings = (): SyncSettings => {
  // On GitHub Pages the site lives at <owner>.github.io
  let owner = '';
  try {
    const host = window.location.hostname;
    if (host.endsWith('.github.io')) owner = host.split('.')[0];
  } catch { /* not in a browser */ }
  return { owner, repo: 'shiftmaster-data', branch: '', path: 'shiftmaster-data.json', token: '', autoCheck: true };
};

export const normalizeSyncSettings = (raw: unknown): SyncSettings => {
  const d = defaultSyncSettings();
  const r = (raw || {}) as Partial<SyncSettings>;
  const str = (v: unknown, fb: string) => (typeof v === 'string' ? v.trim() : fb);
  return {
    owner: str(r.owner, d.owner),
    repo: str(r.repo, d.repo),
    branch: str(r.branch, d.branch),
    path: str(r.path, d.path).replace(/^\/+/, '') || d.path,
    token: str(r.token, d.token),
    autoCheck: r.autoCheck !== false,
  };
};

export const isConfigured = (s: SyncSettings): boolean => !!(s.owner && s.repo && s.path && s.token);

const API = 'https://api.github.com';

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

async function call(s: SyncSettings, url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${s.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.headers || {}),
      },
      cache: 'no-store',
    });
  } catch {
    throw new SyncError('network', 'network');
  }
  if (res.status === 401 || res.status === 403) throw new SyncError('auth', await errorText(res));
  return res;
}

const errorText = async (res: Response) => {
  try {
    const j = await res.json();
    return j?.message || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
};

export const toBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

export const fromBase64 = (b64: string): string => {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

export async function repoInfo(s: SyncSettings): Promise<{ private: boolean; fullName: string; defaultBranch: string }> {
  const res = await call(s, `${API}/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}`);
  if (res.status === 404) throw new SyncError('notFound', await errorText(res));
  if (!res.ok) throw new SyncError('other', await errorText(res));
  const j = await res.json();
  return { private: !!j.private, fullName: j.full_name, defaultBranch: j.default_branch };
}

const contentsUrl = (s: SyncSettings) =>
  `${API}/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}/contents/${encodePath(s.path)}`;

// Latest version of the data file, or null when nothing was saved yet
export async function readRemote(s: SyncSettings): Promise<RemoteFile | null> {
  const ref = s.branch ? `?ref=${encodeURIComponent(s.branch)}` : '';
  const res = await call(s, contentsUrl(s) + ref);
  if (res.status === 404) {
    // Either the file does not exist yet, or the repository/branch is missing
    await repoInfo(s);
    return null;
  }
  if (!res.ok) throw new SyncError('other', await errorText(res));
  const j = await res.json();
  if (typeof j.content === 'string' && j.encoding === 'base64' && j.content.length > 0) {
    return { sha: j.sha, text: fromBase64(j.content) };
  }
  // Files over 1 MB come without inline content: fetch the raw bytes
  const raw = await call(s, contentsUrl(s) + ref, { headers: { Accept: 'application/vnd.github.raw+json' } });
  if (!raw.ok) throw new SyncError('other', await errorText(raw));
  return { sha: j.sha, text: await raw.text() };
}

// Writes the data file. `sha` is the version this device last saw; GitHub
// rejects the write (conflict) when someone saved a newer one in between.
export async function writeRemote(s: SyncSettings, text: string, sha: string | undefined, message: string): Promise<string> {
  const body: Record<string, string> = { message, content: toBase64(text) };
  if (sha) body.sha = sha;
  if (s.branch) body.branch = s.branch;
  const res = await call(s, contentsUrl(s), { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  if (res.status === 409 || res.status === 422) throw new SyncError('conflict', await errorText(res));
  if (res.status === 404) throw new SyncError('notFound', await errorText(res));
  if (!res.ok) throw new SyncError('other', await errorText(res));
  const j = await res.json();
  return j.content.sha as string;
}

// Cheap fingerprint of the synced data, to tell whether this device has
// changes that are not on GitHub yet
export const fingerprint = (text: string): string => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${text.length}:${(h >>> 0).toString(36)}`;
};
