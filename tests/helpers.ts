import { Employee, ShiftConfig, WorkerPreference } from '../src/types';
import { defaultConfig, normalizeConfig, normalizeEmployee } from '../src/lib/config';
import { dateRange } from '../src/lib/dates';

export const worker = (id: string, preference: WorkerPreference = WorkerPreference.EITHER, extra: Partial<Employee> = {}): Employee =>
  normalizeEmployee({ id, name: id, preference, hourlyRate: 75, ...extra }, 0);

export const team = (): Employee[] => [
  worker('Golan', WorkerPreference.DAY_ONLY),
  worker('Nitzan'), worker('Dan'), worker('Inbar'), worker('Roy'), worker('Omri'),
];

export const config = (over: Partial<ShiftConfig> = {}): ShiftConfig => normalizeConfig({ ...defaultConfig(), ...over });

export const vacation = (from: string, to: string) => dateRange(from, to);
