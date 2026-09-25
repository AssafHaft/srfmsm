// GitHub sync: save/load the app's data to a GitHub repository so every
// device sees the same workers, rules and schedules.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState } from './useAppState';
import { STORAGE_KEYS, usePersistentState } from '../lib/storage';
import { buildBackup, parseBackup } from '../lib/io';
import {
  SyncError, SyncSettings, fingerprint, isConfigured, normalizeSyncSettings, defaultSyncSettings, readRemote, writeRemote,
} from '../lib/githubSync';
import { formatDateTime } from '../lib/dates';
import type { T } from '../i18n';

interface SyncMeta {
  sha?: string;       // version of the file this device last saved or loaded
  syncedAt?: string;  // when that version was saved
  fingerprint?: string;
}

const normalizeMeta = (raw: unknown): SyncMeta => {
  const r = (raw || {}) as SyncMeta;
  return {
    sha: typeof r.sha === 'string' ? r.sha : undefined,
    syncedAt: typeof r.syncedAt === 'string' ? r.syncedAt : undefined,
    fingerprint: typeof r.fingerprint === 'string' ? r.fingerprint : undefined,
  };
};

const dataFingerprint = (d: Pick<AppState, 'employees' | 'config' | 'versions' | 'monthSetups'>) =>
  fingerprint(JSON.stringify([d.employees, d.config, d.versions, d.monthSetups]));

const savedAtOf = (text: string): string | undefined => {
  try { return JSON.parse(text)?.exportedAt; } catch { return undefined; }
};

export function useGithubSync(
  app: AppState,
  opts: { t: T; toast: (text: string, tone?: 'ok' | 'error') => void; confirm: (o: { title: string; message?: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean> }
) {
  const { t, toast, confirm } = opts;
  const [settings, setSettings] = usePersistentState<SyncSettings>(STORAGE_KEYS.github, defaultSyncSettings, normalizeSyncSettings);
  const [meta, setMeta] = usePersistentState<SyncMeta>(STORAGE_KEYS.syncMeta, () => ({}), normalizeMeta);
  const [busy, setBusy] = useState<'save' | 'load' | null>(null);
  const [newer, setNewer] = useState<{ savedAt?: string } | null>(null);
  const configured = isConfigured(settings);

  const current = useMemo(
    () => dataFingerprint(app),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app.employees, app.config, app.versions, app.monthSetups]
  );
  const dirty = configured && meta.fingerprint !== current;

  const describe = useCallback((err: unknown) => {
    if (err instanceof SyncError) {
      if (err.kind === 'auth') return t('gh.errAuth');
      if (err.kind === 'notFound') return t('gh.errNotFound');
      if (err.kind === 'network') return t('gh.errNetwork');
      return t('gh.error', { error: err.message });
    }
    return t('gh.error', { error: (err as Error)?.message || String(err) });
  }, [t]);

  const when = (iso?: string) => (iso ? formatDateTime(Date.parse(iso), true) : '?');

  const save = useCallback(async () => {
    if (!configured) { toast(t('gh.notSet'), 'error'); return false; }
    setBusy('save');
    try {
      const text = buildBackup({
        employees: app.employees, config: app.config, versions: app.versions,
        selectedVersionId: app.selectedVersionId, monthSetups: app.monthSetups,
      });
      const savedAt = savedAtOf(text);
      const message = `ShiftMaster data: ${app.employees.length} workers, ${app.versions.length} versions`;
      let sha: string;
      try {
        sha = await writeRemote(settings, text, meta.sha, message);
      } catch (err) {
        if (!(err instanceof SyncError) || err.kind !== 'conflict') throw err;
        const remote = await readRemote(settings);
        const ok = await confirm({
          title: t('gh.conflictTitle'),
          message: t('gh.conflictMsg', { when: when(remote ? savedAtOf(remote.text) : undefined) }),
          confirmLabel: t('gh.overwrite'),
          danger: true,
        });
        if (!ok) return false;
        sha = await writeRemote(settings, text, remote?.sha, message);
      }
      setMeta({ sha, syncedAt: savedAt, fingerprint: current });
      setNewer(null);
      toast(t('gh.saved', { when: when(savedAt) }));
      return true;
    } catch (err) {
      toast(describe(err), 'error');
      return false;
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, settings, meta.sha, app, current, t, toast, confirm, describe, setMeta]);

  const load = useCallback(async () => {
    if (!configured) { toast(t('gh.notSet'), 'error'); return false; }
    setBusy('load');
    try {
      const remote = await readRemote(settings);
      if (!remote) { toast(t('gh.nothing'), 'error'); return false; }
      const data = parseBackup(remote.text);
      const ok = await confirm({
        title: t('gh.loadTitle'),
        message: t('gh.loadMsg', { when: when(data.exportedAt), workers: data.employees.length, versions: data.versions.length }),
        confirmLabel: t('gh.loadConfirm'),
        danger: dirty,
      });
      if (!ok) return false;
      app.setEmployees(data.employees);
      app.setConfig(data.config);
      app.setVersions(data.versions);
      app.setMonthSetups(data.monthSetups);
      if (data.selectedVersionId) app.setSelectedVersionId(data.selectedVersionId);
      setMeta({ sha: remote.sha, syncedAt: data.exportedAt, fingerprint: dataFingerprint(data) });
      setNewer(null);
      toast(t('gh.loaded', { when: when(data.exportedAt) }));
      return true;
    } catch (err) {
      toast(describe(err), 'error');
      return false;
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, settings, app, dirty, t, toast, confirm, describe, setMeta]);

  // When the app opens, look for data saved from another device
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current || !configured || !settings.autoCheck) return;
    checked.current = true;
    readRemote(settings)
      .then(remote => {
        if (remote && remote.sha !== meta.sha) setNewer({ savedAt: savedAtOf(remote.text) });
      })
      .catch(() => { /* offline or not set up: stay quiet */ });
  }, [configured, settings, meta.sha]);

  return { settings, setSettings, configured, dirty, busy, newer, dismissNewer: () => setNewer(null), save, load, meta, when };
}

export type GithubSync = ReturnType<typeof useGithubSync>;
