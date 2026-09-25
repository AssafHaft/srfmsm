import React from 'react';
import { AlertTriangle, History, Lock, Moon, Pin, Plus, Settings2, Star, Sun, Unlock, X } from 'lucide-react';
import { DailySchedule, ScheduleVersion, ShiftConfig, ShiftType } from '../../types';
import { dayPlan, DayPlan } from '../../lib/config';
import { cellKey, Issue, ValidationResult } from '../../lib/validate';
import { parseDateKey, WEEKDAYS_SHORT } from '../../lib/dates';
import { cx } from '../ui';
import type { People } from './derived';

export interface CalendarHandlers {
  onOpenSlot: (date: string, shift: ShiftType, currentId?: string) => void;
  onRemove: (date: string, empId: string) => void;
  onTogglePin: (date: string, empId: string) => void;
  onToggleLock: (date: string) => void;
  onEditDay: (date: string) => void;
}

interface CellProps extends CalendarHandlers {
  day: DailySchedule;
  plan: DayPlan;
  people: People;
  issuesFor: (date: string, empId: string) => Issue[];
  compact: boolean;
}

const issueTone = (issues: Issue[]) =>
  issues.some(i => i.severity === 'error') ? 'error' : issues.some(i => i.severity === 'warning') ? 'warning' : issues.length ? 'info' : null;

const Chip: React.FC<{ id: string; date: string; shift: ShiftType; pinned: boolean; padding: boolean } & Pick<CellProps, 'people' | 'issuesFor' | 'onOpenSlot' | 'onRemove' | 'onTogglePin'>> = ({
  id, date, shift, pinned, padding, people, issuesFor, onOpenSlot, onRemove, onTogglePin,
}) => {
  const issues = issuesFor(date, id);
  const tone = issueTone(issues);
  const name = people.nameOf(id);
  const tip = [name, pinned ? 'Pinned: kept when regenerating' : '', ...issues.map(i => `• ${i.message}`)].filter(Boolean).join('\n');
  return (
    <div
      className={cx('group/chip flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-slate-900 shadow-sm min-w-0',
        shift === ShiftType.NIGHT && 'border-l-2 border-indigo-500',
        tone === 'error' && 'ring-2 ring-red-500', tone === 'warning' && 'ring-2 ring-amber-400',
        padding && 'opacity-60')}
      style={{ backgroundColor: people.colorOf(id) }}
      title={tip}
    >
      {pinned && <Pin className="w-3 h-3 shrink-0 text-slate-700" aria-label="Pinned" />}
      <button type="button" dir="auto" onClick={() => onOpenSlot(date, shift, id)} className="truncate flex-1 text-left min-w-0">{name}</button>
      {tone && tone !== 'info' && <AlertTriangle className={cx('w-3 h-3 shrink-0', tone === 'error' ? 'text-red-600' : 'text-amber-600')} aria-label="Rule issue" />}
      <span className="hidden sm:group-hover/chip:flex items-center gap-0.5 shrink-0 print:hidden">
        <button type="button" aria-label={pinned ? 'Unpin' : 'Pin'} title={pinned ? 'Unpin' : 'Pin: keep when regenerating'} onClick={() => onTogglePin(date, id)} className="text-slate-600 hover:text-slate-900"><Pin className="w-3 h-3" /></button>
        <button type="button" aria-label="Remove from shift" title="Remove from shift" onClick={() => onRemove(date, id)} className="text-slate-600 hover:text-red-600"><X className="w-3 h-3" /></button>
      </span>
    </div>
  );
};

const ShiftBlock: React.FC<{ shift: ShiftType } & CellProps> = props => {
  const { shift, day, plan, compact } = props;
  const ids = shift === ShiftType.DAY ? day.dayShift : day.nightShift;
  const required = shift === ShiftType.DAY ? plan.req.day : plan.req.night;
  const soloCovered = plan.solo && day.dayShift.length + day.nightShift.length >= 1;
  const missing = soloCovered ? 0 : Math.max(0, required - ids.length);
  if (required === 0 && ids.length === 0) return null;
  const isDay = shift === ShiftType.DAY;
  const label = plan.solo && required > 0 ? 'Full day' : isDay ? 'Day' : 'Night';
  return (
    <div className={cx('rounded-md p-1 border', isDay ? 'bg-amber-50/70 border-amber-100' : 'bg-indigo-50/70 border-indigo-100')}>
      <div className={cx('flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide mb-0.5', isDay ? 'text-amber-700' : 'text-indigo-700')}>
        {isDay ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}{label}
      </div>
      <div className={cx(compact ? 'flex flex-wrap gap-1' : 'grid grid-cols-1 gap-1')}>
        {ids.map(id => (
          <Chip key={id} id={id} date={day.date} shift={shift} pinned={!!day.pinned?.includes(id)} padding={!!day.isPadding}
            people={props.people} issuesFor={props.issuesFor} onOpenSlot={props.onOpenSlot} onRemove={props.onRemove} onTogglePin={props.onTogglePin} />
        ))}
        {Array.from({ length: missing }).map((_, i) => (
          <button key={i} type="button" onClick={() => props.onOpenSlot(day.date, shift)}
            className={cx('flex items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-xs font-medium',
              day.isPadding ? 'border-slate-300 text-slate-500' : 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100')}>
            <Plus className="w-3 h-3" /> Unfilled
          </button>
        ))}
        {missing === 0 && (
          <button type="button" onClick={() => props.onOpenSlot(day.date, shift)} aria-label={`Add ${isDay ? 'day' : 'night'} worker`}
            className={cx('rounded text-[11px] text-slate-400 hover:text-slate-700 hover:bg-white/70 print:hidden', compact ? 'px-1.5' : 'opacity-0 group-hover:opacity-100 focus:opacity-100 transition')}>
            + Add
          </button>
        )}
      </div>
    </div>
  );
};

const DayHeader: React.FC<CellProps & { showWeekday: boolean }> = ({ day, plan, onToggleLock, onEditDay, showWeekday }) => {
  const d = parseDateKey(day.date);
  return (
    <div className="flex items-center justify-between gap-1 mb-1">
      <div className="flex items-center gap-1 min-w-0">
        <button type="button" onClick={() => onToggleLock(day.date)}
          aria-label={day.locked ? 'Unlock day' : 'Lock day'}
          title={day.locked ? (day.carried ? 'Carried over from last month. Unlock to let it change when regenerating.' : 'Locked: kept as-is when regenerating. Click to unlock.') : 'Lock: keep this day as-is when regenerating'}
          className={cx('shrink-0 print:hidden', day.locked ? 'text-blue-600' : 'text-slate-300 hover:text-blue-500')}>
          {day.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
        </button>
        {day.carried && <span className="inline-flex items-center rounded bg-blue-50 text-blue-700 px-1 text-[10px] font-medium" title="Kept from last month's schedule"><History className="w-3 h-3" /></span>}
      </div>
      <div className={cx('flex items-center gap-1 text-sm font-semibold', day.isPadding ? 'text-slate-400' : 'text-slate-700')}>
        {plan.premium && !day.isPadding && <Star className="w-3 h-3 text-amber-400 fill-amber-300" aria-label="Weekend day" />}
        {showWeekday && <span className="text-xs font-medium text-slate-500">{WEEKDAYS_SHORT[d.getDay()]}</span>}
        <span>{d.getDate()}</span>
        <button type="button" onClick={() => onEditDay(day.date)} aria-label="Day settings" title="Special day: closure, holiday staffing or hours"
          className={cx('print:hidden', plan.special ? 'text-purple-600' : 'text-slate-300 hover:text-slate-600')}>
          <Settings2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

const DayCell: React.FC<CellProps> = props => {
  const { day, plan } = props;
  return (
    <div data-date={day.date} className={cx('group min-h-[124px] p-1.5 flex flex-col gap-1', day.isPadding ? 'bg-slate-50' : 'bg-white', day.locked && 'ring-2 ring-inset ring-blue-300')}>
      <DayHeader {...props} showWeekday={false} />
      {plan.label && <div dir="auto" className="text-[10px] font-medium text-purple-700 truncate -mt-1" title={plan.label}>{plan.label}</div>}
      {plan.closed && day.dayShift.length + day.nightShift.length === 0
        ? <div className="flex-1 flex items-center justify-center text-xs text-slate-400">Closed</div>
        : <>
          <ShiftBlock shift={ShiftType.DAY} {...props} />
          <div className="mt-auto"><ShiftBlock shift={ShiftType.NIGHT} {...props} /></div>
        </>}
    </div>
  );
};

const DayRow: React.FC<CellProps> = props => {
  const { day, plan } = props;
  const d = parseDateKey(day.date);
  return (
    <div data-date={day.date} className={cx('group p-2.5 border-b border-slate-100', day.isPadding ? 'bg-slate-50' : 'bg-white', day.locked && 'border-l-4 border-l-blue-300')}>
      <DayHeader {...props} showWeekday />
      {plan.label && <div dir="auto" className="text-xs font-medium text-purple-700 mb-1">{plan.label}</div>}
      {plan.closed && day.dayShift.length + day.nightShift.length === 0
        ? <div className="text-xs text-slate-400">Closed</div>
        : <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <ShiftBlock shift={ShiftType.DAY} {...props} />
          <ShiftBlock shift={ShiftType.NIGHT} {...props} />
        </div>}
      {d.getDay() === 6 && <div className="h-2" />}
    </div>
  );
};

export const CalendarView: React.FC<{
  version: ScheduleVersion;
  config: ShiftConfig;
  people: People;
  validation: ValidationResult;
  mode: 'grid' | 'list';
} & CalendarHandlers> = ({ version, config, people, validation, mode, ...handlers }) => {
  const issuesFor = (date: string, empId: string) => validation.byCell.get(cellKey(date, empId)) || [];
  const cells = version.schedule.map(day => ({ day, plan: dayPlan(config, day.date) }));
  if (mode === 'list') {
    return (
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        {cells.map(({ day, plan }) => (
          <DayRow key={day.date} day={day} plan={plan} people={people} issuesFor={issuesFor} compact {...handlers} />
        ))}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200 text-center py-2 text-xs font-semibold text-slate-500 uppercase">
        {WEEKDAYS_SHORT.map(d => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 bg-slate-200 gap-px">
        {cells.map(({ day, plan }) => (
          <DayCell key={day.date} day={day} plan={plan} people={people} issuesFor={issuesFor} compact={false} {...handlers} />
        ))}
      </div>
    </div>
  );
};
