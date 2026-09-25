import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Github, Loader2 } from 'lucide-react';
import { Button, FieldLabel, Modal, Toggle, cx, inputClass } from './ui';
import { SyncError, SyncSettings, repoInfo } from '../lib/githubSync';
import { useI18n } from '../i18n';

export const SyncDialog: React.FC<{
  settings: SyncSettings;
  onSave: (s: SyncSettings) => void;
  onClose: () => void;
}> = ({ settings, onSave, onClose }) => {
  const { t } = useI18n();
  const [draft, setDraft] = useState<SyncSettings>(settings);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; publicRepo?: boolean } | null>(null);
  const set = (patch: Partial<SyncSettings>) => { setDraft(d => ({ ...d, ...patch })); setResult(null); };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const info = await repoInfo(draft);
      setResult({
        ok: true,
        publicRepo: !info.private,
        text: info.private
          ? t('gh.testOk', { repo: info.fullName, visibility: t('gh.private') })
          : t('gh.publicWarn', { repo: info.fullName }),
      });
    } catch (err) {
      const kind = err instanceof SyncError ? err.kind : 'other';
      setResult({ ok: false, text: kind === 'auth' ? t('gh.errAuth') : kind === 'notFound' ? t('gh.errNotFound') : kind === 'network' ? t('gh.errNetwork') : t('gh.error', { error: (err as Error).message }) });
    } finally {
      setTesting(false);
    }
  };

  const field = (key: 'owner' | 'repo' | 'branch' | 'path', label: string, placeholder?: string) => (
    <div>
      <FieldLabel htmlFor={`gh-${key}`}>{label}</FieldLabel>
      <input id={`gh-${key}`} dir="ltr" value={draft[key]} placeholder={placeholder} onChange={e => set({ [key]: e.target.value } as Partial<SyncSettings>)} className={cx(inputClass, 'w-full')} autoComplete="off" spellCheck={false} />
    </div>
  );

  return (
    <Modal open wide onClose={onClose} title={<span className="flex items-center gap-2"><Github className="w-5 h-5" /> {t('gh.title')}</span>}
      footer={<>
        {settings.token && (
          <Button variant="danger" className="me-auto" onClick={() => { onSave({ ...draft, token: '' }); onClose(); }}>{t('gh.disconnect')}</Button>
        )}
        <Button variant="ghost" onClick={onClose}>{t('ui.cancel')}</Button>
        <Button variant="primary" onClick={() => { onSave(draft); onClose(); }}>{t('ui.save')}</Button>
      </>}>
      <div className="grid grid-cols-1 gap-4 text-sm">
        <p className="text-slate-700">{t('gh.intro')}</p>
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p>{t('gh.privateWarn')}</p>
            <p className="mt-1 text-xs">{t('gh.steps')}</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('owner', t('gh.owner'), 'AssafHaft')}
          {field('repo', t('gh.repo'), 'shiftmaster-data')}
          {field('path', t('gh.path'), 'shiftmaster-data.json')}
          {field('branch', t('gh.branch'), 'main')}
        </div>
        <div>
          <FieldLabel htmlFor="gh-token" hint={t('gh.tokenHint')}>{t('gh.token')}</FieldLabel>
          <input id="gh-token" dir="ltr" type="password" value={draft.token} onChange={e => set({ token: e.target.value.trim() })} className={cx(inputClass, 'w-full font-mono')} autoComplete="off" placeholder="github_pat_…" />
          <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">
            {t('gh.tokenLink')} <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <label className="flex items-center gap-2 text-slate-700">
          <Toggle checked={draft.autoCheck} onChange={v => set({ autoCheck: v })} label={t('gh.autoLoad')} /> {t('gh.autoLoad')}
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={test} disabled={testing || !draft.owner || !draft.repo || !draft.token}>
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} {t('gh.test')}
          </Button>
          {result && (
            <span className={cx('text-xs', !result.ok ? 'text-red-700' : result.publicRepo ? 'text-amber-800 font-semibold' : 'text-emerald-700')}>{result.text}</span>
          )}
        </div>
      </div>
    </Modal>
  );
};
