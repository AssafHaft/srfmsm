// Builds a new schedule version: works out what must be kept (carried-over
// days, locked days, pinned shifts), runs the engine for the rest, and
// packages the result.
import { DailySchedule, DayAssignmentMap, Employee, ScheduleVersion, ShiftConfig } from '../types';
import { runEngine } from './engine';
import type { Continuity } from './continuity';
import { legacyStats } from './stats';
import { addDays, gridKeys, monthLabel } from './dates';
import { translate as tr } from '../i18n';

export interface GenerateOptions {
  employees: Employee[];
  config: ShiftConfig;
  year: number;
  month: number;
  // The version currently open for this month: its locked days and pinned
  // shifts are kept.
  base?: ScheduleVersion | null;
  continuity: Continuity;
  variation: number;
  seed?: number;
}

export interface KeptParts {
  locked: DayAssignmentMap;
  pins: DayAssignmentMap;
  carriedDates: Set<string>;
}

export function keptParts(opts: Pick<GenerateOptions, 'employees' | 'year' | 'month' | 'base' | 'continuity'>): KeptParts {
  const { employees, year, month, base, continuity } = opts;
  const known = new Set(employees.map(e => e.id));
  const clean = (ids: string[]) => ids.filter(id => known.has(id));
  const baseDays = new Map<string, DailySchedule>();
  if (base && base.year === year && base.month === month) base.schedule.forEach(d => baseDays.set(d.date, d));

  const locked: DayAssignmentMap = {};
  const pins: DayAssignmentMap = {};
  const carriedDates = new Set<string>();

  gridKeys(year, month).forEach(date => {
    const b = baseDays.get(date);
    const carried = continuity.carried[date];
    // Carried days use the previous schedule's latest content, unless the
    // manager locked their own version of that day.
    if (carried && !(b?.locked && !b.carried)) {
      locked[date] = { dayShift: clean(carried.dayShift), nightShift: clean(carried.nightShift) };
      carriedDates.add(date);
      return;
    }
    if (b?.locked) {
      locked[date] = { dayShift: clean(b.dayShift), nightShift: clean(b.nightShift) };
      return;
    }
    if (b?.pinned?.length) {
      const p = new Set(b.pinned);
      const dayShift = b.dayShift.filter(id => p.has(id) && known.has(id));
      const nightShift = b.nightShift.filter(id => p.has(id) && known.has(id));
      if (dayShift.length + nightShift.length > 0) pins[date] = { dayShift, nightShift };
    }
  });
  return { locked, pins, carriedDates };
}

export function generateVersion(opts: GenerateOptions): ScheduleVersion {
  const { employees, config, year, month, continuity } = opts;
  const { locked, pins, carriedDates } = keptParts(opts);
  const active = employees.filter(e => e.active !== false);

  const result = runEngine({
    employees: active,
    year,
    month,
    config,
    history: continuity.history,
    locked,
    pins,
    carry: continuity.carry,
    seed: opts.seed,
  });

  const schedule: DailySchedule[] = result.days.map(d => {
    const day: DailySchedule = {
      date: d.date,
      dayShift: d.dayShift,
      nightShift: d.nightShift,
      isPadding: !d.inMonth,
    };
    if (locked[d.date]) day.locked = true;
    if (carriedDates.has(d.date)) day.carried = true;
    const p = pins[d.date];
    if (p) day.pinned = [...p.dayShift, ...p.nightShift];
    return day;
  });

  // Keep two weeks of history for rule checks when viewing this version
  const first = schedule[0]?.date;
  const history: DayAssignmentMap = {};
  if (first) {
    const from = addDays(first, -14);
    Object.entries(continuity.history).forEach(([date, a]) => {
      if (date >= from && date < first) history[date] = a;
    });
  }

  const people: Record<string, { name: string; color: string }> = {};
  employees.forEach(e => { people[e.id] = { name: e.name, color: e.color }; });

  return {
    id: newId(),
    timestamp: Date.now(),
    name: tr('versionName', { month: monthLabel(year, month, 'short'), n: opts.variation }),
    month,
    year,
    configSnapshot: JSON.parse(JSON.stringify(config)),
    schedule,
    stats: legacyStats(schedule, employees.map(e => e.id)),
    targets: result.targets,
    history,
    continuityLabel: continuity.source === 'none' ? undefined : continuity.label,
    people,
    seed: result.seed,
  };
}

export const newId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const versionTitle = (v: ScheduleVersion): string => v.name || monthLabel(v.year, v.month);
