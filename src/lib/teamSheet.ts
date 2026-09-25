// The team sheet: the month laid out week by week the way the team receives
// it (dates, morning shift, extra duty row, night shift, events, notes). The
// Team sheet view shows it and the Excel export writes it with the same
// look as the manager's own spreadsheet.
import { DailySchedule, ScheduleVersion, SheetNotes, ShiftConfig } from '../types';
import { dayPlan } from './config';
import { addDays, formatDateKey, isInMonth, weekdayOf, weekdaysLong } from './dates';
import { translate as tr } from '../i18n';
import { buildXlsx, CellStyle, excelDate, rangeRef, Rgb, safeSheetName, Sheet } from './xlsx';

export interface SheetShift {
  full: boolean;   // the only shift of the day, covering all opening hours
  hours: string;   // "05:00 - 15:00"
  ids: string[];
  missing: number; // places still unfilled
}

export interface SheetDay {
  date: string;
  inMonth: boolean;
  closed: boolean;
  label?: string;           // holiday / special-day name
  day: SheetShift | null;   // null = no morning shift that day
  night: SheetShift | null;
  events: string;
  notes: string;            // this date's notes, or the weekly note
  weeklyNote: boolean;      // `notes` is the weekly note
  duty: string;
}

export interface TeamSheet {
  period: string;           // "09.2026"
  title: string;
  weeks: SheetDay[][];
  dayRows: number;          // rows for morning workers (at least 2)
  nightRows: number;
  dutyLabel: string | null; // null = no extra row
}

const toHours = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h + (m || 0) / 60;
};

export const clock = (hours: number): string => {
  const mins = ((Math.round(hours * 60) % 1440) + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
};

export const dutyLabelOf = (notes: SheetNotes): string | null =>
  notes.dutyOff ? null : notes.dutyLabel?.trim() || tr('ts.dutyDefault');

export function buildTeamSheet(version: ScheduleVersion, config: ShiftConfig, notes: SheetNotes): TeamSheet {
  const byDate = new Map(version.schedule.map(d => [d.date, d]));
  const dates = [...byDate.keys()].sort();
  const period = `${String(version.month + 1).padStart(2, '0')}.${version.year}`;
  const monthStart = formatDateKey(new Date(version.year, version.month, 1));
  const monthEnd = formatDateKey(new Date(version.year, version.month + 1, 0));
  // Whole weeks, Sunday to Saturday, covering the month and every saved day
  let from = dates[0] && dates[0] < monthStart ? dates[0] : monthStart;
  let to = dates.length && dates[dates.length - 1] > monthEnd ? dates[dates.length - 1] : monthEnd;
  from = addDays(from, -weekdayOf(from));
  to = addDays(to, 6 - weekdayOf(to));

  const days: SheetDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const d: DailySchedule = byDate.get(date) || { date, dayShift: [], nightShift: [], isPadding: true };
    const plan = dayPlan(config, date);
    const assigned = d.dayShift.length + d.nightShift.length;
    const soloCovered = plan.solo && assigned >= 1;
    const hasDay = plan.req.day > 0 || d.dayShift.length > 0;
    const hasNight = plan.req.night > 0 || d.nightShift.length > 0;
    const start = toHours(plan.timing.startTime);
    const end = start + plan.window;
    const len = (plan.window + 1) / 2; // both shifts: split with a 1-hour overlap
    const both = hasDay && hasNight;
    const shift = (ids: string[], required: number, from: number, until: number): SheetShift => ({
      full: !both,
      hours: `${clock(from)} - ${clock(until)}`,
      ids,
      missing: soloCovered ? 0 : Math.max(0, required - ids.length),
    });
    const note = notes.days[date];
    const weekly = notes.weekly[weekdayOf(date)] || '';
    days.push({
      date,
      inMonth: isInMonth(date, version.year, version.month),
      closed: plan.closed && assigned === 0,
      label: plan.label,
      day: hasDay ? shift(d.dayShift, plan.req.day, start, both ? start + len : end) : null,
      night: hasNight ? shift(d.nightShift, plan.req.night, both ? end - len : start, end) : null,
      events: note?.events || '',
      notes: note?.notes ?? weekly,
      weeklyNote: note?.notes === undefined && !!weekly,
      duty: note?.duty || '',
    });
  }

  const weeks: SheetDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const open = days.filter(d => !d.closed);
  const rowsFor = (pick: (d: SheetDay) => SheetShift | null) =>
    Math.max(2, ...open.map(d => { const s = pick(d); return s ? s.ids.length + s.missing : 0; }));
  return {
    period,
    title: tr('ts.title', { period }),
    weeks,
    dayRows: rowsFor(d => d.day),
    nightRows: rowsFor(d => d.night),
    dutyLabel: dutyLabelOf(notes),
  };
}

// ---------- Excel ----------

// Colors of the manager's own sheet (also used by the Team sheet view)
export const SHEET_COLORS = {
  weekdays: ['DAE9F8', 'C0E6F5', 'FBE2D5', 'C1F0C8', 'CAEDFB', 'F2CEEF', 'DAF2D0'] as Rgb[],
  title: 'F3F3F3',
  corner: 'F2F2F2',
  date: 'E8E8E8',
  duty: 'B6D7A8',
  events: 'FFFF00',
};
const WEEKDAY_FILLS = SHEET_COLORS.weekdays;
const TITLE_FILL = SHEET_COLORS.title;
const CORNER_FILL = SHEET_COLORS.corner;
const DATE_FILL = SHEET_COLORS.date;
const DUTY_FILL = SHEET_COLORS.duty;
const EVENTS_FILL = SHEET_COLORS.events;

const LABEL_COL = 3;   // C
const FIRST_DAY = 4;   // D .. J
const LAST_DAY = FIRST_DAY + 6;
const TITLE_ROW = 3;
const DAY_WIDTH = 12;
// Short one-line values (times, names) are not wrapped
const ONE_LINE: CellStyle = { wrap: false };

export const hexColor = (c: string | undefined): Rgb | null => {
  const m = (c || '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1];
  return h.toUpperCase();
};

// Rough line count of wrapped text in a day column
const lineCount = (text: string, perLine: number): number =>
  text.split('\n').reduce((sum, para) => {
    let lines = 1;
    let used = 0;
    para.split(/\s+/).filter(Boolean).forEach(word => {
      const w = word.length;
      if (used === 0) used = w;
      else if (used + 1 + w <= perLine) used += 1 + w;
      else { lines++; used = w; }
      while (used > perLine) { lines++; used -= perLine; }
    });
    return sum + lines;
  }, 0);

// Font size and row height for a text cell: shrink a little, then grow the row
export const fitText = (text: string, minHeight = 45): { size: number; height: number } => {
  if (!text.trim()) return { size: 11, height: minHeight };
  for (const size of [11, 10, 9]) {
    const lines = lineCount(text, Math.floor(11 * 11 / size));
    if (lines * size * 1.36 <= minHeight) return { size, height: minHeight };
  }
  const lines = lineCount(text, Math.floor(11 * 11 / 9));
  return { size: 9, height: Math.min(409, Math.ceil(lines * 9 * 1.36 + 4)) };
};

export interface SheetPerson { name: string; color: string }

export function teamSheetXlsx(sheet: TeamSheet, nameOf: (id: string) => string, people: SheetPerson[], rtl: boolean): Uint8Array {
  const ws = new Sheet(safeSheetName(sheet.period), rtl);
  const base = { name: 'Calibri', size: 11 };
  const cell = (extra: CellStyle = {}, bold = false, col = FIRST_DAY): CellStyle => ({
    h: 'center', v: 'center', wrap: true,
    ...extra,
    font: { ...base, bold, ...(extra.font || {}) },
    border: {
      left: col === FIRST_DAY ? 'medium' : 'thin',
      right: col === LAST_DAY ? 'medium' : 'thin',
      top: 'thin', bottom: 'thin',
      ...(extra.border || {}),
    },
  });
  const label = (extra: CellStyle = {}): CellStyle => ({
    h: 'center', v: 'center', wrap: true,
    ...extra,
    font: { ...base, bold: true, ...(extra.font || {}) },
    border: { left: 'medium', right: 'medium', top: 'thin', bottom: 'thin', ...(extra.border || {}) },
  });

  ws.widths.set(2, 15);
  ws.widths.set(LABEL_COL, 13.14);
  for (let c = FIRST_DAY; c <= LAST_DAY; c++) ws.widths.set(c, DAY_WIDTH);

  // Title and weekday names
  ws.merge(TITLE_ROW, LABEL_COL, TITLE_ROW, LAST_DAY, sheet.title, {
    font: { name: 'Arial', size: 14, bold: true }, fill: TITLE_FILL, h: 'center', v: 'center',
    border: { left: 'medium', right: 'medium', top: 'medium', bottom: 'medium' },
  });
  ws.heights.set(TITLE_ROW, 22);
  const headRow = TITLE_ROW + 1;
  ws.set(headRow, LABEL_COL, '', label({ fill: CORNER_FILL, border: { top: 'medium', bottom: 'medium' } }));
  weekdaysLong().forEach((name, i) => {
    const c = FIRST_DAY + i;
    ws.set(headRow, c, name, cell({ fill: WEEKDAY_FILLS[i], border: { top: 'medium', bottom: 'medium' } }, true, c));
  });
  ws.heights.set(headRow, 15.75);

  let r = headRow + 1;
  const firstBodyRow = r;
  sheet.weeks.forEach(week => {
    const top = r;
    // Row numbers inside this week's block
    const rows = {
      dates: top,
      dayShift: top + 1,
      dayHours: top + 2,
      dayWorkers: top + 3,
      duty: top + 3 + sheet.dayRows,
    };
    const afterDuty = rows.duty + (sheet.dutyLabel === null ? 0 : 1);
    const nightShift = afterDuty;
    const nightHours = afterDuty + 1;
    const nightWorkers = afterDuty + 2;
    const events = nightWorkers + sheet.nightRows;
    const notes = events + 1;

    // Labels
    ws.set(rows.dates, LABEL_COL, tr('ts.days'), label({ fill: DATE_FILL, border: { top: 'medium' } }));
    ws.set(rows.dayShift, LABEL_COL, tr('ts.shift'), label());
    ws.set(rows.dayHours, LABEL_COL, tr('ts.hours'), label());
    ws.merge(rows.dayWorkers, LABEL_COL, rows.dayWorkers + sheet.dayRows - 1, LABEL_COL, tr('ts.dayTeam'), label());
    if (sheet.dutyLabel !== null) ws.set(rows.duty, LABEL_COL, sheet.dutyLabel + ':', label({ fill: DUTY_FILL }));
    ws.set(nightShift, LABEL_COL, tr('ts.shift'), label());
    ws.set(nightHours, LABEL_COL, tr('ts.hours'), label());
    ws.merge(nightWorkers, LABEL_COL, nightWorkers + sheet.nightRows - 1, LABEL_COL, tr('ts.nightTeam'), label());
    ws.set(events, LABEL_COL, tr('ts.events'), label({ fill: EVENTS_FILL }));
    ws.set(notes, LABEL_COL, tr('ts.notes'), label({ border: { bottom: 'medium' } }));

    let eventsHeight = 45;
    let notesHeight = 45;
    week.forEach((day, i) => {
      const c = FIRST_DAY + i;
      ws.set(rows.dates, c, excelDate(day.date), cell({ fill: DATE_FILL, numFmt: 'dd"/"mm', border: { top: 'medium' } }, true, c));

      if (!day.closed) {
        const block = (s: SheetShift | null, shiftRow: number, hoursRow: number, firstRow: number, count: number, kind: 'day' | 'night') => {
          ws.set(shiftRow, c, s ? (s.full ? tr('ts.fullShift') : kind === 'day' ? tr('ts.dayShift') : tr('ts.nightShift')) : '', cell(ONE_LINE, true, c));
          ws.set(hoursRow, c, s ? s.hours : '', cell(ONE_LINE, true, c));
          for (let k = 0; k < count; k++) ws.set(firstRow + k, c, s?.ids[k] ? nameOf(s.ids[k]) : '', cell(ONE_LINE, false, c));
        };
        block(day.day, rows.dayShift, rows.dayHours, rows.dayWorkers, sheet.dayRows, 'day');
        if (sheet.dutyLabel !== null) ws.set(rows.duty, c, day.duty, cell({ ...ONE_LINE, fill: DUTY_FILL }, false, c));
        block(day.night, nightShift, nightHours, nightWorkers, sheet.nightRows, 'night');
      } else if (i === 0 || !week[i - 1].closed || week[i - 1].label !== day.label) {
        // One block for a run of closed days with the same name
        let span = 1;
        while (i + span < 7 && week[i + span].closed && week[i + span].label === day.label) span++;
        const text = day.label || tr('ts.closed');
        const longest = Math.max(...text.split(/\s+/).map(w => w.length), 1);
        const size = Math.max(12, Math.min(27, Math.floor((span * 80) / (longest * 0.8 * 1.33))));
        const lastRow = nightWorkers + sheet.nightRows - 1;
        const style = cell({ font: { size }, border: { right: c + span - 1 === LAST_DAY ? 'medium' : 'thin' } }, true, c);
        ws.merge(rows.dayShift, c, lastRow, c + span - 1, text, style);
      }

      const ev = fitText(day.events);
      eventsHeight = Math.max(eventsHeight, ev.height);
      ws.set(events, c, day.events, cell({ fill: EVENTS_FILL, font: { size: ev.size } }, true, c));
      const noteText = [day.closed ? '' : day.label || '', day.notes].filter(Boolean).join('\n');
      const nt = fitText(noteText);
      notesHeight = Math.max(notesHeight, nt.height);
      ws.set(notes, c, noteText, cell({ font: { size: nt.size }, border: { bottom: 'medium' } }, true, c));
    });
    ws.heights.set(events, eventsHeight);
    ws.heights.set(notes, notesHeight);
    for (let row = top; row < events; row++) if (!ws.heights.has(row)) ws.heights.set(row, 15.75);
    r = notes + 1;
  });

  // Each worker's name is colored wherever it appears, also after edits in Excel
  const range = rangeRef(firstBodyRow, FIRST_DAY, r - 1, LAST_DAY);
  const seen = new Set<string>();
  people.forEach(p => {
    const name = p.name.trim();
    const fill = hexColor(p.color);
    if (!name || !fill || seen.has(name)) return;
    seen.add(name);
    ws.highlights.push({ range, text: name, fill });
  });

  ws.print = { area: [TITLE_ROW, LABEL_COL, r - 1, LAST_DAY], fitWidth: 1, fitHeight: 1, gridLines: true, centerH: true, margin: 0.25 };
  return buildXlsx([ws], { title: sheet.title });
}

// ASCII only: some browsers replace other file names with a bare "download"
export const teamSheetFileName = (sheet: TeamSheet): string => `Shift schedule ${sheet.period}.xlsx`;

