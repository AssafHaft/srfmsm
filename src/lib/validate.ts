// Checks any schedule (generated or hand-edited) against the rules and
// workers' availability. The generator never produces errors other than
// slots it could not fill; manual edits can, and are flagged here.
import { DailySchedule, DayAssignmentMap, Employee, ShiftConfig, ShiftType, WorkerPreference } from '../types';
import { addDays } from './dates';
import { availabilityOn, dayPlan, shiftCap, workRules } from './config';
import { translate as tr } from '../i18n';

export type IssueKind =
  | 'empty'
  | 'double'
  | 'unavailable'
  | 'shiftType'
  | 'dayAfterNight'
  | 'streak'
  | 'rest'
  | 'mixedRun'
  | 'cap'
  | 'prefersOff'
  | 'prefersType'
  | 'inactive'
  | 'closedDay';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  date: string;
  empId?: string;
  shift?: ShiftType;
  kind: IssueKind;
  severity: Severity;
  message: string;
}

export interface ValidationResult {
  issues: Issue[];
  byDate: Map<string, Issue[]>;
  byCell: Map<string, Issue[]>; // `${date}|${empId}`
  errors: number;
  warnings: number;
  emptySlots: number; // unfilled slots inside the month
}

export const cellKey = (date: string, empId: string) => `${date}|${empId}`;

export function validateSchedule(
  schedule: DailySchedule[],
  employees: Employee[],
  config: ShiftConfig,
  history?: DayAssignmentMap
): ValidationResult {
  const issues: Issue[] = [];
  const rules = workRules(config);
  const empById = new Map(employees.map(e => [e.id, e]));
  let emptySlots = 0;

  // --- Coverage and per-day checks ---
  schedule.forEach(day => {
    const plan = dayPlan(config, day.date);
    const d = day.dayShift.length;
    const n = day.nightShift.length;
    const sev: Severity = day.isPadding ? 'warning' : 'error';
    if (plan.solo) {
      if (d + n < 1) {
        issues.push({ date: day.date, shift: plan.req.night === 1 ? ShiftType.NIGHT : ShiftType.DAY, kind: 'empty', severity: sev, message: tr('v.soloEmpty') });
        if (!day.isPadding) emptySlots++;
      }
    } else {
      const md = plan.req.day - d;
      const mn = plan.req.night - n;
      if (md > 0) {
        issues.push({ date: day.date, shift: ShiftType.DAY, kind: 'empty', severity: sev, message: tr('v.daySlots', { count: md }) });
        if (!day.isPadding) emptySlots += md;
      }
      if (mn > 0) {
        issues.push({ date: day.date, shift: ShiftType.NIGHT, kind: 'empty', severity: sev, message: tr('v.nightSlots', { count: mn }) });
        if (!day.isPadding) emptySlots += mn;
      }
    }
    if (plan.closed && d + n > 0) {
      issues.push({ date: day.date, kind: 'closedDay', severity: 'warning', message: tr('v.closedDay', { label: plan.label ? ` (${plan.label})` : '' }) });
    }
    const seen = new Set<string>();
    [...day.dayShift, ...day.nightShift].forEach(id => {
      if (seen.has(id)) {
        issues.push({ date: day.date, empId: id, kind: 'double', severity: 'error', message: tr('v.double') });
      }
      seen.add(id);
    });
  });

  // --- Per-worker sequence checks ---
  const firstDate = schedule[0]?.date;
  const histLen = rules.maxConsecutive + rules.minRest + 7;
  const workerIds = new Set<string>();
  schedule.forEach(d => [...d.dayShift, ...d.nightShift].forEach(id => workerIds.add(id)));

  workerIds.forEach(id => {
    const e = empById.get(id);
    if (!e) return; // removed worker: nothing to check against
    let prev: ShiftType | null = null;
    let run = 0;
    let lastWorkIdx = -Infinity;
    // history before the grid
    if (history && firstDate) {
      for (let i = histLen; i >= 1; i--) {
        const h = history[addDays(firstDate, -i)];
        const k = h?.dayShift.includes(id) ? ShiftType.DAY : h?.nightShift.includes(id) ? ShiftType.NIGHT : null;
        if (k) { run = prev ? run + 1 : 1; lastWorkIdx = -i; } else run = 0;
        prev = k;
      }
    }
    const cap = shiftCap(e, config);
    let monthShifts = 0;
    schedule.forEach((day, g) => {
      const k = day.dayShift.includes(id) ? ShiftType.DAY : day.nightShift.includes(id) ? ShiftType.NIGHT : null;
      if (!k) { run = 0; prev = null; return; }
      const plan = dayPlan(config, day.date);
      const push = (kind: IssueKind, severity: Severity, message: string) =>
        issues.push({ date: day.date, empId: id, shift: k, kind, severity, message });

      const av = availabilityOn(e, day.date);
      if (av === 0) push('unavailable', 'error', tr('v.unavailable', { name: e.name }));
      if (av === 2) push('prefersOff', 'info', tr('v.prefersOff', { name: e.name }));
      if (k === ShiftType.DAY && e.preference === WorkerPreference.NIGHT_ONLY) push('shiftType', 'error', tr('v.nightsOnly', { name: e.name }));
      if (k === ShiftType.NIGHT && e.preference === WorkerPreference.DAY_ONLY) push('shiftType', 'error', tr('v.daysOnly', { name: e.name }));
      if (k === ShiftType.DAY && e.preference === WorkerPreference.PREFERS_NIGHT) push('prefersType', 'info', tr('v.prefersNight', { name: e.name }));
      if (k === ShiftType.NIGHT && e.preference === WorkerPreference.PREFERS_DAY) push('prefersType', 'info', tr('v.prefersDay', { name: e.name }));
      if (e.active === false) push('inactive', 'info', tr('v.inactive', { name: e.name }));

      if (prev === ShiftType.NIGHT && (k === ShiftType.DAY || plan.solo)) {
        push('dayAfterNight', 'error', plan.solo && k === ShiftType.NIGHT ? tr('v.fullDayAfterNight') : tr('v.dayAfterNight'));
      } else if (rules.blockMode && prev && prev !== k) {
        push('mixedRun', 'warning', tr('v.mixedRun'));
      }
      if (prev) run++;
      else {
        const gap = g - lastWorkIdx - 1;
        if (lastWorkIdx > -Infinity && gap < rules.minRest) {
          push('rest', 'error', tr('v.rest', { count: gap, min: rules.minRest }));
        }
        run = 1;
      }
      if (run > rules.maxConsecutive) {
        push('streak', 'error', tr('v.streak', { run, max: rules.maxConsecutive }));
      }
      if (!day.isPadding) {
        monthShifts++;
        if (monthShifts === cap + 1) push('cap', 'error', tr('v.cap', { name: e.name, cap }));
      }
      lastWorkIdx = g;
      prev = k;
    });
  });

  const byDate = new Map<string, Issue[]>();
  const byCell = new Map<string, Issue[]>();
  let errors = 0, warnings = 0;
  issues.forEach(i => {
    if (i.severity === 'error') errors++;
    else if (i.severity === 'warning') warnings++;
    if (!byDate.has(i.date)) byDate.set(i.date, []);
    byDate.get(i.date)!.push(i);
    if (i.empId) {
      const key = cellKey(i.date, i.empId);
      if (!byCell.has(key)) byCell.set(key, []);
      byCell.get(key)!.push(i);
    }
  });
  return { issues, byDate, byCell, errors, warnings, emptySlots };
}


// Rule hints for putting `e` on `shift` on `date` (used by the assignment
// picker before the change is made).
export function assignmentHints(
  schedule: DailySchedule[],
  e: Employee,
  date: string,
  shift: ShiftType,
  config: ShiftConfig,
  history?: DayAssignmentMap,
  employees: Employee[] = [e]
): Issue[] {
  const trial = schedule.map(d => {
    if (d.date !== date) return d;
    const day = d.dayShift.filter(x => x !== e.id);
    const night = d.nightShift.filter(x => x !== e.id);
    return shift === ShiftType.DAY
      ? { ...d, dayShift: [...day, e.id], nightShift: night }
      : { ...d, dayShift: day, nightShift: [...night, e.id] };
  });
  const before = validateSchedule(schedule, employees, config, history);
  const after = validateSchedule(trial, employees, config, history);
  const seen = new Set(before.issues.filter(i => i.empId === e.id).map(i => `${i.date}|${i.kind}`));
  return after.issues.filter(i => i.empId === e.id && i.kind !== 'empty' && !seen.has(`${i.date}|${i.kind}`));
}
