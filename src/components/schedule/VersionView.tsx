import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarDays, CheckCircle2, ClipboardCopy, Download, FileSpreadsheet, LayoutGrid, List, Printer, Scale, Sheet, Star, Wallet
} from 'lucide-react';
import { Employee, ScheduleVersion, SheetNotes, ShiftConfig, ShiftType } from '../../types';
import { formatDateTime, formatDayLabel, formatShortDate } from '../../lib/dates';
import { downloadFile, scheduleToCSV, scheduleToText, scheduleWorkbook, XLSX_TYPE } from '../../lib/io';
import { buildTeamSheet, teamSheetFileName, teamSheetXlsx } from '../../lib/teamSheet';
import { TeamSheetView } from './TeamSheetView';
import { calculatePayroll } from '../../lib/payroll';
import { Badge, Button, Card, Menu, MenuItem, Modal, Segmented, cx, isEmbedded } from '../ui';
import { CalendarView } from './CalendarView';
import { AssignDialog, SlotRef } from './AssignDialog';
import { FairnessTable, PayrollTable } from './Tables';
import { makePeople, rulesChangedSince, useVersionInsights } from './derived';
import { applySpecialDays, SpecialDayForm } from '../RulesTab';
import { useI18n } from '../../i18n';

type View = 'calendar' | 'sheet' | 'fairness' | 'payroll';

export const VersionView: React.FC<{
  version: ScheduleVersion;
  employees: Employee[];
  config: ShiftConfig;
  setConfig: (c: ShiftConfig) => void;
  sheetNotes: SheetNotes;
  setSheetNotes: (update: (n: SheetNotes) => SheetNotes) => void;
  calendarMode: 'grid' | 'list';
  setCalendarMode: (m: 'grid' | 'list') => void;
  onAssign: (date: string, shift: ShiftType, empId: string, replaceId?: string) => void;
  onRemove: (date: string, empId: string) => void;
  onTogglePin: (date: string, empId: string) => void;
  onToggleLock: (date: string) => void;
  onFinal: () => void;
  toast: (text: string, tone?: 'ok' | 'error') => void;
}> = ({ version, employees, config, setConfig, sheetNotes, setSheetNotes, calendarMode, setCalendarMode, onAssign, onRemove, onTogglePin, onToggleLock, onFinal, toast }) => {
  const [view, setView] = useState<View>('calendar');
  const { t, lang } = useI18n();
  const [slot, setSlot] = useState<SlotRef | null>(null);
  const [dayEdit, setDayEdit] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const insights = useVersionInsights(version, employees, config)!;
  const people = useMemo(() => makePeople(employees, version), [employees, version, t]);
  const changed = rulesChangedSince(version, config);

  const { validation, stats, fairness, ruleIssues } = insights;
  const issueList = validation.issues.filter(i => i.severity !== 'info' && i.kind !== 'empty');
  const gap = Math.round(fairness.maxShiftGap * 10) / 10;
  const monthShifts = version.schedule.filter(d => !d.isPadding).reduce((s, d) => s + d.dayShift.length + d.nightShift.length, 0);

  const embedded = isEmbedded();
  const blocked = () => toast(t('preview.noExports'), 'error');
  const exportCsv = () => {
    if (embedded) return blocked();
    downloadFile(`schedule_${version.month + 1}_${version.year}.csv`, scheduleToCSV(version, people.nameOf), 'text/csv;charset=utf-8');
  };
  const exportExcel = () => {
    if (embedded) return blocked();
    const pay = calculatePayroll(version.schedule, employees, insights.config).byWorker;
    const summary = Object.keys(stats).filter(id => stats[id].shifts > 0).map(id => ({
      name: people.nameOf(id), shifts: stats[id].shifts, day: stats[id].day, night: stats[id].night,
      weekend: stats[id].weekend, hours: stats[id].hours, pay: pay[id]?.estimatedPay || 0,
    }));
    downloadFile(`schedule_${version.month + 1}_${version.year}.xlsx`, scheduleWorkbook(version, people.nameOf, summary, lang === 'he'), XLSX_TYPE);
  };
  const exportTeamSheet = () => {
    if (embedded) return blocked();
    const sheet = buildTeamSheet(version, insights.config, sheetNotes);
    // Every worker gets a color rule, also names not in this month's schedule
    const list = [...employees, ...Object.values(version.people || {})].map(p => ({ name: p.name, color: p.color }));
    downloadFile(teamSheetFileName(sheet), teamSheetXlsx(sheet, people.nameOf, list, lang === 'he'), XLSX_TYPE);
  };
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(scheduleToText(version, people.nameOf));
      toast(t('v.copied'));
    } catch {
      toast(t('v.copyBlocked'), 'error');
    }
  };

  const slotDay = slot ? version.schedule.find(d => d.date === slot.date) : undefined;

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
              <span dir="auto">{version.name}</span>
              {version.final && <Badge tone="green"><CheckCircle2 className="w-3 h-3" /> {t('vl.final')}</Badge>}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {t('v.generated', { when: formatDateTime(version.timestamp, true) })}
              {version.continuityLabel && <> · {t('v.continuesFrom', { label: version.continuityLabel })}</>}
            </p>
          </div>
          <div className="flex gap-2 print:hidden">
            <Button variant={version.final ? 'secondary' : 'primary'} size="sm" onClick={onFinal}>
              <CheckCircle2 className="w-4 h-4" /> {version.final ? t('vl.unmarkFinal') : t('vl.markFinal')}
            </Button>
            <Menu button={toggle => <Button size="sm" onClick={toggle}><Download className="w-4 h-4" /> {t('v.export')}</Button>}>
              {close => <>
                <MenuItem icon={<Sheet className="w-4 h-4" />} hint={t('v.excelTeamHint')} onClick={() => { exportTeamSheet(); close(); }}>{t('v.excelTeam')}</MenuItem>
                <MenuItem icon={<FileSpreadsheet className="w-4 h-4" />} hint={t('v.excelHint')} onClick={() => { exportExcel(); close(); }}>{t('v.excelData')}</MenuItem>
                <MenuItem icon={<Download className="w-4 h-4" />} hint={t('v.csvHint')} onClick={() => { exportCsv(); close(); }}>CSV</MenuItem>
                <MenuItem icon={<ClipboardCopy className="w-4 h-4" />} hint={t('v.textHint')} onClick={() => { copyText(); close(); }}>{t('v.text')}</MenuItem>
                {!embedded && <MenuItem icon={<Printer className="w-4 h-4" />} hint={t('v.printHint')} onClick={() => { close(); if (view !== 'sheet') setView('calendar'); setTimeout(() => window.print(), 100); }}>{t('v.print')}</MenuItem>}
              </>}
            </Menu>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 print:hidden">
          <span className={cx('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium', validation.emptySlots ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700')}>
            <CalendarDays className="w-3.5 h-3.5" />
            {validation.emptySlots ? t('v.unfilled', { count: validation.emptySlots }) : t('v.allFilled', { n: monthShifts })}
          </span>
          <button type="button" disabled={!ruleIssues} onClick={() => setShowIssues(v => !v)}
            className={cx('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium', ruleIssues ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-emerald-50 text-emerald-700')}>
            <AlertTriangle className="w-3.5 h-3.5" />
            {ruleIssues ? `${t('q.issues', { count: ruleIssues })} — ${showIssues ? t('v.hide') : t('v.show')}` : t('v.noIssues')}
          </button>
          {version.targets && (
            <span className={cx('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium', gap < 1 ? 'bg-emerald-50 text-emerald-700' : gap < 2 ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700')}>
              <Scale className="w-3.5 h-3.5" />
              {gap < 1 ? t('v.fairOk') : t('v.fairGap', { n: gap })}
            </span>
          )}
          {version.targets ? (
            <span className={cx('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium', fairness.maxWeekendGap < 1 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>
              <Star className="w-3.5 h-3.5" />
              {fairness.maxWeekendGap < 1 ? t('v.weekendsOk') : t('v.weekendsGap', { n: Math.round(fairness.maxWeekendGap * 10) / 10 })}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium bg-slate-100 text-slate-700">
              <Star className="w-3.5 h-3.5" />
              {fairness.weekendRange[0] === fairness.weekendRange[1] ? t('v.weekendsEach', { n: fairness.weekendRange[0] }) : t('v.weekendsRange', { lo: fairness.weekendRange[0], hi: fairness.weekendRange[1] })}
            </span>
          )}
        </div>

        {showIssues && issueList.length > 0 && (
          <ul className="mt-3 grid gap-1 text-sm print:hidden">
            {issueList.map((i, k) => (
              <li key={k} className="flex items-start gap-2 rounded-md bg-red-50/60 px-2.5 py-1.5">
                <AlertTriangle className={cx('w-3.5 h-3.5 mt-0.5 shrink-0', i.severity === 'error' ? 'text-red-600' : 'text-amber-600')} />
                <span><b>{formatShortDate(i.date)}</b>{i.empId && <> · <span dir="auto">{people.nameOf(i.empId)}</span></>}: {i.message}</span>
              </li>
            ))}
          </ul>
        )}

        {changed && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 print:hidden">
            {t('v.rulesChanged')}
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Segmented value={view} onChange={setView} ariaLabel={t('v.view')} options={[
          { value: 'calendar', label: <span className="flex items-center gap-1.5"><CalendarDays className="w-4 h-4" /> {t('v.calendar')}</span> },
          { value: 'sheet', label: <span className="flex items-center gap-1.5"><Sheet className="w-4 h-4" /> {t('v.sheet')}</span> },
          { value: 'fairness', label: <span className="flex items-center gap-1.5"><Scale className="w-4 h-4" /> {t('v.fairness')}</span> },
          { value: 'payroll', label: <span className="flex items-center gap-1.5"><Wallet className="w-4 h-4" /> {t('v.payroll')}</span> },
        ]} />
        {view === 'calendar' && (
          <div className="hidden md:block">
            <Segmented size="sm" value={calendarMode} onChange={setCalendarMode} ariaLabel={t('v.layout')} options={[
              { value: 'grid', label: <span className="flex items-center gap-1"><LayoutGrid className="w-3.5 h-3.5" /> {t('v.month')}</span> },
              { value: 'list', label: <span className="flex items-center gap-1"><List className="w-3.5 h-3.5" /> {t('v.list')}</span> },
            ]} />
          </div>
        )}
      </div>

      {view === 'calendar' && (
        <>
          <div className={cx(calendarMode === 'grid' ? 'hidden md:block' : 'hidden', 'print:block')}>
            <CalendarView version={version} config={insights.config} people={people} validation={validation} mode="grid"
              onOpenSlot={(date, shift, currentId) => setSlot({ date, shift, currentId })}
              onRemove={onRemove} onTogglePin={onTogglePin} onToggleLock={onToggleLock} onEditDay={setDayEdit} />
          </div>
          <div className={cx(calendarMode === 'grid' ? 'md:hidden' : '', 'print:hidden')}>
            <CalendarView version={version} config={insights.config} people={people} validation={validation} mode="list"
              onOpenSlot={(date, shift, currentId) => setSlot({ date, shift, currentId })}
              onRemove={onRemove} onTogglePin={onTogglePin} onToggleLock={onToggleLock} onEditDay={setDayEdit} />
          </div>
          <p className="text-xs text-slate-500 print:hidden">
            {t('v.calendarHint')}
          </p>
        </>
      )}
      {view === 'sheet' && (
        <TeamSheetView version={version} config={insights.config} people={people} notes={sheetNotes} setNotes={setSheetNotes}
          onOpenSlot={(date, shift, currentId) => setSlot({ date, shift, currentId })} onEditDay={setDayEdit} onDownload={exportTeamSheet} />
      )}
      {view === 'fairness' && <FairnessTable version={version} employees={employees} config={insights.config} stats={stats} people={people} />}
      {view === 'payroll' && <PayrollTable version={version} employees={employees} config={insights.config} people={people} />}

      {slot && slotDay && (
        <AssignDialog
          slot={slot}
          version={version}
          employees={employees}
          config={insights.config}
          people={people}
          stats={stats}
          onClose={() => setSlot(null)}
          onAssign={empId => { onAssign(slot.date, slot.shift, empId, slot.currentId); setSlot(null); }}
          onRemove={() => { if (slot.currentId) onRemove(slot.date, slot.currentId); setSlot(null); }}
          onTogglePin={() => { if (slot.currentId) onTogglePin(slot.date, slot.currentId); }}
        />
      )}

      {dayEdit && (
        <Modal open onClose={() => setDayEdit(null)} title={t('v.specialTitle', { date: formatDayLabel(dayEdit) })}>
          <p className="text-xs text-slate-500 mb-3">{t('v.specialHint')}</p>
          <SpecialDayForm
            config={config}
            initialDate={dayEdit}
            initial={config.specialDays?.[dayEdit]}
            allowRange={false}
            onCancel={() => setDayEdit(null)}
            onSave={(dates, s) => { setConfig(applySpecialDays(config, dates, s)); setDayEdit(null); }}
          />
        </Modal>
      )}
    </div>
  );
};
