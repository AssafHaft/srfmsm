// Turns workers + rules + month into flat arrays the solver can work on fast.
import { DayAssignmentMap, Employee, ShiftConfig, WorkerPreference } from '../../types';
import { addDays, gridKeys, isInMonth } from '../dates';
import {
  availabilityOn, canWorkDay, canWorkNight, dayPlan, getPriorities, shiftCap, workRules
} from '../config';
import { computeTargets } from './targets';

export const OFF = 0;
export const DAY = 1;
export const NIGHT = 2;
export type Kind = 0 | 1 | 2;

export const NEVER = -1e9; // "no previous work day"

export interface WorkerModel {
  id: string;
  canDay: boolean;
  canNight: boolean;
  dayOnly: boolean;
  nightOnly: boolean;
  prefKind: Kind;     // soft "prefers day/night" (0 = none)
  mixGroup: boolean;  // plain "Either" workers share day/night evenly
  avail: Uint8Array;  // per grid day: 0 unavailable, 1 available, 2 prefers off
  fixed: Int8Array;   // per grid day: -1 free, 0 kept off, 1 kept on day, 2 kept on night
  cap: number;        // max shifts in the month (Infinity = none)
  // State carried in from the days just before the grid
  histKind: Kind;
  histRun: number;
  histLastWork: number;
  // Month figures
  availDays: number;     // in-month days not off (sets the fair share)
  workDays: number;      // ...of which have a slot this worker may take
  premAvailDays: number; // weekend days not off
  premWorkDays: number;  // ...of which have a slot this worker may take
  weekAvail: number[];   // workable days per grid week (shapes the weekly pace)
  // Fair-share targets
  target: number;
  hoursTarget: number;
  weekendTarget: number;
  padTarget: number;
  // Last month's leftover imbalance (positive = got more than their share)
  carryShifts: number;
  carryWeekend: number;
  carryDay: number;
}

export interface Weights {
  empty: number;    // per unfilled slot in the month
  emptyPad: number; // per unfilled slot on padding days
  load: number;
  hours: number;
  pad: number;
  weekend: number;
  mix: number;
  spread: number;
  single: number;
  prefOff: number;
  prefKind: number;
}

export interface Problem {
  year: number;
  month: number;
  dates: string[];
  G: number;
  inMonth: Uint8Array;
  premium: Uint8Array;
  locked: Uint8Array;
  reqDay: Int16Array;
  reqNight: Int16Array;
  solo: Int8Array;        // 0, or the kind of the single slot on a solo day
  hours: Float64Array;    // planned hours per worker on each day
  emptyWeight: Float64Array; // cost of one unfilled slot on each day
  week: Int16Array;       // index of the grid week
  weeks: number;
  ghostDay: Int16Array;   // kept assignments of people not in the worker list
  ghostNight: Int16Array;
  workers: WorkerModel[];
  W: number;
  maxConsecutive: number;
  minRest: number;
  blockMode: boolean;
  weights: Weights;
  avgShiftHours: number;
}

export interface CarryOver {
  shifts: number;
  weekend: number;
  day: number;
}

export interface ProblemInput {
  employees: Employee[]; // workers to schedule (active)
  year: number;
  month: number;
  config: ShiftConfig;
  history?: DayAssignmentMap; // days before the grid (context only)
  locked?: DayAssignmentMap;  // days kept exactly as given
  pins?: DayAssignmentMap;    // individual assignments kept as given
  carry?: Record<string, CarryOver>; // balance carried from last month
}

const LEVEL = [0.3, 1, 3];

const clampCarry = (v: number | undefined, limit: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(-limit, Math.min(limit, v)) : 0;

export const weightsFor = (config: ShiftConfig): Weights => {
  const p = getPriorities(config);
  return {
    empty: 80,
    emptyPad: 25,
    load: LEVEL[p.workload],
    hours: LEVEL[p.workload] * 0.5,
    pad: LEVEL[p.workload] * 0.3,
    weekend: LEVEL[p.weekends],
    mix: LEVEL[p.mix] * 0.6,
    spread: LEVEL[p.routine] * 0.35,
    single: LEVEL[p.routine] * 0.6,
    prefOff: LEVEL[p.wishes] * 2,
    prefKind: LEVEL[p.wishes] * 0.8,
  };
};

export function buildProblem(input: ProblemInput): Problem {
  const { employees, year, month, config } = input;
  const dates = gridKeys(year, month);
  const G = dates.length;
  const rules = workRules(config);

  const inMonth = new Uint8Array(G);
  const premium = new Uint8Array(G);
  const locked = new Uint8Array(G);
  const reqDay = new Int16Array(G);
  const reqNight = new Int16Array(G);
  const solo = new Int8Array(G);
  const hours = new Float64Array(G);
  const week = new Int16Array(G);
  const ghostDay = new Int16Array(G);
  const ghostNight = new Int16Array(G);

  dates.forEach((date, g) => {
    const plan = dayPlan(config, date);
    inMonth[g] = isInMonth(date, year, month) ? 1 : 0;
    premium[g] = plan.premium ? 1 : 0;
    reqDay[g] = plan.req.day;
    reqNight[g] = plan.req.night;
    solo[g] = plan.solo ? (plan.req.night === 1 ? NIGHT : DAY) : 0;
    hours[g] = plan.plannedHours;
    week[g] = Math.floor(g / 7);
    if (input.locked?.[date]) locked[g] = 1;
  });
  const weeks = Math.ceil(G / 7);

  const ids = new Set(employees.map(e => e.id));
  dates.forEach((date, g) => {
    const src = input.locked?.[date] || input.pins?.[date];
    if (!src) return;
    ghostDay[g] = src.dayShift.filter(id => !ids.has(id)).length;
    ghostNight[g] = src.nightShift.filter(id => !ids.has(id)).length;
  });

  const histLen = rules.maxConsecutive + rules.minRest + 7;
  const gridStart = dates[0];

  const workers: WorkerModel[] = employees.map(e => {
    const avail = new Uint8Array(G);
    const fixed = new Int8Array(G).fill(-1);
    const weekAvail = new Array(weeks).fill(0);
    let availDays = 0;
    let workDays = 0;
    let premAvailDays = 0;
    let premWorkDays = 0;
    const canDay = canWorkDay(e);
    const canNight = canWorkNight(e);

    dates.forEach((date, g) => {
      const a = availabilityOn(e, date);
      avail[g] = a;
      const lockedDay = input.locked?.[date];
      if (lockedDay) {
        fixed[g] = lockedDay.dayShift.includes(e.id) ? DAY : lockedDay.nightShift.includes(e.id) ? NIGHT : OFF;
      } else {
        const pin = input.pins?.[date];
        if (pin?.dayShift.includes(e.id)) fixed[g] = DAY;
        else if (pin?.nightShift.includes(e.id)) fixed[g] = NIGHT;
      }
      // Fair share follows availability (time off); whether a day has a
      // slot of the worker's shift type only limits what they can take.
      const hasSlot = (canDay && reqDay[g] > 0) || (canNight && reqNight[g] > 0);
      if (inMonth[g] && a > 0) {
        availDays++;
        if (premium[g]) premAvailDays++;
        if (hasSlot) {
          workDays++;
          weekAvail[week[g]]++;
          if (premium[g]) premWorkDays++;
        }
      }
    });

    // History: walk the days before the grid, oldest first
    let histKind: Kind = OFF;
    let histRun = 0;
    let histLastWork = NEVER;
    if (input.history) {
      for (let i = histLen; i >= 1; i--) {
        const h = input.history[addDays(gridStart, -i)];
        const k: Kind = h?.dayShift.includes(e.id) ? DAY : h?.nightShift.includes(e.id) ? NIGHT : OFF;
        if (k) {
          histRun = histKind ? histRun + 1 : 1;
          histLastWork = -i;
        } else {
          histRun = 0;
        }
        histKind = k;
      }
    }

    return {
      id: e.id,
      canDay,
      canNight,
      dayOnly: e.preference === WorkerPreference.DAY_ONLY,
      nightOnly: e.preference === WorkerPreference.NIGHT_ONLY,
      prefKind: e.preference === WorkerPreference.PREFERS_DAY ? DAY
        : e.preference === WorkerPreference.PREFERS_NIGHT ? NIGHT : OFF,
      mixGroup: e.preference === WorkerPreference.EITHER,
      avail,
      fixed,
      cap: shiftCap(e, config),
      histKind,
      histRun,
      histLastWork,
      availDays,
      workDays,
      premAvailDays,
      premWorkDays,
      weekAvail,
      target: 0,
      hoursTarget: 0,
      weekendTarget: 0,
      padTarget: 0,
      carryShifts: clampCarry(input.carry?.[e.id]?.shifts, 1),
      carryWeekend: clampCarry(input.carry?.[e.id]?.weekend, 1),
      carryDay: e.preference === WorkerPreference.EITHER ? clampCarry(input.carry?.[e.id]?.day, 1.5) : 0,
    };
  });

  const problem: Problem = {
    year, month, dates, G, inMonth, premium, locked, reqDay, reqNight, solo, hours, week, weeks,
    ghostDay, ghostNight, workers, W: workers.length,
    emptyWeight: new Float64Array(G),
    maxConsecutive: rules.maxConsecutive,
    minRest: rules.minRest,
    blockMode: rules.blockMode,
    weights: weightsFor(config),
    avgShiftHours: 1,
  };

  for (let g = 0; g < G; g++) problem.emptyWeight[g] = inMonth[g] ? problem.weights.empty : problem.weights.emptyPad;

  const dayShare = config.distributeDayShiftsToEither ? (config.dayShareAmount ?? 2) : 0;
  computeTargets(problem, dayShare);
  return problem;
}
