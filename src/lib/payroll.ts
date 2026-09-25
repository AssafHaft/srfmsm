// Payroll estimate. Daily hours are split into tiers:
// regular up to 8h, 125% for hours 8-10, 150% beyond 10h.
import { DailySchedule, Employee, ShiftConfig } from '../types';
import { hoursOnDay } from './stats';

export interface PayrollData {
  shifts: number;
  regularHours: number;
  overtime125: number;
  overtime150: number;
  totalHours: number;
  estimatedPay: number;
}

export const emptyPayroll = (): PayrollData => ({
  shifts: 0, regularHours: 0, overtime125: 0, overtime150: 0, totalHours: 0, estimatedPay: 0,
});

export function splitTiers(hours: number): { reg: number; ot125: number; ot150: number } {
  const reg = Math.min(hours, 8);
  const rest = Math.max(0, hours - 8);
  const ot125 = Math.min(rest, 2);
  const ot150 = Math.max(0, rest - 2);
  return { reg, ot125, ot150 };
}

export function calculatePayroll(
  schedule: DailySchedule[],
  employees: Employee[],
  config: ShiftConfig
): { byWorker: Record<string, PayrollData>; total: PayrollData } {
  const rate = new Map(employees.map(e => [e.id, e.hourlyRate || 0]));
  const byWorker: Record<string, PayrollData> = {};
  employees.forEach(e => { byWorker[e.id] = emptyPayroll(); });
  const total = emptyPayroll();

  schedule.forEach(day => {
    if (day.isPadding) return; // padding days belong to the neighbouring month
    const hours = hoursOnDay(config, day);
    const { reg, ot125, ot150 } = splitTiers(hours);
    new Set([...day.dayShift, ...day.nightShift]).forEach(id => {
      const p = byWorker[id] || (byWorker[id] = emptyPayroll());
      const r = rate.get(id) || 0;
      const pay = reg * r + ot125 * r * 1.25 + ot150 * r * 1.5;
      for (const t of [p, total]) {
        t.shifts++;
        t.regularHours += reg;
        t.overtime125 += ot125;
        t.overtime150 += ot150;
        t.totalHours += hours;
        t.estimatedPay += pay;
      }
    });
  });
  return { byWorker, total };
}
