import React, { useMemo } from 'react';
import { Moon, Pin, Sun, Trash2 } from 'lucide-react';
import { Employee, ScheduleVersion, ShiftConfig, ShiftType } from '../../types';
import { assignmentHints, Issue } from '../../lib/validate';
import { formatDayLabel } from '../../lib/dates';
import { WorkerStats } from '../../lib/stats';
import { Badge, Button, ColorDot, Modal, cx, useConfirm } from '../ui';
import type { People } from './derived';

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
  }, [day, slot, version, employees, config, stats]);

  if (!day) return null;

  const pick = async (c: Candidate) => {
    if (c.errors > 0) {
      const msg = c.hints.filter(h => h.severity === 'error').map(h => `• ${h.message}`).join('\n');
      const ok = await confirm({ title: `This breaks a rule for ${c.e.name}`, message: `${msg}\n\nAssign anyway?`, confirmLabel: 'Assign anyway', danger: true });
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
        {slot.currentId ? 'Change' : 'Assign'} {isDay ? 'day' : 'night'} shift · {formatDayLabel(slot.date)}</span>}
    >
      {slot.currentId && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm"><ColorDot color={people.colorOf(slot.currentId)} /><span dir="auto" className="font-medium">{people.nameOf(slot.currentId)}</span>
            {pinned && <Badge tone="blue"><Pin className="w-3 h-3" /> pinned</Badge>}</span>
          <span className="flex gap-2">
            <Button size="sm" onClick={onTogglePin}><Pin className="w-3.5 h-3.5" /> {pinned ? 'Unpin' : 'Pin'}</Button>
            <Button size="sm" variant="danger" onClick={onRemove}><Trash2 className="w-3.5 h-3.5" /> Remove</Button>
          </span>
        </div>
      )}
      <p className="text-xs text-slate-500 mb-2">{slot.currentId ? 'Or replace with:' : 'Best fits first.'} Manual choices are pinned, so regenerating keeps them.</p>
      <div className="grid grid-cols-1 gap-1.5">
        {candidates.map(c => {
          const s = stats[c.e.id];
          return (
            <button key={c.e.id} type="button" onClick={() => pick(c)}
              className={cx('w-full text-left rounded-lg border p-2.5 transition',
                c.errors ? 'border-red-200 bg-red-50/40 hover:bg-red-50' : c.warnings ? 'border-amber-200 bg-amber-50/40 hover:bg-amber-50' : 'border-slate-200 hover:bg-blue-50 hover:border-blue-200')}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <ColorDot color={c.e.color} />
                  <span dir="auto" className="font-medium text-slate-900 truncate">{c.e.name}</span>
                  {c.e.active === false && <Badge>inactive</Badge>}
                  {c.worksToday && <Badge tone="blue">moves from {c.worksToday === ShiftType.DAY ? 'day' : 'night'}</Badge>}
                </span>
                <span className="text-xs text-slate-500 shrink-0">
                  {s ? `${s.shifts}${s.target ? ` / ${s.target.shifts.toFixed(1)}` : ''} shifts` : '0 shifts'}
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
        {candidates.length === 0 && <p className="text-sm text-slate-500">Everyone already works this shift.</p>}
      </div>
    </Modal>
  );
};
