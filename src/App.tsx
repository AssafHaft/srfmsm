import React, { useRef } from 'react';
import { CalendarDays, Download, HardDrive, Settings, Upload, Users, Waves } from 'lucide-react';
import { useAppState, Tab } from './state/useAppState';
import { buildBackup, downloadFile, parseBackup } from './lib/io';
import { formatDateKey } from './lib/dates';
import { Menu, MenuItem, Toasts, cx, useToasts } from './components/ui';
import { ScheduleTab } from './components/schedule/ScheduleTab';
import { WorkersTab } from './components/WorkersTab';
import { RulesTab } from './components/RulesTab';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'schedule', label: 'Schedule', icon: <CalendarDays className="w-4 h-4" /> },
  { id: 'workers', label: 'Workers', icon: <Users className="w-4 h-4" /> },
  { id: 'rules', label: 'Rules', icon: <Settings className="w-4 h-4" /> },
];

const App: React.FC = () => {
  const app = useAppState();
  const toasts = useToasts();
  const restoreRef = useRef<HTMLInputElement>(null);

  const backup = () => {
    downloadFile(
      `shiftmaster_backup_${formatDateKey(new Date())}.json`,
      buildBackup({
        employees: app.employees,
        config: app.config,
        versions: app.versions,
        selectedVersionId: app.selectedVersionId,
        monthSetups: app.monthSetups,
      }),
      'application/json'
    );
    toasts.push('Backup downloaded.');
  };

  const restore = async (file: File) => {
    try {
      const data = parseBackup(await file.text());
      const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'an unknown date';
      if (!window.confirm(`Restore the backup from ${when}?\n\nThis replaces all current workers, rules and schedules.`)) return;
      app.setEmployees(data.employees);
      app.setConfig(data.config);
      app.setVersions(data.versions);
      app.setSelectedVersionId(data.selectedVersionId);
      app.setMonthSetups(data.monthSetups);
      const selected = data.versions.find(v => v.id === data.selectedVersionId) || data.versions[0];
      if (selected) app.goToMonth(selected.year, selected.month);
      toasts.push(`Backup restored: ${data.employees.length} workers, ${data.versions.length} schedule versions.`);
    } catch (err) {
      toasts.push(`Could not restore: ${(err as Error).message}`, 'error');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-slate-900 text-white sticky top-0 z-30 shadow print:hidden">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold flex items-center gap-2 shrink-0"><Waves className="w-5 h-5 text-sky-400" /> <span className="hidden md:inline">ShiftMaster</span></h1>
          <nav className="flex gap-0.5 sm:gap-1 bg-slate-800 p-1 rounded-lg min-w-0" aria-label="Sections">
            {TABS.map(t => (
              <button key={t.id} type="button" onClick={() => app.setTab(t.id)} aria-current={app.ui.tab === t.id ? 'page' : undefined}
                className={cx('flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-sm transition', app.ui.tab === t.id ? 'bg-blue-600 text-white shadow' : 'text-slate-300 hover:text-white')}>
                {t.icon}<span>{t.label}</span>
              </button>
            ))}
          </nav>
          <div className="shrink-0">
            <Menu button={toggle => (
              <button type="button" onClick={toggle} title="Backup and restore" aria-label="Backup and restore" className="p-2 rounded-md text-slate-300 hover:text-white hover:bg-slate-800"><HardDrive className="w-4 h-4" /></button>
            )}>
              {close => <>
                <MenuItem icon={<Download className="w-4 h-4" />} hint="Workers, rules and all schedules (JSON)" onClick={() => { backup(); close(); }}>Download backup</MenuItem>
                <MenuItem icon={<Upload className="w-4 h-4" />} hint="Replaces everything in this browser" onClick={() => { restoreRef.current?.click(); close(); }}>Restore backup…</MenuItem>
              </>}
            </Menu>
            <input ref={restoreRef} type="file" accept=".json,application/json" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) restore(f); }} />
          </div>
        </div>
      </header>

      {app.storageError && (
        <div className="bg-red-600 text-white text-sm text-center px-4 py-2 print:hidden">
          Changes could not be saved in this browser (storage full or blocked). Download a backup, then delete old schedule versions.
        </div>
      )}

      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
        {app.ui.tab === 'schedule' && <ScheduleTab app={app} toast={toasts.push} />}
        {app.ui.tab === 'workers' && <WorkersTab employees={app.employees} setEmployees={app.setEmployees} />}
        {app.ui.tab === 'rules' && <RulesTab config={app.config} setConfig={app.setConfig} />}
      </main>

      <Toasts items={toasts.items} onDismiss={toasts.dismiss} />
    </div>
  );
};

export default App;
