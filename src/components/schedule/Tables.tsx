import React, { useMemo } from 'react';
import { Employee, ScheduleVersion, ShiftConfig, WorkerPreference } from '../../types';
import { WorkerStats } from '../../lib/stats';
import { calculatePayroll } from '../../lib/payroll';
import { shiftCap, workRules } from '../../lib/config';
import { Badge, ColorDot, cx } from '../ui';
import type { People } from './derived';
import { useI18n } from '../../i18n';

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
  const { t } = useI18n();
  if (target === undefined) return null;
  const d = actual - target;
  const r = Math.round(d * 10) / 10;
  if (Math.abs(d) < 0.55) return <Badge tone="green" title={t('f.shareTip', { n: fmt1(target) })}>{t('f.onShare')}</Badge>;
  return <Badge tone={Math.abs(d) < 1.55 ? 'amber' : 'red'} title={t('f.shareTip', { n: fmt1(target) })}>{r > 0 ? '+' : ''}{fmt1(r)}</Badge>;
};

export const FairnessTable: React.FC<{
  version: ScheduleVersion;
  employees: Employee[];
  config: ShiftConfig;
  stats: Record<string, WorkerStats>;
  people: People;
}> = ({ version, employees, config, stats, people }) => {
  const { t } = useI18n();
  const ids = rowsFor(version, employees, stats);
  const maxRun = workRules(config).maxConsecutive;
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="px-3 py-2.5 text-start font-semibold">{t('x.worker')}</th>
              <th className="px-3 py-2.5 text-center font-semibold">{t('x.shifts')}</th>
              <th className="px-3 py-2.5 text-center font-semibold">{t('f.share')}</th>
              <th className="px-3 py-2.5 text-center font-semibold">{t('f.dayNight')}</th>
              <th className="px-3 py-2.5 text-center font-semibold">{t('x.weekend')}</th>
              <th className="px-3 py-2.5 text-center font-semibold">{t('x.hours')}</th>
              <th className="px-3 py-2.5 text-center font-semibold" title={t('f.longestTip')}>{t('f.longest')}</th>
              <th className="px-3 py-2.5 text-center font-semibold" title={t('f.singlesTip')}>{t('f.singles')}</th>
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
                    {s.shifts}{Number.isFinite(cap) && <span className="text-xs font-normal text-slate-500"> / {t('f.max', { n: cap })}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {s.target ? <span className="inline-flex items-center gap-1.5 text-slate-600">{fmt1(s.target.shifts)} <Gap actual={s.shifts} target={s.target.shifts} /></span> : <span className="text-slate-400">–</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="text-slate-800">{s.day} / {s.night}</span>
                    {s.shifts > 0 && <span className={cx('ms-1.5 text-xs', skew ? 'text-amber-700 font-semibold' : 'text-slate-400')}>{t('f.dayPct', { n: dayPct })}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="text-slate-800">{s.weekend}</span>
                    {s.target && <span className="text-xs text-slate-400"> / {fmt1(s.target.weekend)}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center text-slate-800">{fmt1(s.hours)}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', s.longestStreak > maxRun ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600')}>{t('f.days', { n: s.longestStreak })}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center text-slate-600">{s.singles}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2.5 text-xs text-slate-500 border-t border-slate-100 bg-slate-50">
        {t('f.note')}
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
  const { t, lang } = useI18n();
  const { byWorker, total } = useMemo(() => calculatePayroll(version.schedule, employees, config), [version, employees, config]);
  const ids = Object.keys(byWorker).filter(id => byWorker[id].totalHours > 0);
  const order = new Map(employees.map((e, i) => [e.id, i]));
  ids.sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
  const money = (n: number) => `₪${n.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="px-3 py-2.5 text-start font-semibold">{t('x.worker')}</th>
              <th className="px-3 py-2.5 text-center font-semibold">{t('pay.rate')}</th>
              <th className="px-3 py-2.5 text-center font-semibold">{t('x.shifts')}</th>
              <th className="px-3 py-2.5 text-center font-semibold">{t('pay.regular')}</th>
              <th className="px-3 py-2.5 text-center font-semibold">125%</th>
              <th className="px-3 py-2.5 text-center font-semibold">150%</th>
              <th className="px-3 py-2.5 text-center font-semibold">{t('pay.totalHours')}</th>
              <th className="px-3 py-2.5 text-end font-semibold">{t('pay.est')}</th>
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
                  <td className="px-3 py-2.5 text-end font-semibold text-emerald-700">{p.estimatedPay > 0 ? money(p.estimatedPay) : '–'}</td>
                </tr>
              );
            })}
            {ids.length === 0 && <tr><td colSpan={8} className="text-center py-6 text-slate-400">{t('pay.none')}</td></tr>}
          </tbody>
          {ids.length > 0 && (
            <tfoot className="bg-slate-50 font-semibold text-slate-900">
              <tr>
                <td className="px-3 py-2.5">{t('pay.total')}</td>
                <td />
                <td className="px-3 py-2.5 text-center">{total.shifts}</td>
                <td className="px-3 py-2.5 text-center">{fmt1(total.regularHours)}</td>
                <td className="px-3 py-2.5 text-center">{fmt1(total.overtime125)}</td>
                <td className="px-3 py-2.5 text-center">{fmt1(total.overtime150)}</td>
                <td className="px-3 py-2.5 text-center">{fmt1(total.totalHours)}</td>
                <td className="px-3 py-2.5 text-end text-emerald-700">{money(total.estimatedPay)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="px-3 py-2.5 text-xs text-slate-500 border-t border-slate-100 bg-slate-50">
        {t('pay.note')}
      </p>
    </div>
  );
};
