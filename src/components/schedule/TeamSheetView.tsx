// The team sheet as the team will get it in Excel, with the events, notes
// and extra-row text typed straight into the table.
import React, { useMemo, useState } from 'react';
import { Download, Plus, Repeat, Settings2 } from 'lucide-react';
import { DayNote, ScheduleVersion, SheetNotes, ShiftConfig, ShiftType } from '../../types';
import { buildTeamSheet, hexColor, SheetDay, SheetShift, SHEET_COLORS, TeamSheet } from '../../lib/teamSheet';
import { formatDayLabel, parseDateKey, weekdayOf, weekdaysLong } from '../../lib/dates';
import { useI18n } from '../../i18n';
import { Button, Card, FieldLabel, Toggle, cx, inputClass } from '../ui';
import type { People } from './derived';

const bg = (rgb: string) => ({ backgroundColor: `#${rgb}` });
const ddmm = (date: string) => {
  const d = parseDateKey(date);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Keep only what differs from the defaults, so the saved data stays small
const cleanNote = (n: DayNote, weekly: string): DayNote | null => {
  const out: DayNote = {};
  if (n.events?.trim()) out.events = n.events;
  if (n.duty?.trim()) out.duty = n.duty;
  if (n.notes !== undefined && n.notes !== weekly) out.notes = n.notes;
  return Object.keys(out).length ? out : null;
};

const cellBase = 'border border-slate-400 px-1 py-0.5 text-center align-middle';

export const TeamSheetView: React.FC<{
  version: ScheduleVersion;
  config: ShiftConfig;
  people: People;
  notes: SheetNotes;
  setNotes: (update: (n: SheetNotes) => SheetNotes) => void;
  onOpenSlot: (date: string, shift: ShiftType, currentId?: string) => void;
  onEditDay: (date: string) => void;
  onDownload: () => void;
}> = ({ version, config, people, notes, setNotes, onOpenSlot, onEditDay, onDownload }) => {
  const { t, lang } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sheet = useMemo(() => buildTeamSheet(version, config, notes), [version, config, notes, lang]);
  const names = useMemo(() => [...people.byId.values()].map(e => e.name).filter(Boolean), [people]);
  const colorByName = useMemo(() => new Map([...people.byId.values()].map(e => [e.name.trim(), e.color])), [people]);

  const setDay = (date: string, patch: Partial<DayNote>) => setNotes(n => {
    const weekly = n.weekly[weekdayOf(date)] || '';
    const next = cleanNote({ ...(n.days[date] || {}), ...patch }, weekly);
    const days = { ...n.days };
    if (next) days[date] = next; else delete days[date];
    return { ...n, days };
  });
  const setWeekly = (dow: number, text: string) => setNotes(n => {
    const weekly = { ...n.weekly };
    if (text.trim()) weekly[dow] = text; else delete weekly[dow];
    return { ...n, weekly };
  });

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2 print:hidden">
        <p className="text-xs text-slate-500 max-w-2xl">{t('ts.hint')}</p>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" onClick={() => setSettingsOpen(o => !o)} aria-expanded={settingsOpen}>
            <Settings2 className="w-4 h-4" /> {t('ts.settings')}
          </Button>
          <Button size="sm" variant="primary" onClick={onDownload}>
            <Download className="w-4 h-4" /> {t('ts.download')}
          </Button>
        </div>
      </div>

      {settingsOpen && (
        <Card className="p-4 grid gap-4 print:hidden">
          <div>
            <div className="flex items-center gap-2">
              <Toggle checked={!notes.dutyOff} onChange={v => setNotes(n => ({ ...n, dutyOff: v ? undefined : true }))} label={t('ts.extraRow')} />
              <span className="text-sm font-medium text-slate-700">{t('ts.extraRow')}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">{t('ts.extraRowHint')}</p>
            {!notes.dutyOff && (
              <div className="mt-2 max-w-xs">
                <FieldLabel htmlFor="ts-duty-label">{t('ts.extraRowName')}</FieldLabel>
                <input id="ts-duty-label" value={notes.dutyLabel ?? ''} placeholder={t('ts.dutyDefault')}
                  onChange={e => setNotes(n => ({ ...n, dutyLabel: e.target.value || undefined }))}
                  className={cx(inputClass, 'w-full')} />
              </div>
            )}
          </div>
          <div>
            <FieldLabel hint={t('ts.weeklyHint')}>{t('ts.weekly')}</FieldLabel>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {weekdaysLong().map((name, dow) => (
                <label key={dow} className="block">
                  <span className="block text-xs text-slate-500 mb-0.5">{name}</span>
                  <input value={notes.weekly[dow] || ''} onChange={e => setWeekly(dow, e.target.value)} dir="auto"
                    aria-label={`${t('ts.weekly')}: ${name}`} className={cx(inputClass, 'w-full')} />
                </label>
              ))}
            </div>
          </div>
        </Card>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-300 bg-white shadow-sm print:overflow-visible print:border-0 print:shadow-none">
        <table className="w-full min-w-[780px] table-fixed border-collapse text-[12px] leading-tight text-slate-900 print:min-w-0">
          <colgroup>
            <col className="w-[104px]" />
            {Array.from({ length: 7 }).map((_, i) => <col key={i} />)}
          </colgroup>
          <thead>
            <tr>
              <th colSpan={8} className="border-2 border-slate-800 py-1.5 text-base font-bold" style={bg(SHEET_COLORS.title)} dir="auto">{sheet.title}</th>
            </tr>
            <tr>
              <th className="border-2 border-slate-800" style={bg(SHEET_COLORS.corner)} />
              {weekdaysLong().map((name, i) => (
                <th key={i} className="border border-slate-500 border-y-2 border-y-slate-800 py-1 font-bold" style={bg(SHEET_COLORS.weekdays[i])}>{name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.weeks.map(week => (
              <WeekBlock key={week[0].date} week={week} sheet={sheet} people={people} colorByName={colorByName}
                onOpenSlot={onOpenSlot} onEditDay={onEditDay} setDay={setDay} />
            ))}
          </tbody>
        </table>
      </div>
      <datalist id="ts-workers">{names.map(n => <option key={n} value={n} />)}</datalist>
    </div>
  );
};

const Label: React.FC<{ children: React.ReactNode; rowSpan?: number; fill?: string; top?: boolean; bottom?: boolean }> = ({ children, rowSpan, fill, top, bottom }) => (
  <th rowSpan={rowSpan} scope="row" style={fill ? bg(fill) : undefined}
    className={cx('border border-slate-400 border-x-2 border-x-slate-800 px-1 py-0.5 text-center font-bold', top && 'border-t-2 border-t-slate-800', bottom && 'border-b-2 border-b-slate-800')}>
    {children}
  </th>
);

const WeekBlock: React.FC<{
  week: SheetDay[];
  sheet: TeamSheet;
  people: People;
  colorByName: Map<string, string>;
  onOpenSlot: (date: string, shift: ShiftType, currentId?: string) => void;
  onEditDay: (date: string) => void;
  setDay: (date: string, patch: Partial<DayNote>) => void;
}> = ({ week, sheet, people, colorByName, onOpenSlot, onEditDay, setDay }) => {
  const { t } = useI18n();
  const hasDuty = sheet.dutyLabel !== null;
  const blockRows = 2 + sheet.dayRows + (hasDuty ? 1 : 0) + 2 + sheet.nightRows;

  // Closed days: one merged cell per run of days with the same name
  const closedSpan = week.map((d, i) => {
    if (!d.closed || (i > 0 && week[i - 1].closed && week[i - 1].label === d.label)) return 0;
    let span = 1;
    while (i + span < 7 && week[i + span].closed && week[i + span].label === d.label) span++;
    return span;
  });
  const edge = (i: number) => cx(i === 0 && 'border-s-2 border-s-slate-800', i === 6 && 'border-e-2 border-e-slate-800');

  // Cells of one row of the shift block (closed days skipped or merged)
  const shiftRow = (first: boolean, render: (d: SheetDay, i: number) => React.ReactNode) => week.map((d, i) => {
    if (!d.closed) return <React.Fragment key={d.date}>{render(d, i)}</React.Fragment>;
    if (!first || !closedSpan[i]) return null;
    const lastCol = i + closedSpan[i] - 1;
    return (
      <td key={d.date} rowSpan={blockRows} colSpan={closedSpan[i]}
        className={cx(cellBase, 'bg-white text-2xl sm:text-3xl font-bold text-slate-800', i === 0 && 'border-s-2 border-s-slate-800', lastCol === 6 && 'border-e-2 border-e-slate-800')}>
        <span dir="auto">{d.label || t('ts.closed')}</span>
      </td>
    );
  });

  const shiftCells = (pick: (d: SheetDay) => SheetShift | null, kind: 'day' | 'night', first: boolean) => shiftRow(first, (d, i) => {
    const s = pick(d);
    return <td className={cx(cellBase, 'font-bold whitespace-nowrap', !d.inMonth && 'text-slate-500', edge(i))}>
      {s ? (s.full ? t('ts.fullShift') : kind === 'day' ? t('ts.dayShift') : t('ts.nightShift')) : ''}
    </td>;
  });
  const hoursCells = (pick: (d: SheetDay) => SheetShift | null) => shiftRow(false, (d, i) => {
    const s = pick(d);
    return <td className={cx(cellBase, 'font-bold whitespace-nowrap tabular-nums', !d.inMonth && 'text-slate-500', edge(i))} dir="ltr">{s?.hours || ''}</td>;
  });
  const workerCells = (pick: (d: SheetDay) => SheetShift | null, shift: ShiftType, k: number) => shiftRow(false, (d, i) => {
    const s = pick(d);
    const id = s?.ids[k];
    if (id) {
      return (
        <td className={cx(cellBase, 'p-0', edge(i))} style={{ backgroundColor: people.colorOf(id) }}>
          <button type="button" dir="auto" onClick={() => onOpenSlot(d.date, shift, id)}
            className={cx('w-full truncate px-1 py-0.5 hover:underline print:no-underline', !d.inMonth && 'opacity-70')}>
            {people.nameOf(id)}
          </button>
        </td>
      );
    }
    const unfilled = s && k < s.ids.length + s.missing;
    return (
      <td className={cx(cellBase, 'p-0', edge(i))}>
        {unfilled ? (
          <button type="button" onClick={() => onOpenSlot(d.date, shift)}
            className={cx('w-full px-1 py-0.5 text-[11px] font-medium print:hidden', d.inMonth ? 'text-red-700 bg-red-50 hover:bg-red-100' : 'text-slate-400')}>
            <Plus className="inline w-3 h-3" /> {t('cal.unfilled')}
          </button>
        ) : null}
      </td>
    );
  });

  const dutyColor = (text: string) => hexColor(colorByName.get(text.trim()));

  return (
    <>
      <tr>
        <Label fill={SHEET_COLORS.date} top>{t('ts.days')}</Label>
        {week.map((d, i) => (
          <td key={d.date} className={cx(cellBase, 'p-0 border-t-2 border-t-slate-800', edge(i))} style={bg(SHEET_COLORS.date)}>
            <button type="button" onClick={() => onEditDay(d.date)} title={t('cal.daySettingsTip')} aria-label={`${t('cal.daySettings')}: ${formatDayLabel(d.date)}`}
              className={cx('w-full px-1 py-0.5 font-bold tabular-nums hover:underline', !d.inMonth && 'text-slate-500')} dir="ltr">
              {ddmm(d.date)}
            </button>
          </td>
        ))}
      </tr>
      <tr><Label>{t('ts.shift')}</Label>{shiftCells(d => d.day, 'day', true)}</tr>
      <tr><Label>{t('ts.hours')}</Label>{hoursCells(d => d.day)}</tr>
      {Array.from({ length: sheet.dayRows }).map((_, k) => (
        <tr key={`d${k}`}>
          {k === 0 && <Label rowSpan={sheet.dayRows}>{t('ts.dayTeam')}</Label>}
          {workerCells(d => d.day, ShiftType.DAY, k)}
        </tr>
      ))}
      {hasDuty && (
        <tr>
          <Label fill={SHEET_COLORS.duty}><span dir="auto">{sheet.dutyLabel}:</span></Label>
          {shiftRow(false, (d, i) => {
            const color = dutyColor(d.duty);
            return (
              <td className={cx(cellBase, 'p-0', edge(i))} style={bg(color || SHEET_COLORS.duty)}>
                <input value={d.duty} list="ts-workers" dir="auto" onChange={e => setDay(d.date, { duty: e.target.value })}
                  aria-label={t('ts.dutyOn', { label: sheet.dutyLabel || '', date: formatDayLabel(d.date) })}
                  className="w-full bg-transparent px-1 py-0.5 text-center focus:bg-white/70 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </td>
            );
          })}
        </tr>
      )}
      <tr><Label>{t('ts.shift')}</Label>{shiftCells(d => d.night, 'night', false)}</tr>
      <tr><Label>{t('ts.hours')}</Label>{hoursCells(d => d.night)}</tr>
      {Array.from({ length: sheet.nightRows }).map((_, k) => (
        <tr key={`n${k}`}>
          {k === 0 && <Label rowSpan={sheet.nightRows}>{t('ts.nightTeam')}</Label>}
          {workerCells(d => d.night, ShiftType.NIGHT, k)}
        </tr>
      ))}
      <tr>
        <Label fill={SHEET_COLORS.events}>{t('ts.events')}</Label>
        {week.map((d, i) => (
          <td key={d.date} className={cx(cellBase, 'p-0', edge(i))} style={bg(SHEET_COLORS.events)}>
            <TextCell value={d.events} onChange={v => setDay(d.date, { events: v })} label={t('ts.eventsOn', { date: formatDayLabel(d.date) })} />
          </td>
        ))}
      </tr>
      <tr>
        <Label bottom>{t('ts.notes')}</Label>
        {week.map((d, i) => (
          <td key={d.date} className={cx(cellBase, 'p-0 border-b-2 border-b-slate-800', edge(i))}>
            {d.label && !d.closed && (
              <button type="button" onClick={() => onEditDay(d.date)} dir="auto" className="block w-full px-1 pt-0.5 font-bold text-purple-700 hover:underline">{d.label}</button>
            )}
            <div className="relative">
              <TextCell value={d.notes} onChange={v => setDay(d.date, { notes: v })} muted={d.weeklyNote}
                label={t('ts.notesOn', { date: formatDayLabel(d.date) })} title={d.weeklyNote ? t('ts.weeklyTip') : undefined} />
              {d.weeklyNote && <Repeat className="absolute top-0.5 end-0.5 w-3 h-3 text-slate-400 print:hidden" aria-hidden />}
            </div>
          </td>
        ))}
      </tr>
    </>
  );
};

// Multi-line text in a sheet cell; grows with its content
const TextCell: React.FC<{ value: string; onChange: (v: string) => void; label: string; muted?: boolean; title?: string }> = ({ value, onChange, label, muted, title }) => {
  const lines = value.split('\n').reduce((s, p) => s + Math.max(1, Math.ceil(p.length / 14)), 0);
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} aria-label={label} title={title} dir="auto"
      rows={Math.min(8, Math.max(2, lines))}
      className={cx('block w-full resize-none bg-transparent px-1 py-0.5 text-center font-bold leading-snug focus:bg-white/80 focus:outline-none focus:ring-1 focus:ring-blue-500 print:resize-none',
        muted && 'text-slate-500')} />
  );
};
