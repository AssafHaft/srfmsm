
export enum ShiftType {
  DAY = 'DAY',
  NIGHT = 'NIGHT'
}

export enum WorkerPreference {
  DAY_ONLY = 'Day Only',
  NIGHT_ONLY = 'Night Only',
  EITHER = 'Either'
}

export interface Availability {
  // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  daysOff: number[]; 
  // Specific ISO dates YYYY-MM-DD
  unavailableDates: string[];
}

export interface Employee {
  id: string;
  name: string;
  preference: WorkerPreference;
  availability: Availability;
  targetShifts?: number; // Quota
  hourlyRate?: number; // Pay rate
  color: string;
}

export interface DailyTiming {
  startTime: string; // "07:00"
  endTime: string;   // "22:00"
}

export interface ShiftConfig {
  // Replaces global timings with per-day configuration (0=Sun, 6=Sat)
  dailyTimings: Record<number, DailyTiming>;
  distributeDayShiftsToEither?: boolean;
  requirements: {
    [key: number]: {
      day: number;
      night: number;
    }
  };
}

export interface DailySchedule {
  date: string; // ISO YYYY-MM-DD
  dayShift: string[]; // Employee IDs
  nightShift: string[]; // Employee IDs
  isPadding?: boolean; // True if this day is outside the target month (prev/next month padding)
}

export interface ManualHistoryInput {
  [dateKey: string]: {
    dayShift: string[];
    nightShift: string[];
  }
}

export interface ScheduleVersion {
  id: string;
  timestamp: number;
  name: string;
  month: number; // 0-11
  year: number;
  configSnapshot?: ShiftConfig; // Store config used for this generation
  schedule: DailySchedule[];
  stats: Record<string, EmployeeStats>;
}

export interface EmployeeStats {
  totalShifts: number;
  dayShifts: number;
  nightShifts: number;
  longestStreak: number;
}

export interface HistoricalContext {
  lastDayNightShiftIds: string[];
  accumulatedStats: Record<string, { day: number, night: number, total: number }>;
  consecutiveDaysEnding: Record<string, number>;
  sourceName: string;
}

export interface AppState {
  employees: Employee[];
  config: ShiftConfig;
  versions: ScheduleVersion[];
  currentVersionId: string | null;
}
