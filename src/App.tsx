import React, { useRef, useState } from 'react';
import { CalendarDays, Download, DownloadCloud, Github, HardDrive, Languages, Loader2, Settings, Upload, UploadCloud, Users, Waves } from 'lucide-react';
import { useGithubSync } from './state/useGithubSync';
import { SyncDialog } from './components/SyncDialog';
import { useAppState, Tab } from './state/useAppState';
import { buildBackup, downloadFile, parseBackup } from './lib/io';
import { formatDateKey, formatDateTime } from './lib/dates';
import { I18nProvider, MessageKey, useI18n } from './i18n';
import { ConfirmProvider, Menu, MenuItem, Toasts, cx, isEmbedded, useConfirm, useToasts } from './components/ui';
import { ScheduleTab } from './components/schedule/ScheduleTab';
import { WorkersTab } from './components/WorkersTab';
import { RulesTab } from './components/RulesTab';

const TABS: { id: Tab; label: MessageKey; icon: React.ReactNode }[] = [
  { id: 'schedule', label: 'tab.schedule', icon: <CalendarDays className="w-4 h-4" /> },
  { id: 'workers', label: 'tab.workers', icon: <Users className="w-4 h-4" /> },
  { id: 'rules', label: 'tab.rules', icon: <Settings className="w-4 h-4" /> },
];

const App: React.FC = () => {
  const app = useAppState();
  return (
    <I18nProvider lang={app.ui.lang} setLang={app.setLang}>
      <ConfirmProvider>
        <Shell app={app} />
      </ConfirmProvider>
    </I18nProvider>
  );
};

const Shell: React.FC<{ app: ReturnType<typeof useAppState> }> = ({ app }) => {
  const { t, lang, setLang } = useI18n();
  const toasts = useToasts();
  const confirm = useConfirm();
  const restoreRef = useRef<HTMLInputElement>(null);
  const sync = useGithubSync(app, { t, toast: toasts.push, confirm });
  const [syncOpen, setSyncOpen] = useState(false);

  const backup = () => {
    if (isEmbedded()) {
      toasts.push(t('preview.noDownloads'), 'error');
      return;
    }
    downloadFile(
      `shiftmaster_backup_${formatDateKey(new Date())}.json`,
      buildBackup({
        employees: app.employees,
        config: app.config,
        versions: app.versions,
        selectedVersionId: app.selectedVersionId,
        monthSetups: app.monthSetups,
        sheetNotes: app.sheetNotes,
      }),
      'application/json'
    );
    toasts.push(t('backup.downloaded'));
  };

  const restore = async (file: File) => {
    try {
      const data = parseBackup(await file.text());
      const when = data.exportedAt ? formatDateTime(Date.parse(data.exportedAt), true) : t('backup.unknownDate');
      const ok = await confirm({
        title: t('backup.restoreTitle'),
        message: t('backup.restoreMsg', { when, workers: data.employees.length, versions: data.versions.length }),
        confirmLabel: t('backup.restore'),
        danger: true,
      });
      if (!ok) return;
      app.setEmployees(data.employees);
      app.setConfig(data.config);
      app.setVersions(data.versions);
      app.setSelectedVersionId(data.selectedVersionId);
      app.setMonthSetups(data.monthSetups);
      app.setSheetNotes(data.sheetNotes);
      const selected = data.versions.find(v => v.id === data.selectedVersionId) || data.versions[0];
      if (selected) app.goToMonth(selected.year, selected.month);
      toasts.push(t('backup.restored', { workers: data.employees.length, versions: data.versions.length }));
    } catch (err) {
      toasts.push(t('backup.restoreFailed', { error: (err as Error).message }), 'error');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-slate-900 text-white sticky top-0 z-30 shadow print:hidden">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 flex items-center justify-between gap-2">
          <h1 className="hidden sm:flex text-lg font-semibold items-center gap-2 shrink-0"><Waves className="w-5 h-5 text-sky-400" /> <span className="hidden md:inline">ShiftMaster</span></h1>
          <nav className="flex gap-0.5 sm:gap-1 bg-slate-800 p-1 rounded-lg min-w-0" aria-label={t('tab.sections')}>
            {TABS.map(tb => (
              <button key={tb.id} type="button" onClick={() => app.setTab(tb.id)} aria-current={app.ui.tab === tb.id ? 'page' : undefined}
                className={cx('flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-sm transition', app.ui.tab === tb.id ? 'bg-blue-600 text-white shadow' : 'text-slate-300 hover:text-white')}>
                <span className="hidden sm:inline-flex">{tb.icon}</span><span>{t(tb.label)}</span>
              </button>
            ))}
          </nav>
          <div className="shrink-0 flex items-center gap-1">
            <button type="button" onClick={() => setLang(lang === 'he' ? 'en' : 'he')} title={t('lang.switch')} aria-label={t('lang.switch')}
              className="flex items-center gap-1 px-2 py-1.5 rounded-md text-sm text-slate-300 hover:text-white hover:bg-slate-800">
              <Languages className="hidden sm:inline w-4 h-4" /><span className="hidden sm:inline">{lang === 'he' ? 'English' : 'עברית'}</span><span className="sm:hidden">{lang === 'he' ? 'EN' : 'עב'}</span>
            </button>
            <Menu button={toggle => (
              <button type="button" onClick={toggle} title={t('backup.menu')} aria-label={t('backup.menu')} className="relative p-2 rounded-md text-slate-300 hover:text-white hover:bg-slate-800">
                {sync.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardDrive className="w-4 h-4" />}
                {sync.dirty && <span className="absolute top-1 end-1 w-2 h-2 rounded-full bg-amber-400" aria-label={t('gh.unsaved')} />}
              </button>
            )}>
              {close => <>
                <div className="px-3 pt-1.5 pb-2 text-xs text-slate-500 border-b border-slate-100 mb-1">
                  {!sync.configured ? t('gh.notSet') : sync.dirty ? <span className="text-amber-700 font-medium">{t('gh.unsaved')}</span> : sync.meta.syncedAt ? t('gh.lastSync', { when: sync.when(sync.meta.syncedAt) }) : t('gh.never')}
                </div>
                <MenuItem icon={<UploadCloud className="w-4 h-4" />} hint={t('gh.saveHint')} onClick={() => { close(); if (sync.configured) sync.save(); else setSyncOpen(true); }}>{t('gh.save')}</MenuItem>
                <MenuItem icon={<DownloadCloud className="w-4 h-4" />} hint={t('gh.loadHint')} onClick={() => { close(); if (sync.configured) sync.load(); else setSyncOpen(true); }}>{t('gh.load')}</MenuItem>
                <MenuItem icon={<Github className="w-4 h-4" />} hint={t('gh.settingsHint')} onClick={() => { close(); setSyncOpen(true); }}>{t('gh.settings')}</MenuItem>
                <div className="border-t border-slate-100 my-1" />
                <MenuItem icon={<Download className="w-4 h-4" />} hint={t('backup.downloadHint')} onClick={() => { backup(); close(); }}>{t('backup.download')}</MenuItem>
                <MenuItem icon={<Upload className="w-4 h-4" />} hint={t('backup.restoreHint')} onClick={() => { restoreRef.current?.click(); close(); }}>{t('backup.restoreItem')}</MenuItem>
              </>}
            </Menu>
            <input ref={restoreRef} type="file" accept=".json,application/json" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) restore(f); }} />
          </div>
        </div>
      </header>

      {sync.newer && (
        <div className="bg-blue-600 text-white text-sm px-4 py-2 flex flex-wrap items-center justify-center gap-3 print:hidden">
          <span>{t('gh.newer', { when: sync.when(sync.newer.savedAt) })}</span>
          <button type="button" onClick={() => sync.load()} className="rounded-md bg-white text-blue-700 px-3 py-1 text-xs font-semibold hover:bg-blue-50">{t('gh.load')}</button>
          <button type="button" onClick={sync.dismissNewer} className="text-xs underline opacity-90">{t('ui.dismiss')}</button>
        </div>
      )}

      {app.storageError && (
        <div className="bg-red-600 text-white text-sm text-center px-4 py-2 print:hidden">
          {t('storage.error')}
        </div>
      )}

      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
        {app.ui.tab === 'schedule' && <ScheduleTab app={app} toast={toasts.push} />}
        {app.ui.tab === 'workers' && <WorkersTab employees={app.employees} setEmployees={app.setEmployees} />}
        {app.ui.tab === 'rules' && <RulesTab config={app.config} setConfig={app.setConfig} />}
      </main>

      {syncOpen && <SyncDialog settings={sync.settings} onSave={sync.setSettings} onClose={() => setSyncOpen(false)} />}
      <Toasts items={toasts.items} onDismiss={toasts.dismiss} />
    </div>
  );
};

export default App;
