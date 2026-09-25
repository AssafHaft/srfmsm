// Values derived from a schedule version for display.
import { useMemo } from 'react';
import { Employee, ScheduleVersion, ShiftConfig } from '../../types';
import { validateSchedule, ValidationResult } from '../../lib/validate';
import { computeStats, fairnessSummary, FairnessSummary, WorkerStats } from '../../lib/stats';

// Rules a version is judged by: the weekly rules it was generated with, plus
// the current special days (closures/holidays are facts about dates).
export const effectiveConfig = (version: ScheduleVersion, current: ShiftConfig): ShiftConfig => ({
  ...(version.configSnapshot || current),
  specialDays: current.specialDays,
});

export interface People {
  nameOf: (id: string) => string;
  colorOf: (id: string) => string;
  byId: Map<string, Employee>;
}

export const makePeople = (employees: Employee[], version?: ScheduleVersion | null): People => {
  const byId = new Map(employees.map(e => [e.id, e]));
  return {
    byId,
    nameOf: id => byId.get(id)?.name || version?.people?.[id]?.name || 'Removed worker',
    colorOf: id => byId.get(id)?.color || version?.people?.[id]?.color || '#e5e7eb',
  };
};

export interface VersionInsights {
  config: ShiftConfig;
  validation: ValidationResult;
  stats: Record<string, WorkerStats>;
  fairness: FairnessSummary;
  ruleIssues: number; // errors other than empty slots
}

export function versionInsights(version: ScheduleVersion, employees: Employee[], current: ShiftConfig): VersionInsights {
  const config = effectiveConfig(version, current);
  const validation = validateSchedule(version.schedule, employees, config, version.history);
  const ids = employees.map(e => e.id);
  const stats = computeStats(version.schedule, config, ids, version.targets);
  // Versions saved by older builds have no fair-share targets: summarize
  // everyone who worked or is active instead.
  const summaryIds = version.targets
    ? Object.keys(version.targets).filter(id => stats[id])
    : ids.filter(id => stats[id] && (stats[id].shifts > 0 || employees.find(e => e.id === id)?.active !== false));
  const fairness = fairnessSummary(stats, summaryIds);
  const ruleIssues = validation.issues.filter(i => i.severity !== 'info' && i.kind !== 'empty').length;
  return { config, validation, stats, fairness, ruleIssues };
}

export const useVersionInsights = (version: ScheduleVersion | null, employees: Employee[], current: ShiftConfig) =>
  useMemo(() => (version ? versionInsights(version, employees, current) : null), [version, employees, current]);

// Have the weekly rules changed since this version was generated?
export const rulesChangedSince = (version: ScheduleVersion, current: ShiftConfig): boolean => {
  const snap = version.configSnapshot;
  if (!snap) return false;
  const dates = new Set(version.schedule.map(d => d.date));
  const specials = (c: ShiftConfig) => Object.entries(c.specialDays || {}).filter(([d]) => dates.has(d)).sort(([a], [b]) => a.localeCompare(b));
  const pick = (c: ShiftConfig) => JSON.stringify([
    c.requirements, c.dailyTimings, c.premiumDays, c.maxShiftsPerMonth || 0, c.maxConsecutiveDays, c.minRestDays,
    c.blockScheduling ?? true, !!c.distributeDayShiftsToEither, c.distributeDayShiftsToEither ? c.dayShareAmount : 0,
    specials(c),
  ]);
  return pick(snap) !== pick(current);
};
