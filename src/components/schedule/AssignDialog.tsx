import React, { useMemo } from 'react';
import { Moon, Pin, Sun, Trash2 } from 'lucide-react';
import { Employee, ScheduleVersion, ShiftConfig, ShiftType } from '../../types';
import { assignmentHints, Issue } from '../../lib/validate';
import { formatDayLabel } from '../../lib/dates';
import { WorkerStats } from '../../lib/stats';
import { Badge, Button, ColorDot, Modal, cx, useConfirm } from '../ui';
import type { People } from './derived';
import { useI18n } from '../../i18n';

export interface SlotRef {
  date: string;
  shift: ShiftType;
  currentId?: string; // the person in this slot, when replacing
}

interface Candidate {
  e: Employee;
  hints: Issue[];
  errors: number;
  warnings: number;
  worksToday: ShiftType | null;
  gap: number; // shifts minus fair share (negative = under)
}

export const AssignDialog: React.FC<{
  slot: SlotRef;
  version: ScheduleVersion;
  employees: Employee[];
  config: ShiftConfig;
  people: People;
  stats: Record<string, WorkerStats>;
  onAssign: (empId: string) => void;
  onRemove: () => void;
  onTogglePin: () => void;
  onClose: () => void;
}> = ({ slot, version, employees, config, people, stats, onAssign, onRemove, onTogglePin, onClose }) => {
  const day = version.schedule.find(d => d.date === slot.date);
  const isDay = slot.shift === ShiftType.DAY;
  const confirm = useConfirm();
  const { t, lang } = useI18n();

  const candidates = useMemo<Candidate[]>(() => {
    if (!day) return [];
    // When replacing, judge candidates as if the current person was removed
    const base = slot.currentId
      ? version.schedule.map(d => d.date !== slot.date ? d : {
        ...d, dayShift: d.dayShift.filter(id => id !== slot.currentId), nightShift: d.nightShift.filter(id => id !== slot.currentId),
      })
      : version.schedule;
    const baseDay = base.find(d => d.date === slot.date)!;
    return employees
      .filter(e => e.id !== slot.currentId)
      .map(e => {
        const hints = assignmentHints(base, e, slot.date, slot.shift, config, version.history, employees);
        const worksToday = baseDay.dayShift.includes(e.id) ? ShiftType.DAY : baseDay.nightShift.includes(e.id) ? ShiftType.NIGHT : null;
        const s = stats[e.id];
        return {
          e, hints, worksToday,
          errors: hints.filter(h => h.severity === 'error').length,
          warnings: hints.filter(h => h.severity === 'warning').length,
          gap: s?.target ? s.shifts - s.target.shifts : (s?.shifts ?? 0),
        };
      })
      .filter(c => c.worksToday !== slot.shift)
      .sort((a, b) =>
        Number(a.e.active === false) - Number(b.e.active === false) ||
        Number(!!a.worksToday) - Number(!!b.worksToday) ||
        a.errors - b.errors || a.warnings - b.warnings ||
        a.hints.length - b.hints.length || a.gap - b.gap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, slot, version, employees, config, stats, lang]);

  if (!day) return null;

  const pick = async (c: Candidate) => {
    if (c.errors > 0) {
      const msg = c.hints.filter(h => h.severity === 'error').map(h => `• ${h.message}`).join('\n');
      const ok = await confirm({ title: t('a.breaksTitle', { name: c.e.name }), message: `${msg}\n\n${t('a.assignAnywayQ')}`, confirmLabel: t('a.assignAnyway'), danger: true });
      if (!ok) return;
    }
    onAssign(c.e.id);
  };

  const pinned = !!(slot.currentId && day.pinned?.includes(slot.currentId));

  return (
    <Modal
      open
      onClose={onClose}
      title={<span className="flex items-center gap-2">{isDay ? <Sun className="w-4 h-4 text-amber-600" /> : <Moon className="w-4 h-4 text-indigo-600" />}
        {t(slot.currentId ? (isDay ? 'a.changeDay' : 'a.changeNight') : (isDay ? 'a.assignDay' : 'a.assignNight'))} · {formatDayLabel(slot.date)}</span>}
    >
      {slot.currentId && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm"><ColorDot color={people.colorOf(slot.currentId)} /><span dir="auto" className="font-medium">{people.nameOf(slot.currentId)}</span>
            {pinned && <Badge tone="blue"><Pin className="w-3 h-3" /> {t('cal.pinned')}</Badge>}</span>
          <span className="flex gap-2">
            <Button size="sm" onClick={onTogglePin}><Pin className="w-3.5 h-3.5" /> {pinned ? t('cal.unpin') : t('cal.pin')}</Button>
            <Button size="sm" variant="danger" onClick={onRemove}><Trash2 className="w-3.5 h-3.5" /> {t('ui.remove')}</Button>
          </span>
        </div>
      )}
      <p className="text-xs text-slate-500 mb-2">{slot.currentId ? t('a.orReplace') : t('a.bestFirst')} {t('a.pinnedNote')}</p>
      <div className="grid grid-cols-1 gap-1.5">
        {candidates.map(c => {
          const s = stats[c.e.id];
          return (
            <button key={c.e.id} type="button" onClick={() => pick(c)}
              className={cx('w-full text-start rounded-lg border p-2.5 transition',
                c.errors ? 'border-red-200 bg-red-50/40 hover:bg-red-50' : c.warnings ? 'border-amber-200 bg-amber-50/40 hover:bg-amber-50' : 'border-slate-200 hover:bg-blue-50 hover:border-blue-200')}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <ColorDot color={c.e.color} />
                  <span dir="auto" className="font-medium text-slate-900 truncate">{c.e.name}</span>
                  {c.e.active === false && <Badge>{t('w.inactive')}</Badge>}
                  {c.worksToday && <Badge tone="blue">{c.worksToday === ShiftType.DAY ? t('a.movesFromDay') : t('a.movesFromNight')}</Badge>}
                </span>
                <span className="text-xs text-slate-500 shrink-0">
                  {s?.target ? t('a.shiftsOfShare', { n: s.shifts, share: s.target.shifts.toFixed(1) }) : t('a.shifts', { count: s?.shifts ?? 0 })}
                </span>
              </div>
              {c.hints.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.hints.map((h, i) => (
                    <Badge key={i} tone={h.severity === 'error' ? 'red' : h.severity === 'warning' ? 'amber' : 'slate'}>{h.message}</Badge>
                  ))}
                </div>
              )}
            </button>
          );
        })}
        {candidates.length === 0 && <p className="text-sm text-slate-500">{t('a.everyone')}</p>}
      </div>
    </Modal>
  );
};
