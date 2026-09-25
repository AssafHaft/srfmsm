// Data model. Field names that already exist in saved browser data and JSON
// backups (e.g. `targetShifts`, `stats`, `distributeDayShiftsToEither`) are
// kept as-is so older data loads without conversion and older builds can
// still read what this build saves.

export enum ShiftType {
  DAY = 'DAY',
  NIGHT = 'NIGHT'
}

export enum WorkerPreference {
  DAY_ONLY = 'Day Only',
  PREFERS_DAY = 'Prefers Day',
  EITHER = 'Either',
  PREFERS_NIGHT = 'Prefers Night',
  NIGHT_ONLY = 'Night Only'
}

export interface Availability {
  // Weekdays the worker can never work (0 = Sunday ... 6 = Saturday)
  daysOff: number[];
  // Specific dates the worker can never work (vacation etc.), YYYY-MM-DD
  unavailableDates: string[];
  // Soft wishes: the worker would rather not work these weekdays / dates,
  // but can be scheduled when nobody else fits
  preferOffDays?: number[];
  preferOffDates?: string[];
}

export interface Employee {
  id: string;
  name: string;
  preference: WorkerPreference;
  availability: Availability;
  // Max shifts per month (hard cap). Also the natural target when there is
  // enough work. Legacy name kept for saved-data compatibility.
  targetShifts?: number;
  hourlyRate?: number; // NIS per hour
  color: string;
  // Inactive workers stay on the list but are left out of new schedules
  active?: boolean;
}

export interface DailyTiming {
  startTime: string; // "07:00"
  endTime: string;   // "16:00"
}

export interface Requirement {
  day: number;
  night: number;
}

// 0 = low, 1 = normal, 2 = high
export type PriorityLevel = 0 | 1 | 2;

export interface Priorities {
  workload: PriorityLevel; // everyone close to their fair share of shifts and hours
  weekends: PriorityLevel; // weekend / premium days shared evenly
  mix: PriorityLevel;      // balanced day/night mix for "Either" workers
  routine: PriorityLevel;  // steady weekly pace, runs of days instead of scattered single days
  wishes: PriorityLevel;   // soft wishes: "prefers day/night" and "prefers off" days
}

// One-off change for a specific date (holiday, event, closure)
export interface SpecialDay {
  label?: string;
  closed?: boolean;
  day?: number;   // staffing override
  night?: number;
  startTime?: string; // hours override
  endTime?: string;
  premium?: boolean;  // counts as a weekend/premium day
}

export interface ShiftConfig {
  // Operating hours per weekday (0 = Sunday)
  dailyTimings: Record<number, DailyTiming>;
  // Workers needed per weekday
  requirements: Record<number, Requirement>;
  // Weekend / premium weekdays, shared evenly. Default Fri + Sat.
  premiumDays?: number[];
  // Hard cap on shifts per worker per month (0/undefined = none)
  maxShiftsPerMonth?: number;
  // Hard cap on consecutive work days (default 5)
  maxConsecutiveDays?: number;
  // Minimum days off between two runs of work (default 1)
  minRestDays?: number;
  // Same shift type for every day of a run (default on)
  blockScheduling?: boolean;
  // Give "Either" workers some of the day shifts of "Day Only" workers
  distributeDayShiftsToEither?: boolean;
  // How many day shifts per month each Day Only worker hands over (default 2)
  dayShareAmount?: number;
  priorities?: Partial<Priorities>;
  specialDays?: Record<string, SpecialDay>;
}

export interface DailySchedule {
  date: string; // YYYY-MM-DD
  dayShift: string[];   // employee IDs
  nightShift: string[]; // employee IDs
  isPadding?: boolean;  // outside the scheduled month (full-week padding)
  locked?: boolean;     // kept exactly as-is when regenerating
  pinned?: string[];    // employee IDs kept in their shift when regenerating
  carried?: boolean;    // taken from the previous month's schedule
}

export interface DayAssignment {
  dayShift: string[];
  nightShift: string[];
}

// Date (YYYY-MM-DD) -> who worked
export type DayAssignmentMap = Record<string, DayAssignment>;

export interface EmployeeStats {
  totalShifts: number;
  dayShifts: number;
  nightShifts: number;
  longestStreak: number;
}

// Fair share the generator aimed for, per worker, for the month
export interface WorkerTarget {
  shifts: number;
  hours: number;
  weekend: number;
}

export interface ScheduleVersion {
  id: string;
  timestamp: number;
  name: string;
  month: number; // 0-11
  year: number;
  configSnapshot?: ShiftConfig;
  schedule: DailySchedule[];
  // Kept in sync for older builds; this build derives stats from `schedule`
  stats: Record<string, EmployeeStats>;
  final?: boolean;
  note?: string;
  targets?: Record<string, WorkerTarget>;
  // Days before the grid that the generator treated as history
  history?: DayAssignmentMap;
  continuityLabel?: string;
  // Names/colors at generation time, so removed workers still display
  people?: Record<string, { name: string; color: string }>;
  seed?: number;
}

// Per-month generation settings: where the start of the month comes from
export interface MonthSetup {
  // auto = previous month's schedule in the app, custom = imported/typed in,
  // none = start fresh
  continuity?: 'auto' | 'custom' | 'none';
  custom?: DayAssignmentMap;
  customLabel?: string;
  // Carried-over days the manager unlocked so they can be regenerated
  released?: string[];
}
