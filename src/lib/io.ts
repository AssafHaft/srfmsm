// Files in and out: schedule CSV/Excel export, CSV import, JSON backups.
import { DailySchedule, DayAssignmentMap, Employee, MonthSetup, ScheduleVersion, ShiftConfig } from '../types';
import { addDays, formatDateKey, isDateKey, parseDateKey, weekdayShort } from './dates';
import { translate as tr } from '../i18n';
import { normalizeConfig, normalizeEmployee } from './config';
import { legacyStats } from './stats';

// ---------- Download helper ----------

export function downloadFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`;

const widths = (schedule: DailySchedule[]) => ({
  day: Math.max(1, ...schedule.map(s => s.dayShift.length)),
  night: Math.max(1, ...schedule.map(s => s.nightShift.length)),
});

// Same column layout as earlier builds, so old and new exports import alike.
export function scheduleToCSV(version: ScheduleVersion, nameOf: (id: string) => string): string {
  const w = widths(version.schedule);
  const headers = ['Date', 'Is Padding'];
  for (let i = 0; i < w.day; i++) headers.push(`Day Shift Worker ${i + 1}`);
  for (let i = 0; i < w.night; i++) headers.push(`Night Shift Worker ${i + 1}`);
  const lines = version.schedule.map(row => {
    const cells = [row.date, row.isPadding ? 'Yes' : 'No'];
    for (let i = 0; i < w.day; i++) cells.push(csvCell(row.dayShift[i] ? nameOf(row.dayShift[i]) : ''));
    for (let i = 0; i < w.night; i++) cells.push(csvCell(row.nightShift[i] ? nameOf(row.nightShift[i]) : ''));
    return cells.join(',');
  });
  // BOM so Excel opens Hebrew names correctly
  return '﻿' + headers.join(',') + '\n' + lines.join('\n') + '\n';
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface SummaryRow {
  name: string;
  shifts: number;
  day: number;
  night: number;
  weekend: number;
  hours: number;
  pay: number;
}

export function scheduleToExcelHtml(version: ScheduleVersion, nameOf: (id: string) => string, summary: SummaryRow[]): string {
  const w = widths(version.schedule);
  const th = (t: string, bg: string) => `<th style="background:${bg};border:1px solid #94a3b8;padding:4px">${escapeHtml(t)}</th>`;
  const td = (t: string, bg: string) => `<td style="background:${bg};border:1px solid #cbd5e1;padding:4px">${escapeHtml(t)}</td>`;
  let head = th(tr('x.date'), '#e2e8f0') + th(tr('x.weekday'), '#e2e8f0');
  for (let i = 0; i < w.day; i++) head += th(tr('x.dayWorker', { n: i + 1 }), '#fef3c7');
  for (let i = 0; i < w.night; i++) head += th(tr('x.nightWorker', { n: i + 1 }), '#e0e7ff');
  const rows = version.schedule.map(row => {
    const bg = row.isPadding ? '#f1f5f9' : '#ffffff';
    let cells = td(row.date + (row.isPadding ? ` (${tr('x.otherMonth')})` : ''), bg) + td(weekdayShort(parseDateKey(row.date).getDay()), bg);
    for (let i = 0; i < w.day; i++) cells += td(row.dayShift[i] ? nameOf(row.dayShift[i]) : '', bg);
    for (let i = 0; i < w.night; i++) cells += td(row.nightShift[i] ? nameOf(row.nightShift[i]) : '', bg);
    return `<tr>${cells}</tr>`;
  }).join('');
  const sumHead = (['x.worker', 'x.shifts', 'x.day', 'x.night', 'x.weekend', 'x.hours', 'x.pay'] as const).map(k => th(tr(k), '#e2e8f0')).join('');
  const sumRows = summary.map(r => `<tr>${[r.name, r.shifts, r.day, r.night, r.weekend, r.hours.toFixed(1), r.pay.toFixed(2)].map(v => td(String(v), '#ffffff')).join('')}</tr>`).join('');
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>
<body style="font-family:Arial,sans-serif" dir="${tr('dir')}">
<h3>${escapeHtml(version.name)}</h3>
<table style="border-collapse:collapse"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
<br/>
<h3>${escapeHtml(tr('x.summary'))}</h3>
<table style="border-collapse:collapse"><thead><tr>${sumHead}</tr></thead><tbody>${sumRows}</tbody></table>
</body></html>`;
}

// ---------- CSV import (date-aware) ----------

const splitCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';' || c === '\t') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
};

// Parses a date written as YYYY-MM-DD, DD/MM/YYYY or MM/DD/YYYY.
const dateCandidates = (raw: string): { dmy?: string; mdy?: string; iso?: string } => {
  const s = raw.trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return { iso: toKey(+iso[1], +iso[2], +iso[3]) };
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (!m) return {};
  const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
  return { dmy: toKey(y, +m[2], +m[1]), mdy: toKey(y, +m[1], +m[2]) };
};

const toKey = (y: number, m: number, d: number): string | undefined => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return undefined;
  return formatDateKey(dt);
};

export interface CsvImportResult {
  entries: DayAssignmentMap;
  days: number;
  first?: string;
  last?: string;
  unmatched: string[];
}

export function parseScheduleCSV(text: string, employees: Employee[]): CsvImportResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error(tr('csv.noRows'));
  const headers = splitCsvLine(lines[0]).map(h => h.toLowerCase());
  const dayCols: number[] = [];
  const nightCols: number[] = [];
  let dateCol = headers.findIndex(h => h === 'date' || h.includes('date') || h.includes('תאריך'));
  headers.forEach((h, i) => {
    if (/day (shift )?worker|morning/.test(h)) dayCols.push(i);
    else if (/night (shift )?worker|evening/.test(h)) nightCols.push(i);
  });
  if (dayCols.length + nightCols.length === 0) throw new Error(tr('csv.noColumns'));
  const rows = lines.slice(1).map(splitCsvLine);
  if (dateCol < 0) dateCol = 0;

  // Decide between DD/MM and MM/DD by which one yields valid, consecutive dates
  const cands = rows.map(r => dateCandidates(r[dateCol] || ''));
  const score = (pick: (c: ReturnType<typeof dateCandidates>) => string | undefined) => {
    const keys = cands.map(pick);
    let ok = keys.filter(Boolean).length;
    for (let i = 1; i < keys.length; i++) if (keys[i] && keys[i - 1] && keys[i] === addDays(keys[i - 1]!, 1)) ok++;
    return { keys, ok };
  };
  const dmy = score(c => c.iso || c.dmy);
  const mdy = score(c => c.iso || c.mdy);
  const keys = (mdy.ok > dmy.ok ? mdy : dmy).keys;
  if (keys.filter(Boolean).length === 0) throw new Error(tr('csv.noDates'));

  const byName = new Map(employees.map(e => [normalizeName(e.name), e.id]));
  const unmatched = new Set<string>();
  const entries: DayAssignmentMap = {};
  rows.forEach((r, i) => {
    const date = keys[i];
    if (!date || !isDateKey(date)) return;
    const pick = (cols: number[]) => cols
      .map(c => (r[c] || '').trim())
      .filter(Boolean)
      .map(name => {
        const id = byName.get(normalizeName(name));
        if (!id) unmatched.add(name);
        return id;
      })
      .filter((id): id is string => !!id);
    entries[date] = { dayShift: pick(dayCols), nightShift: pick(nightCols) };
  });
  const dates = Object.keys(entries).sort();
  return { entries, days: dates.length, first: dates[0], last: dates[dates.length - 1], unmatched: [...unmatched] };
}

const normalizeName = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

// ---------- Backup ----------

export interface AppData {
  employees: Employee[];
  config: ShiftConfig;
  versions: ScheduleVersion[];
  selectedVersionId: string | null;
  monthSetups: Record<string, MonthSetup>;
}

export function buildBackup(data: AppData): string {
  return JSON.stringify({ app: 'ShiftMaster', backupVersion: 2, exportedAt: new Date().toISOString(), ...data }, null, 2);
}

export function parseBackup(text: string): AppData & { exportedAt?: string } {
  const data = JSON.parse(text);
  if (data?.app !== 'ShiftMaster' || !Array.isArray(data.employees) || !data.config || !Array.isArray(data.versions)) {
    throw new Error(tr('backup.invalid'));
  }
  return {
    employees: normalizeEmployees(data.employees),
    config: normalizeConfig(data.config),
    versions: normalizeVersions(data.versions),
    selectedVersionId: typeof data.selectedVersionId === 'string' ? data.selectedVersionId : null,
    monthSetups: normalizeMonthSetups(data.monthSetups),
    exportedAt: data.exportedAt,
  };
}

export const normalizeEmployees = (raw: unknown): Employee[] =>
  Array.isArray(raw) ? raw.map((e, i) => normalizeEmployee(e, i)) : [];

const idList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

const normalizeDayMap = (raw: any): DayAssignmentMap => {
  const out: DayAssignmentMap = {};
  if (raw && typeof raw === 'object') {
    Object.entries(raw).forEach(([k, v]: [string, any]) => {
      if (isDateKey(k)) out[k] = { dayShift: idList(v?.dayShift), nightShift: idList(v?.nightShift) };
    });
  }
  return out;
};

export function normalizeVersions(raw: unknown): ScheduleVersion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(v => v && Array.isArray(v.schedule) && Number.isInteger(v.month) && Number.isInteger(v.year))
    .map((v: any): ScheduleVersion => {
      const schedule: DailySchedule[] = v.schedule
        .filter((d: any) => d && isDateKey(d.date))
        .map((d: any) => {
          const day: DailySchedule = { date: d.date, dayShift: idList(d.dayShift), nightShift: idList(d.nightShift) };
          if (d.isPadding) day.isPadding = true;
          if (d.locked) day.locked = true;
          if (d.carried) day.carried = true;
          const pinned = idList(d.pinned);
          if (pinned.length) day.pinned = pinned;
          return day;
        });
      const ids = new Set<string>();
      schedule.forEach(d => [...d.dayShift, ...d.nightShift].forEach(id => ids.add(id)));
      return {
        id: typeof v.id === 'string' ? v.id : String(v.id ?? Math.random()),
        timestamp: typeof v.timestamp === 'number' ? v.timestamp : Date.now(),
        name: typeof v.name === 'string' ? v.name : 'Schedule',
        month: v.month,
        year: v.year,
        configSnapshot: v.configSnapshot ? normalizeConfig(v.configSnapshot) : undefined,
        schedule,
        stats: v.stats && typeof v.stats === 'object' ? v.stats : legacyStats(schedule, [...ids]),
        final: !!v.final || undefined,
        note: typeof v.note === 'string' ? v.note : undefined,
        targets: v.targets && typeof v.targets === 'object' ? v.targets : undefined,
        history: v.history ? normalizeDayMap(v.history) : undefined,
        continuityLabel: typeof v.continuityLabel === 'string' ? v.continuityLabel : undefined,
        people: v.people && typeof v.people === 'object' ? v.people : undefined,
        seed: typeof v.seed === 'number' ? v.seed : undefined,
      };
    });
}

export function normalizeMonthSetups(raw: unknown): Record<string, MonthSetup> {
  const out: Record<string, MonthSetup> = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.entries(raw as Record<string, any>).forEach(([k, v]) => {
    if (!/^\d{4}-\d{2}$/.test(k) || !v || typeof v !== 'object') return;
    const s: MonthSetup = {};
    if (v.continuity === 'auto' || v.continuity === 'custom' || v.continuity === 'none') s.continuity = v.continuity;
    if (v.custom) s.custom = normalizeDayMap(v.custom);
    if (typeof v.customLabel === 'string') s.customLabel = v.customLabel;
    const released = Array.isArray(v.released) ? v.released.filter(isDateKey) : [];
    if (released.length) s.released = released;
    out[k] = s;
  });
  return out;
}

// WhatsApp-friendly text of the month, one line per day
export function scheduleToText(version: ScheduleVersion, nameOf: (id: string) => string): string {
  const lines: string[] = [version.name, ''];
  version.schedule.forEach(d => {
    if (d.isPadding) return;
    const dt = parseDateKey(d.date);
    const label = `${weekdayShort(dt.getDay())} ${dt.getDate()}/${dt.getMonth() + 1}`;
    const day = d.dayShift.map(nameOf).join(', ') || '—';
    const night = d.nightShift.map(nameOf).join(', ') || '—';
    lines.push(`${label}: ☀️ ${day} | 🌙 ${night}`);
  });
  return lines.join('\n');
}
