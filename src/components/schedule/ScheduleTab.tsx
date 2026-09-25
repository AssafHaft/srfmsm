import React, { useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { AppState } from '../../state/useAppState';
import { generateVersion, keptParts } from '../../lib/generate';
import { capacityCheck } from '../../lib/engine';
import { parseScheduleCSV } from '../../lib/io';
import { previousMonthVersions } from '../../lib/continuity';
import { formatShortDate, monthLabel } from '../../lib/dates';
import { Card } from '../ui';
import { PlanPanel } from './PlanPanel';
import { VersionList } from './VersionList';
import { VersionView } from './VersionView';
import { ContextEditor } from './ContextEditor';
import { useI18n } from '../../i18n';

export const ScheduleTab: React.FC<{ app: AppState; toast: (text: string, tone?: 'ok' | 'error') => void }> = ({ app, toast }) => {
  const { employees, config, ui, continuity, currentVersion, monthVersions, versions } = app;
  const { year, month } = ui;
  const [generating, setGenerating] = useState(false);
  const { t } = useI18n();
  const [editingContext, setEditingContext] = useState(false);

  const active = useMemo(() => employees.filter(e => e.active !== false), [employees]);
  const capacity = useMemo(() => capacityCheck({ employees: active, year, month, config }), [active, year, month, config]);
  const kept = useMemo(() => {
    const k = keptParts({ employees, year, month, base: currentVersion, continuity });
    const pinned = Object.values(k.pins).reduce((s, d) => s + d.dayShift.length + d.nightShift.length, 0);
    const lockedOwn = Object.keys(k.locked).filter(d => !k.carriedDates.has(d)).length;
    return { locked: lockedOwn, pinned, carried: k.carriedDates.size };
  }, [employees, year, month, currentVersion, continuity]);

  const generate = () => {
    setGenerating(true);
    // Let the button show its busy state before the (sub-second) search runs
    setTimeout(() => {
      try {
        const v = generateVersion({
          employees, config, year, month,
          base: currentVersion,
          continuity,
          variation: monthVersions.length + 1,
        });
        app.addVersion(v);
      } catch (err) {
        console.error(err);
        toast(t('plan.genFailed'), 'error');
      } finally {
        setGenerating(false);
      }
    }, 30);
  };

  const importCsv = async (file: File) => {
    try {
      const res = parseScheduleCSV(await file.text(), employees);
      if (res.days === 0) throw new Error(t('csv.noDates'));
      app.setMonthSetup(s => ({ ...s, continuity: 'custom', custom: res.entries, customLabel: t('cont.fromFile', { file: file.name }), released: undefined }));
      const note = res.unmatched.length ? `\n${t('csv.unmatched', { names: res.unmatched.join(', ') })}` : '';
      toast(t('csv.imported', { count: res.days, range: `${formatShortDate(res.first!)} – ${formatShortDate(res.last!)}` }) + note, res.unmatched.length ? 'error' : 'ok');
    } catch (err) {
      toast(t('csv.failed', { error: (err as Error).message }), 'error');
    }
  };

  const setContinuityMode = (mode: 'auto' | 'none') => app.setMonthSetup(s => ({ ...s, continuity: mode, released: undefined }));
  const contextInitial = { ...continuity.history, ...continuity.carried };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)] print:block items-start">
      <div className="grid grid-cols-1 gap-4 min-w-0">
        <PlanPanel
          year={year}
          month={month}
          goToMonth={app.goToMonth}
          continuity={continuity}
          continuityMode={app.monthSetup?.continuity ?? 'auto'}
          hasPreviousVersion={previousMonthVersions(versions, year, month).length > 0}
          setContinuityMode={setContinuityMode}
          onImportCsv={importCsv}
          onEditContext={() => setEditingContext(true)}
          kept={kept}
          capacity={capacity}
          activeWorkers={active.length}
          config={config}
          setConfig={app.setConfig}
          generating={generating}
          onGenerate={generate}
          hasVersion={!!currentVersion}
        />
        <VersionList
          versions={monthVersions}
          currentId={currentVersion?.id ?? null}
          employees={employees}
          config={config}
          onSelect={app.setSelectedVersionId}
          onFinal={app.markFinal}
          onRename={app.renameVersion}
          onDelete={app.deleteVersion}
        />
      </div>

      <div className="min-w-0">
        {currentVersion ? (
          <VersionView
            key={currentVersion.id}
            version={currentVersion}
            employees={employees}
            config={config}
            setConfig={app.setConfig}
            calendarMode={ui.calendarMode}
            setCalendarMode={m => app.setUi(u => ({ ...u, calendarMode: m }))}
            onAssign={(date, shift, empId, replaceId) => app.assign(currentVersion.id, date, shift, empId, replaceId)}
            onRemove={(date, empId) => app.unassign(currentVersion.id, date, empId)}
            onTogglePin={(date, empId) => app.togglePin(currentVersion.id, date, empId)}
            onToggleLock={date => app.toggleLock(currentVersion.id, date)}
            onFinal={() => app.markFinal(currentVersion.id)}
            toast={toast}
          />
        ) : (
          <Card className="p-10 text-center">
            <CalendarDays className="w-12 h-12 text-blue-200 mx-auto mb-3" />
            <h3 className="font-semibold text-slate-900">{t('plan.noSchedule', { month: monthLabel(year, month) })}</h3>
            <p className="text-sm text-slate-500 mt-1">{t('plan.noScheduleHint')}</p>
          </Card>
        )}
      </div>

      {editingContext && (
        <ContextEditor
          year={year}
          month={month}
          employees={employees}
          initial={contextInitial}
          onClose={() => setEditingContext(false)}
          onSave={entries => {
            app.setMonthSetup(s => ({ ...s, continuity: 'custom', custom: entries, customLabel: t('cont.manual'), released: undefined }));
            setEditingContext(false);
            toast(t('ctx.saved'));
          }}
        />
      )}
    </div>
  );
};
