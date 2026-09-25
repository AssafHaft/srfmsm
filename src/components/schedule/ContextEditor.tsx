import React, { useState } from 'react';
import { Info, Moon, Sun } from 'lucide-react';
import { DayAssignmentMap, Employee } from '../../types';
import { addDays, formatDayLabel, gridKeys } from '../../lib/dates';
import { Button, Modal, cx } from '../ui';

// Manual entry of how the previous month ended: the week before the grid
// (history for rest/streak rules) and the first grid week (kept as-is).
export const ContextEditor: React.FC<{
  year: number;
  month: number;
  employees: Employee[];
  initial: DayAssignmentMap;
  onSave: (entries: DayAssignmentMap) => void;
  onClose: () => void;
}> = ({ year, month, employees, initial, onSave, onClose }) => {
  const grid = gridKeys(year, month);
  const before = Array.from({ length: 7 }, (_, i) => addDays(grid[0], i - 7));
  const firstWeek = grid.slice(0, 7);
  const [data, setData] = useState<DayAssignmentMap>(() => {
    const out: DayAssignmentMap = {};
    [...before, ...firstWeek].forEach(d => {
      const e = initial[d];
      if (e) out[d] = { dayShift: [...e.dayShift], nightShift: [...e.nightShift] };
    });
    return out;
  });

  const toggle = (date: string, shift: 'dayShift' | 'nightShift', id: string) => {
    setData(p => {
      const cur = p[date] || { dayShift: [], nightShift: [] };
      const other = shift === 'dayShift' ? 'nightShift' : 'dayShift';
      const on = cur[shift].includes(id);
      return {
        ...p,
        [date]: {
          ...cur,
          [shift]: on ? cur[shift].filter(x => x !== id) : [...cur[shift], id],
          [other]: cur[other].filter(x => x !== id),
        } as { dayShift: string[]; nightShift: string[] },
      };
    });
  };

  const save = () => {
    const out: DayAssignmentMap = {};
    before.forEach(d => { out[d] = data[d] || { dayShift: [], nightShift: [] }; });
    // Grid days with nobody entered are left for the generator
    firstWeek.forEach(d => {
      const e = data[d];
      if (e && e.dayShift.length + e.nightShift.length > 0) out[d] = e;
    });
    onSave(out);
  };

  const people = employees.filter(e => e.active !== false || Object.values(data).some(d => d.dayShift.includes(e.id) || d.nightShift.includes(e.id)));

  const row = (date: string, kept: boolean) => {
    const e = data[date] || { dayShift: [], nightShift: [] };
    return (
      <div key={date} className={cx('rounded-lg border p-2', kept ? 'border-blue-200 bg-white' : 'border-dashed border-slate-300 bg-slate-50')}>
        <div className="text-sm font-medium text-slate-800 mb-1.5">{formatDayLabel(date)}</div>
        {(['dayShift', 'nightShift'] as const).map(shift => (
          <div key={shift} className="flex items-start gap-2 mb-1">
            <span className={cx('w-12 shrink-0 flex items-center gap-1 text-[11px] font-semibold uppercase pt-1', shift === 'dayShift' ? 'text-amber-700' : 'text-indigo-700')}>
              {shift === 'dayShift' ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}{shift === 'dayShift' ? 'Day' : 'Night'}
            </span>
            <div className="flex flex-wrap gap-1">
              {people.map(p => {
                const on = e[shift].includes(p.id);
                return (
                  <button key={p.id} type="button" dir="auto" onClick={() => toggle(date, shift, p.id)} aria-pressed={on}
                    className={cx('rounded-full border px-2 py-0.5 text-xs', on ? 'border-slate-500 text-slate-900 font-medium shadow-sm' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-400')}
                    style={on ? { backgroundColor: p.color } : undefined}>
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Modal open wide onClose={onClose} title="How did last month end?"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save}>Save</Button>
      </>}>
      <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 flex gap-2">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <p><b>Before the calendar</b> (dashed): used only to respect rest, streak and no-day-after-night rules at the start of the month.</p>
          <p className="mt-1"><b>First calendar week</b>: days you fill in are kept exactly as entered (e.g. what was already published). Days left empty are generated.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="grid grid-cols-1 gap-2 content-start">
          <h4 className="text-xs font-semibold uppercase text-slate-500 text-center">Before the calendar</h4>
          {before.map(d => row(d, false))}
        </div>
        <div className="grid grid-cols-1 gap-2 content-start">
          <h4 className="text-xs font-semibold uppercase text-blue-700 text-center">First calendar week (kept)</h4>
          {firstWeek.map(d => row(d, true))}
        </div>
      </div>
    </Modal>
  );
};
