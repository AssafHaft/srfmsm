// Defaults, normalization of saved data, and per-date rule lookup.
import {
  DailyTiming, Employee, Priorities, PriorityLevel, Requirement, ShiftConfig, SpecialDay, WorkerPreference
} from '../types';
import { isDateKey, weekdayOf } from './dates';

export const WORKER_PALETTE = [
  '#fecaca', '#fed7aa', '#fde68a', '#d9f99d', '#a7f3d0',
  '#a5f3fc', '#bfdbfe', '#c7d2fe', '#e9d5ff', '#fbcfe8'
];

export const DEFAULT_TIMING: DailyTiming = { startTime: '07:00', endTime: '16:00' };

export const DEFAULT_PRIORITIES: Priorities = {
  workload: 2,
  weekends: 1,
  mix: 1,
  routine: 1,
  wishes: 1,
};

export const DEFAULTS = {
  maxConsecutiveDays: 5,
  minRestDays: 1,
  premiumDays: [5, 6],
  dayShareAmount: 2,
};

export const defaultConfig = (): ShiftConfig => {
  const dailyTimings: Record<number, DailyTiming> = {};
  for (let i = 0; i < 7; i++) dailyTimings[i] = { ...DEFAULT_TIMING };
  return {
    dailyTimings,
    requirements: {
      0: { day: 1, night: 2 }, // Sun
      1: { day: 1, night: 1 }, // Mon
      2: { day: 1, night: 2 }, // Tue
      3: { day: 1, night: 1 }, // Wed
      4: { day: 1, night: 2 }, // Thu
      5: { day: 1, night: 1 }, // Fri
      6: { day: 1, night: 2 }, // Sat
    },
    premiumDays: [...DEFAULTS.premiumDays],
    maxConsecutiveDays: DEFAULTS.maxConsecutiveDays,
    minRestDays: DEFAULTS.minRestDays,
    maxShiftsPerMonth: 0,
    blockScheduling: true,
    distributeDayShiftsToEither: false,
    dayShareAmount: DEFAULTS.dayShareAmount,
    priorities: { ...DEFAULT_PRIORITIES },
    specialDays: {},
  };
};

export const defaultEmployees = (): Employee[] => [
  { name: 'גולן חדד', preference: WorkerPreference.DAY_ONLY },
  { name: 'ניצן כפיר', preference: WorkerPreference.EITHER },
  { name: 'דן אהרוני', preference: WorkerPreference.EITHER },
  { name: 'ענבר כפיר', preference: WorkerPreference.EITHER },
  { name: 'רועי נוף', preference: WorkerPreference.EITHER },
  { name: 'עומרי חכים', preference: WorkerPreference.EITHER },
].map((e, i) => ({
  id: String(i + 1),
  name: e.name,
  preference: e.preference,
  availability: { daysOff: [], unavailableDates: [], preferOffDays: [], preferOffDates: [] },
  hourlyRate: 75,
  color: WORKER_PALETTE[i],
  active: true,
}));

export const suggestWorkerColor = (employees: Employee[]): string =>
  WORKER_PALETTE.find(c => !employees.some(e => e.color === c)) ||
  WORKER_PALETTE[employees.length % WORKER_PALETTE.length];

// ---------- Normalization (accepts anything previously saved) ----------

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};
const intIn = (v: unknown, lo: number, hi: number, fallback: number): number =>
  Math.min(hi, Math.max(lo, Math.round(num(v, fallback))));
const weekdayList = (v: unknown): number[] =>
  Array.isArray(v) ? [...new Set(v.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
const dateList = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((d): d is string => typeof d === 'string' && isDateKey(d)))].sort() : [];
const isTime = (v: unknown): v is string => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);
const level = (v: unknown, fallback: PriorityLevel): PriorityLevel =>
  v === 0 || v === 1 || v === 2 ? v : fallback;

const PREFERENCES = Object.values(WorkerPreference) as string[];

export const normalizeEmployee = (raw: any, index: number): Employee => {
  const a = raw?.availability || {};
  const cap = num(raw?.targetShifts, 0);
  const rate = num(raw?.hourlyRate, 0);
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : String(raw?.id ?? `w${index + 1}`),
    name: typeof raw?.name === 'string' ? raw.name : `Worker ${index + 1}`,
    preference: PREFERENCES.includes(raw?.preference) ? raw.preference : WorkerPreference.EITHER,
    availability: {
      daysOff: weekdayList(a.daysOff),
      unavailableDates: dateList(a.unavailableDates),
      preferOffDays: weekdayList(a.preferOffDays),
      preferOffDates: dateList(a.preferOffDates),
    },
    targetShifts: cap > 0 ? Math.round(cap) : undefined,
    hourlyRate: rate > 0 ? rate : undefined,
    // Workers saved before color coding carry '#fff'
    color: typeof raw?.color === 'string' && raw.color && raw.color !== '#fff'
      ? raw.color : WORKER_PALETTE[index % WORKER_PALETTE.length],
    active: raw?.active !== false,
  };
};

const normalizeRequirement = (v: any, fallback: Requirement): Requirement => ({
  day: intIn(v?.day, 0, 20, fallback.day),
  night: intIn(v?.night, 0, 20, fallback.night),
});

const normalizeSpecialDay = (v: any): SpecialDay | null => {
  if (!v || typeof v !== 'object') return null;
  const s: SpecialDay = {};
  if (typeof v.label === 'string' && v.label.trim()) s.label = v.label.trim().slice(0, 60);
  if (v.closed) s.closed = true;
  if (v.day !== undefined && v.day !== null && v.day !== '') s.day = intIn(v.day, 0, 20, 0);
  if (v.night !== undefined && v.night !== null && v.night !== '') s.night = intIn(v.night, 0, 20, 0);
  if (isTime(v.startTime)) s.startTime = v.startTime;
  if (isTime(v.endTime)) s.endTime = v.endTime;
  if (v.premium) s.premium = true;
  return s;
};

export const normalizeConfig = (raw: any): ShiftConfig => {
  const base = defaultConfig();
  if (!raw || typeof raw !== 'object') return base;
  const dailyTimings: Record<number, DailyTiming> = {};
  const requirements: Record<number, Requirement> = {};
  for (let i = 0; i < 7; i++) {
    const t = raw.dailyTimings?.[i];
    dailyTimings[i] = {
      startTime: isTime(t?.startTime) ? t.startTime : base.dailyTimings[i].startTime,
      endTime: isTime(t?.endTime) ? t.endTime : base.dailyTimings[i].endTime,
    };
    requirements[i] = normalizeRequirement(raw.requirements?.[i], base.requirements[i]);
  }
  const specialDays: Record<string, SpecialDay> = {};
  if (raw.specialDays && typeof raw.specialDays === 'object') {
    Object.entries(raw.specialDays).forEach(([k, v]) => {
      const s = isDateKey(k) ? normalizeSpecialDay(v) : null;
      if (s) specialDays[k] = s;
    });
  }
  const p = raw.priorities || {};
  return {
    dailyTimings,
    requirements,
    premiumDays: raw.premiumDays === undefined ? [...DEFAULTS.premiumDays] : weekdayList(raw.premiumDays),
    maxShiftsPerMonth: Math.max(0, Math.round(num(raw.maxShiftsPerMonth, 0))),
    maxConsecutiveDays: intIn(raw.maxConsecutiveDays, 1, 14, DEFAULTS.maxConsecutiveDays),
    minRestDays: intIn(raw.minRestDays, 1, 7, DEFAULTS.minRestDays),
    blockScheduling: raw.blockScheduling ?? true,
    distributeDayShiftsToEither: !!raw.distributeDayShiftsToEither,
    dayShareAmount: intIn(raw.dayShareAmount, 1, 15, DEFAULTS.dayShareAmount),
    priorities: {
      workload: level(p.workload, DEFAULT_PRIORITIES.workload),
      weekends: level(p.weekends, DEFAULT_PRIORITIES.weekends),
      mix: level(p.mix, DEFAULT_PRIORITIES.mix),
      routine: level(p.routine, DEFAULT_PRIORITIES.routine),
      wishes: level(p.wishes, DEFAULT_PRIORITIES.wishes),
    },
    specialDays,
  };
};

export const getPriorities = (config: ShiftConfig): Priorities => ({ ...DEFAULT_PRIORITIES, ...(config.priorities || {}) });

// ---------- Rules for a specific date ----------

const parseTime = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h + (m || 0) / 60;
};

export const windowHours = (timing: DailyTiming): number => {
  const start = parseTime(timing.startTime);
  let end = parseTime(timing.endTime);
  if (end < start) end += 24; // overnight
  return end - start;
};

// Shift length when both shifts are staffed: the window split in two with a
// 1-hour overlap. When only one shift is staffed it covers the whole window.
export const splitShiftHours = (windowH: number): number => (windowH + 1) / 2;

export interface DayPlan {
  req: Requirement;
  timing: DailyTiming;
  window: number;
  closed: boolean;
  premium: boolean;
  label?: string;
  special: boolean;
  // Solo day: exactly one worker covers the whole window
  solo: boolean;
  // Planned hours per worker on this day
  plannedHours: number;
}

export const dayPlan = (config: ShiftConfig, date: string): DayPlan => {
  const dow = weekdayOf(date);
  const s = config.specialDays?.[date];
  const baseReq = config.requirements[dow] || { day: 1, night: 1 };
  const baseTiming = config.dailyTimings[dow] || DEFAULT_TIMING;
  const closed = !!s?.closed;
  const req: Requirement = closed
    ? { day: 0, night: 0 }
    : { day: s?.day ?? baseReq.day, night: s?.night ?? baseReq.night };
  const timing: DailyTiming = {
    startTime: s?.startTime || baseTiming.startTime,
    endTime: s?.endTime || baseTiming.endTime,
  };
  const window = windowHours(timing);
  const premium = !closed && (!!s?.premium || (config.premiumDays ?? DEFAULTS.premiumDays).includes(dow));
  const both = req.day > 0 && req.night > 0;
  return {
    req, timing, window, closed, premium,
    label: s?.label,
    special: !!s,
    solo: req.day + req.night === 1,
    plannedHours: both ? splitShiftHours(window) : window,
  };
};

export interface WorkRules {
  maxConsecutive: number;
  minRest: number;
  blockMode: boolean;
  globalCap: number; // 0 = none
}

export const workRules = (config: ShiftConfig): WorkRules => ({
  maxConsecutive: Math.max(1, config.maxConsecutiveDays ?? DEFAULTS.maxConsecutiveDays),
  minRest: Math.max(1, config.minRestDays ?? DEFAULTS.minRestDays),
  blockMode: config.blockScheduling ?? true,
  globalCap: config.maxShiftsPerMonth || 0,
});

// Effective monthly cap for a worker (Infinity when none)
export const shiftCap = (e: Employee, config: ShiftConfig): number => {
  const personal = e.targetShifts && e.targetShifts > 0 ? e.targetShifts : Infinity;
  const global = config.maxShiftsPerMonth && config.maxShiftsPerMonth > 0 ? config.maxShiftsPerMonth : Infinity;
  return Math.min(personal, global);
};

export const canWorkDay = (e: Employee) => e.preference !== WorkerPreference.NIGHT_ONLY;
export const canWorkNight = (e: Employee) => e.preference !== WorkerPreference.DAY_ONLY;

// 0 = unavailable, 1 = available, 2 = would rather not
export const availabilityOn = (e: Employee, date: string): 0 | 1 | 2 => {
  const dow = weekdayOf(date);
  const a = e.availability;
  if (a.daysOff.includes(dow) || a.unavailableDates.includes(date)) return 0;
  if (a.preferOffDays?.includes(dow) || a.preferOffDates?.includes(date)) return 2;
  return 1;
};
