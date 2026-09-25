import React, { useMemo } from 'react';
import { Employee, ScheduleVersion, ShiftConfig, WorkerPreference } from '../../types';
import { WorkerStats } from '../../lib/stats';
import { calculatePayroll } from '../../lib/payroll';
import { shiftCap, workRules } from '../../lib/config';
import { Badge, ColorDot, cx } from '../ui';
import type { People } from './derived';

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();

// Workers to show: everyone with shifts this month, plus active workers
const rowsFor = (version: ScheduleVersion, employees: Employee[], stats: Record<string, WorkerStats>) => {
  const ids = new Set<string>();
  employees.forEach(e => { if (e.active !== false || (stats[e.id]?.shifts || 0) > 0) ids.add(e.id); });
  Object.keys(stats).forEach(id => { if ((stats[id]?.shifts || 0) > 0) ids.add(id); });
  const order = new Map(employees.map((e, i) => [e.id, i]));
  return [...ids].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
};

const Gap: React.FC<{ actual: number; target?: number }> = ({ actual, target }) => {
  if (target === undefined) return null;
  const d = actual - target;
  const r = Math.round(d * 10) / 10;
  if (Math.abs(d) < 0.55) return <Badge tone="green" title={`Fair share ${fmt1(target)}`}>on share</Badge>;
  return <Badge tone={Math.abs(d) < 1.55 ? 'amber' : 'red'} title={`Fair share ${fmt1(target)}`}>{r > 0 ? '+' : ''}{fmt1(r)}</Badge>;
};

export const FairnessTable: React.FC<{
  version: ScheduleVersion;
  employees: Employee[];
  config: ShiftConfig;
  stats: Record<string, WorkerStats>;
  people: People;
}> = ({ version, employees, config, stats, people }) => {
  const ids = rowsFor(version, employees, stats);
  const maxRun = workRules(config).maxConsecutive;
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="px-3 py-2.5 text-left font-semibold">Worker</th>
              <th className="px-3 py-2.5 text-center font-semibold">Shifts</th>
              <th className="px-3 py-2.5 text-center font-semibold">Fair share</th>
              <th className="px-3 py-2.5 text-center font-semibold">Day / Night</th>
              <th className="px-3 py-2.5 text-center font-semibold">Weekend</th>
              <th className="px-3 py-2.5 text-center font-semibold">Hours</th>
              <th className="px-3 py-2.5 text-center font-semibold" title="Longest run of consecutive work days (incl. days outside the month)">Longest run</th>
              <th className="px-3 py-2.5 text-center font-semibold" title="Work days with a day off before and after">Single days</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ids.map(id => {
              const s = stats[id] || { shifts: 0, day: 0, night: 0, hours: 0, weekend: 0, longestStreak: 0, singles: 0 };
              const e = people.byId.get(id);
              const cap = e ? shiftCap(e, config) : Infinity;
              const dayPct = s.shifts ? Math.round((s.day / s.shifts) * 100) : 0;
              const skew = e?.preference === WorkerPreference.EITHER && s.shifts > 3 && (dayPct < 15 || dayPct > 85);
              return (
                <tr key={id} className={cx(e?.active === false && 'text-slate-400')}>
                  <td className="px-3 py-2.5"><span className="flex items-center gap-2"><ColorDot color={people.colorOf(id)} /><span dir="auto" className="font-medium text-slate-900">{people.nameOf(id)}</span></span></td>
                  <td className="px-3 py-2.5 text-center font-semibold text-slate-900">
                    {s.shifts}{Number.isFinite(cap) && <span className="text-xs font-normal text-slate-500"> / max {cap}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {s.target ? <span className="inline-flex items-center gap-1.5 text-slate-600">{fmt1(s.target.shifts)} <Gap actual={s.shifts} target={s.target.shifts} /></span> : <span className="text-slate-400">–</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="text-slate-800">{s.day} / {s.night}</span>
                    {s.shifts > 0 && <span className={cx('ml-1.5 text-xs', skew ? 'text-amber-700 font-semibold' : 'text-slate-400')}>{dayPct}% day</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="text-slate-800">{s.weekend}</span>
                    {s.target && <span className="text-xs text-slate-400"> / {fmt1(s.target.weekend)}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center text-slate-800">{fmt1(s.hours)}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', s.longestStreak > maxRun ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600')}>{s.longestStreak}d</span>
                  </td>
                  <td className="px-3 py-2.5 text-center text-slate-600">{s.singles}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2.5 text-xs text-slate-500 border-t border-slate-100 bg-slate-50">
        Fair share = the month's shifts divided in proportion to the days each person is available. Time off lowers it and is not made up later;
        a max-shifts limit caps it. Last month's leftover (e.g. an extra shift or weekend) is evened out.
      </p>
    </div>
  );
};

export const PayrollTable: React.FC<{
  version: ScheduleVersion;
  employees: Employee[];
  config: ShiftConfig;
  people: People;
}> = ({ version, employees, config, people }) => {
  const { byWorker, total } = useMemo(() => calculatePayroll(version.schedule, employees, config), [version, employees, config]);
  const ids = Object.keys(byWorker).filter(id => byWorker[id].totalHours > 0);
  const order = new Map(employees.map((e, i) => [e.id, i]));
  ids.sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
  const money = (n: number) => `₪${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="px-3 py-2.5 text-left font-semibold">Worker</th>
              <th className="px-3 py-2.5 text-center font-semibold">Rate</th>
              <th className="px-3 py-2.5 text-center font-semibold">Shifts</th>
              <th className="px-3 py-2.5 text-center font-semibold">Regular</th>
              <th className="px-3 py-2.5 text-center font-semibold">125%</th>
              <th className="px-3 py-2.5 text-center font-semibold">150%</th>
              <th className="px-3 py-2.5 text-center font-semibold">Total hours</th>
              <th className="px-3 py-2.5 text-right font-semibold">Est. pay</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ids.map(id => {
              const p = byWorker[id];
              const rate = people.byId.get(id)?.hourlyRate;
              return (
                <tr key={id}>
                  <td className="px-3 py-2.5"><span className="flex items-center gap-2"><ColorDot color={people.colorOf(id)} /><span dir="auto" className="font-medium text-slate-900">{people.nameOf(id)}</span></span></td>
                  <td className="px-3 py-2.5 text-center text-slate-600">{rate ? `₪${rate}` : '–'}</td>
                  <td className="px-3 py-2.5 text-center text-slate-800">{p.shifts}</td>
                  <td className="px-3 py-2.5 text-center text-slate-800">{fmt1(p.regularHours)}</td>
                  <td className="px-3 py-2.5 text-center text-amber-700">{fmt1(p.overtime125)}</td>
                  <td className="px-3 py-2.5 text-center text-red-700 font-semibold">{fmt1(p.overtime150)}</td>
                  <td className="px-3 py-2.5 text-center font-semibold text-slate-900">{fmt1(p.totalHours)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-emerald-700">{p.estimatedPay > 0 ? money(p.estimatedPay) : '–'}</td>
                </tr>
              );
            })}
            {ids.length === 0 && <tr><td colSpan={8} className="text-center py-6 text-slate-400">No shifts scheduled</td></tr>}
          </tbody>
          {ids.length > 0 && (
            <tfoot className="bg-slate-50 font-semibold text-slate-900">
              <tr>
                <td className="px-3 py-2.5">Total</td>
                <td />
                <td className="px-3 py-2.5 text-center">{total.shifts}</td>
                <td className="px-3 py-2.5 text-center">{fmt1(total.regularHours)}</td>
                <td className="px-3 py-2.5 text-center">{fmt1(total.overtime125)}</td>
                <td className="px-3 py-2.5 text-center">{fmt1(total.overtime150)}</td>
                <td className="px-3 py-2.5 text-center">{fmt1(total.totalHours)}</td>
                <td className="px-3 py-2.5 text-right text-emerald-700">{money(total.estimatedPay)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="px-3 py-2.5 text-xs text-slate-500 border-t border-slate-100 bg-slate-50">
        Per day: first 8 hours regular, hours 8–10 at 125%, beyond 10 at 150%. Days outside the month are not included.
      </p>
    </div>
  );
};
