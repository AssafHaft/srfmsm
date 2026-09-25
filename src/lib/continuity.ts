// Start-of-month continuity. The first grid week overlaps the end of the
// previous month; those days were already published with the previous
// schedule, so they are kept as-is ("carried"), and the days before them are
// used as history for the rest/streak rules.
import { DayAssignmentMap, Employee, MonthSetup, ScheduleVersion, ShiftConfig, WorkerPreference } from '../types';
import { formatShortDate, gridKeys, monthLabel, shiftMonth } from './dates';
import { computeStats } from './stats';
import type { CarryOver } from './engine/model';
import { translate as tr } from '../i18n';

export interface Continuity {
  source: 'version' | 'custom' | 'none';
  label: string;
  versionId?: string;
  history: DayAssignmentMap; // days before the grid
  carried: DayAssignmentMap; // grid days kept exactly as given
  // Leftover imbalance from last month's schedule, evened out this month
  carry?: Record<string, CarryOver>;
}

export const NO_CONTINUITY: Continuity = { source: 'none', label: '', history: {}, carried: {} };

// Versions of the month before (year, month): final first, then newest.
export function previousMonthVersions(versions: ScheduleVersion[], year: number, month: number): ScheduleVersion[] {
  const prev = shiftMonth(year, month, -1);
  return versions
    .filter(v => v.year === prev.year && v.month === prev.month)
    .sort((a, b) => (Number(!!b.final) - Number(!!a.final)) || b.timestamp - a.timestamp);
}

export function splitContext(entries: DayAssignmentMap, year: number, month: number): { history: DayAssignmentMap; carried: DayAssignmentMap } {
  const grid = gridKeys(year, month);
  const first = grid[0];
  const last = grid[grid.length - 1];
  const history: DayAssignmentMap = {};
  const carried: DayAssignmentMap = {};
  Object.entries(entries).forEach(([date, a]) => {
    const clean = { dayShift: [...a.dayShift], nightShift: [...a.nightShift] };
    if (date < first) history[date] = clean;
    else if (date <= last) carried[date] = clean;
  });
  return { history, carried };
}

export function resolveContinuity(
  versions: ScheduleVersion[],
  year: number,
  month: number,
  setup: MonthSetup | undefined,
  employees: Employee[] = [],
  config?: ShiftConfig
): Continuity {
  const mode = setup?.continuity ?? 'auto';
  if (mode === 'none') return NO_CONTINUITY;

  if (mode === 'custom') {
    const entries = setup?.custom || {};
    if (Object.keys(entries).length === 0) return NO_CONTINUITY;
    const { history, carried } = splitContext(entries, year, month);
    (setup?.released || []).forEach(d => { delete carried[d]; });
    return { source: 'custom', label: setup?.customLabel || tr('cont.manual'), history, carried };
  }

  const prev = previousMonthVersions(versions, year, month)[0];
  if (!prev) return NO_CONTINUITY;
  // The previous schedule's days before this grid become history; the days
  // that overlap this grid (its last week) are carried over as-is.
  const entries: DayAssignmentMap = {};
  prev.schedule.forEach(d => {
    entries[d.date] = { dayShift: d.dayShift, nightShift: d.nightShift };
  });
  const { history, carried } = splitContext(entries, year, month);
  (setup?.released || []).forEach(d => { delete carried[d]; });
  const name = `${monthLabel(prev.year, prev.month)} · ${prev.name.split('·').pop()?.trim() || 'v1'}${prev.final ? ` (${tr('cont.final')})` : ''}`;
  const carry = config ? carryFromVersion(prev, employees, config) : undefined;
  return { source: 'version', label: name, versionId: prev.id, history, carried, carry };
}

// How far each worker ended up from their fair share last month
export function carryFromVersion(prev: ScheduleVersion, employees: Employee[], config: ShiftConfig): Record<string, CarryOver> | undefined {
  if (!prev.targets) return undefined;
  const cfg = prev.configSnapshot || config;
  const ids = employees.map(e => e.id);
  const stats = computeStats(prev.schedule, cfg, ids, prev.targets);
  const either = employees.filter(e => e.preference === WorkerPreference.EITHER && stats[e.id]?.shifts > 0);
  const sd = either.reduce((a, e) => a + stats[e.id].day, 0);
  const ss = either.reduce((a, e) => a + stats[e.id].shifts, 0);
  const f = ss > 0 ? sd / ss : 0;
  const out: Record<string, CarryOver> = {};
  employees.forEach(e => {
    const s = stats[e.id];
    const t = prev.targets?.[e.id];
    if (!s || !t) return;
    out[e.id] = {
      shifts: s.shifts - t.shifts,
      weekend: s.weekend - t.weekend,
      day: e.preference === WorkerPreference.EITHER ? s.day - f * s.shifts : 0,
    };
  });
  return out;
}

export function describeCarried(c: Continuity): string {
  const dates = Object.keys(c.carried).sort();
  if (dates.length === 0) return tr('cont.noOverlap');
  const range = dates.length === 1 ? formatShortDate(dates[0]) : `${formatShortDate(dates[0])} – ${formatShortDate(dates[dates.length - 1])}`;
  return tr('cont.keptAsIs', { range });
}
