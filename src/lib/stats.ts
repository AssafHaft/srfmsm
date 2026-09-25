// Per-worker figures derived from a schedule (never stored separately, so
// manual edits are always reflected).
import { DailySchedule, EmployeeStats, ShiftConfig, WorkerTarget } from '../types';
import { dayPlan, splitShiftHours } from './config';

export interface WorkerStats {
  shifts: number;
  day: number;
  night: number;
  hours: number;
  weekend: number;
  longestStreak: number;
  singles: number; // isolated single work days
  target?: WorkerTarget;
}

// Hours each person works on a day: split shifts share the window with a
// 1-hour overlap; when only one shift is staffed it covers the whole window.
export const hoursOnDay = (config: ShiftConfig, day: DailySchedule): number => {
  const plan = dayPlan(config, day.date);
  return day.dayShift.length > 0 && day.nightShift.length > 0 ? splitShiftHours(plan.window) : plan.window;
};

export function computeStats(
  schedule: DailySchedule[],
  config: ShiftConfig,
  ids: string[],
  targets?: Record<string, WorkerTarget>
): Record<string, WorkerStats> {
  const out: Record<string, WorkerStats> = {};
  const idSet = new Set(ids);
  schedule.forEach(d => [...d.dayShift, ...d.nightShift].forEach(id => idSet.add(id)));
  idSet.forEach(id => {
    out[id] = { shifts: 0, day: 0, night: 0, hours: 0, weekend: 0, longestStreak: 0, singles: 0, target: targets?.[id] };
  });
  const hours = schedule.map(d => hoursOnDay(config, d));
  const premium = schedule.map(d => dayPlan(config, d.date).premium);

  idSet.forEach(id => {
    const s = out[id];
    let run = 0;
    schedule.forEach((d, i) => {
      const isDay = d.dayShift.includes(id);
      const isNight = !isDay && d.nightShift.includes(id);
      if (!isDay && !isNight) { run = 0; return; }
      run++;
      s.longestStreak = Math.max(s.longestStreak, run);
      const prevWorked = i > 0 && (schedule[i - 1].dayShift.includes(id) || schedule[i - 1].nightShift.includes(id));
      const nextWorked = i + 1 < schedule.length && (schedule[i + 1].dayShift.includes(id) || schedule[i + 1].nightShift.includes(id));
      if (!prevWorked && !nextWorked && i + 1 < schedule.length) s.singles++;
      if (d.isPadding) return;
      s.shifts++;
      if (isDay) s.day++; else s.night++;
      s.hours += hours[i];
      if (premium[i]) s.weekend++;
    });
  });
  return out;
}

// Stats in the shape older builds stored on each version
export function legacyStats(schedule: DailySchedule[], ids: string[]): Record<string, EmployeeStats> {
  const out: Record<string, EmployeeStats> = {};
  ids.forEach(id => {
    let total = 0, day = 0, night = 0, longest = 0, run = 0;
    schedule.forEach(d => {
      const isDay = d.dayShift.includes(id);
      const worked = isDay || d.nightShift.includes(id);
      run = worked ? run + 1 : 0;
      longest = Math.max(longest, run);
      if (worked && !d.isPadding) {
        total++;
        if (isDay) day++; else night++;
      }
    });
    out[id] = { totalShifts: total, dayShifts: day, nightShifts: night, longestStreak: longest };
  });
  return out;
}

export interface FairnessSummary {
  // Largest distance (in shifts) between anyone's shifts and their fair share
  maxShiftGap: number;
  // Same for weekend shifts (only when targets are known)
  maxWeekendGap: number;
  weekendRange: [number, number];
}

export function fairnessSummary(stats: Record<string, WorkerStats>, ids: string[]): FairnessSummary {
  let maxShiftGap = 0;
  let maxWeekendGap = 0;
  let lo = Infinity, hi = -Infinity;
  ids.forEach(id => {
    const s = stats[id];
    if (!s) return;
    if (s.target) {
      maxShiftGap = Math.max(maxShiftGap, Math.abs(s.shifts - s.target.shifts));
      maxWeekendGap = Math.max(maxWeekendGap, Math.abs(s.weekend - s.target.weekend));
    }
    lo = Math.min(lo, s.weekend);
    hi = Math.max(hi, s.weekend);
  });
  return { maxShiftGap, maxWeekendGap, weekendRange: [lo === Infinity ? 0 : lo, hi === -Infinity ? 0 : hi] };
}
