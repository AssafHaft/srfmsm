import React, { useMemo, useState } from 'react';
import { CalendarRange, Edit2, Plane, Plus, Trash2, UserCheck, UserX, Users } from 'lucide-react';
import { Employee, WorkerPreference } from '../types';
import { Badge, Button, Card, CardHeader, ColorDot, FieldLabel, IconButton, Modal, NumberField, Segmented, Toggle, cx, inputClass, useConfirm } from './ui';
import { WORKER_PALETTE, suggestWorkerColor } from '../lib/config';
import { addDays, dateRange, formatDateKey, formatShortDate, WEEKDAYS_SHORT } from '../lib/dates';
import { newId } from '../lib/generate';

export const PREFERENCE_OPTIONS: { value: WorkerPreference; label: string; hint: string }[] = [
  { value: WorkerPreference.DAY_ONLY, label: 'Day only', hint: 'Never scheduled on night shifts' },
  { value: WorkerPreference.PREFERS_DAY, label: 'Prefers day', hint: 'Mostly day shifts, nights when needed' },
  { value: WorkerPreference.EITHER, label: 'Either', hint: 'Balanced mix of day and night shifts' },
  { value: WorkerPreference.PREFERS_NIGHT, label: 'Prefers night', hint: 'Mostly night shifts, days when needed' },
  { value: WorkerPreference.NIGHT_ONLY, label: 'Night only', hint: 'Never scheduled on day shifts' },
];

export const preferenceTone = (p: WorkerPreference) =>
  p === WorkerPreference.DAY_ONLY || p === WorkerPreference.PREFERS_DAY ? 'amber'
    : p === WorkerPreference.NIGHT_ONLY || p === WorkerPreference.PREFERS_NIGHT ? 'indigo' : 'slate';

// Collapse sorted dates into [from, to] ranges for display
export function toRanges(dates: string[]): [string, string][] {
  const out: [string, string][] = [];
  [...dates].sort().forEach(d => {
    const last = out[out.length - 1];
    if (last && addDays(last[1], 1) === d) last[1] = d;
    else out.push([d, d]);
  });
  return out;
}

const rangeLabel = ([a, b]: [string, string]) => (a === b ? formatShortDate(a) : `${formatShortDate(a)} – ${formatShortDate(b)}`);

type DayState = 'available' | 'prefer' | 'off';

const WorkerEditor: React.FC<{
  initial: Employee;
  isNew: boolean;
  onSave: (e: Employee) => void;
  onClose: () => void;
}> = ({ initial, isNew, onSave, onClose }) => {
  const [draft, setDraft] = useState<Employee>(initial);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offKind, setOffKind] = useState<'off' | 'prefer'>('off');
  const a = draft.availability;
  const set = (patch: Partial<Employee>) => setDraft(d => ({ ...d, ...patch }));
  const setAvail = (patch: Partial<Employee['availability']>) => setDraft(d => ({ ...d, availability: { ...d.availability, ...patch } }));

  const dayState = (i: number): DayState => (a.daysOff.includes(i) ? 'off' : a.preferOffDays?.includes(i) ? 'prefer' : 'available');
  const cycleDay = (i: number) => {
    const next: DayState = dayState(i) === 'available' ? 'prefer' : dayState(i) === 'prefer' ? 'off' : 'available';
    const daysOff = a.daysOff.filter(d => d !== i);
    const preferOffDays = (a.preferOffDays || []).filter(d => d !== i);
    if (next === 'off') daysOff.push(i);
    if (next === 'prefer') preferOffDays.push(i);
    setAvail({ daysOff: daysOff.sort(), preferOffDays: preferOffDays.sort() });
  };

  const addTimeOff = () => {
    if (!from) return;
    const dates = dateRange(from, to && to >= from ? to : from);
    if (offKind === 'off') {
      setAvail({
        unavailableDates: [...new Set([...a.unavailableDates, ...dates])].sort(),
        preferOffDates: (a.preferOffDates || []).filter(d => !dates.includes(d)),
      });
    } else {
      setAvail({
        preferOffDates: [...new Set([...(a.preferOffDates || []), ...dates])].sort(),
        unavailableDates: a.unavailableDates.filter(d => !dates.includes(d)),
      });
    }
    setFrom('');
    setTo('');
  };
  const removeRange = (kind: 'off' | 'prefer', [s, e]: [string, string]) => {
    const drop = new Set(dateRange(s, e));
    if (kind === 'off') setAvail({ unavailableDates: a.unavailableDates.filter(d => !drop.has(d)) });
    else setAvail({ preferOffDates: (a.preferOffDates || []).filter(d => !drop.has(d)) });
  };

  const canSave = draft.name.trim().length > 0;
  const prefHint = PREFERENCE_OPTIONS.find(o => o.value === draft.preference)?.hint;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={isNew ? 'Add worker' : `Edit ${initial.name}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSave} onClick={() => onSave({ ...draft, name: draft.name.trim() })}>{isNew ? 'Add worker' : 'Save'}</Button>
      </>}
    >
      <div className="grid grid-cols-1 gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="w-name">Name</FieldLabel>
            <input id="w-name" dir="auto" autoFocus value={draft.name} onChange={e => set({ name: e.target.value })} className={cx(inputClass, 'w-full')} />
          </div>
          <div>
            <FieldLabel>Color</FieldLabel>
            <div className="flex items-center gap-2 flex-wrap">
              {WORKER_PALETTE.map(c => (
                <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => set({ color: c })}
                  className={cx('w-6 h-6 rounded-full border-2', draft.color === c ? 'border-blue-600 scale-110' : 'border-transparent')} style={{ backgroundColor: c }} />
              ))}
              <input type="color" aria-label="Custom color" value={draft.color} onChange={e => set({ color: e.target.value })} className="w-8 h-8 p-0.5 border rounded bg-white cursor-pointer" />
            </div>
          </div>
        </div>

        <div>
          <FieldLabel hint={prefHint}>Shift preference</FieldLabel>
          <Segmented size="sm" ariaLabel="Shift preference" value={draft.preference} onChange={v => set({ preference: v })}
            options={PREFERENCE_OPTIONS.map(o => ({ value: o.value, label: o.label, title: o.hint }))} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <FieldLabel hint="They get up to this many; also the target when there's enough work">Max shifts / month</FieldLabel>
            <NumberField allowEmpty min={1} max={31} value={draft.targetShifts} placeholder="No limit" onChange={v => set({ targetShifts: v ? Math.round(v) : undefined })} className="w-full" ariaLabel="Max shifts per month" />
          </div>
          <div>
            <FieldLabel hint="Used for the payroll estimate">Hourly rate (₪)</FieldLabel>
            <NumberField allowEmpty min={0} step={0.5} value={draft.hourlyRate} placeholder="e.g. 75" onChange={v => set({ hourlyRate: v || undefined })} className="w-full" ariaLabel="Hourly rate" />
          </div>
          <div>
            <FieldLabel hint="Inactive workers are left out of new schedules">Active</FieldLabel>
            <div className="flex items-center gap-2 h-9">
              <Toggle checked={draft.active !== false} onChange={v => set({ active: v })} label="Active" />
              <span className="text-sm text-slate-600">{draft.active !== false ? 'Included' : 'Left out'}</span>
            </div>
          </div>
        </div>

        <div>
          <FieldLabel hint="Tap a day to cycle: available → prefers off → can't work">Weekly availability</FieldLabel>
          <div className="flex gap-1.5 flex-wrap">
            {WEEKDAYS_SHORT.map((d, i) => {
              const s = dayState(i);
              return (
                <button key={d} type="button" onClick={() => cycleDay(i)} aria-label={`${d}: ${s}`}
                  className={cx('w-14 py-1.5 rounded-lg text-sm border font-medium transition',
                    s === 'available' && 'bg-white text-slate-700 border-slate-300',
                    s === 'prefer' && 'bg-amber-50 text-amber-800 border-amber-300',
                    s === 'off' && 'bg-red-50 text-red-700 border-red-300 line-through')}>
                  {d}
                </button>
              );
            })}
          </div>
          <div className="flex gap-3 mt-2 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-white border border-slate-300" /> Available</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-100 border border-amber-300" /> Prefers off (avoided when possible)</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-100 border border-red-300" /> Can't work</span>
          </div>
        </div>

        <div>
          <FieldLabel hint="Vacations, exams, one-off requests. Leave 'to' empty for a single day.">Time off</FieldLabel>
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
            <label className="text-xs text-slate-600">From<input type="date" value={from} onChange={e => setFrom(e.target.value)} className={cx(inputClass, 'block mt-0.5')} /></label>
            <label className="text-xs text-slate-600">To<input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} className={cx(inputClass, 'block mt-0.5')} /></label>
            <Segmented size="sm" value={offKind} onChange={setOffKind} ariaLabel="Type of time off"
              options={[{ value: 'off', label: "Can't work" }, { value: 'prefer', label: 'Prefers off' }]} />
            <Button size="sm" variant="primary" disabled={!from} onClick={addTimeOff}><Plus className="w-3.5 h-3.5" /> Add</Button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {toRanges(a.unavailableDates).map(r => (
              <span key={'o' + r[0]} className="inline-flex items-center gap-1 rounded-full bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-xs">
                <Plane className="w-3 h-3" /> {rangeLabel(r)}
                <button type="button" aria-label="Remove" onClick={() => removeRange('off', r)} className="ml-0.5 hover:text-red-900">×</button>
              </span>
            ))}
            {toRanges(a.preferOffDates || []).map(r => (
              <span key={'p' + r[0]} className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 text-xs">
                <CalendarRange className="w-3 h-3" /> {rangeLabel(r)} (prefers off)
                <button type="button" aria-label="Remove" onClick={() => removeRange('prefer', r)} className="ml-0.5 hover:text-amber-900">×</button>
              </span>
            ))}
            {a.unavailableDates.length + (a.preferOffDates?.length || 0) === 0 && <span className="text-xs text-slate-400">No time off added</span>}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export const WorkersTab: React.FC<{
  employees: Employee[];
  setEmployees: (fn: (p: Employee[]) => Employee[]) => void;
}> = ({ employees, setEmployees }) => {
  const [editing, setEditing] = useState<{ emp: Employee; isNew: boolean } | null>(null);
  const confirm = useConfirm();
  const today = formatDateKey(new Date());

  const startAdd = () => setEditing({
    isNew: true,
    emp: {
      id: newId(), name: '', preference: WorkerPreference.EITHER, color: suggestWorkerColor(employees), active: true, hourlyRate: employees[0]?.hourlyRate,
      availability: { daysOff: [], unavailableDates: [], preferOffDays: [], preferOffDates: [] },
    },
  });

  const save = (e: Employee) => {
    setEmployees(p => (p.some(x => x.id === e.id) ? p.map(x => (x.id === e.id ? e : x)) : [...p, e]));
    setEditing(null);
  };

  const remove = async (e: Employee) => {
    const ok = await confirm({
      title: `Delete ${e.name}?`,
      message: 'Past schedules keep showing their name. To leave someone out for a while, mark them inactive instead.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) setEmployees(p => p.filter(x => x.id !== e.id));
  };

  const activeCount = useMemo(() => employees.filter(e => e.active !== false).length, [employees]);

  return (
    <Card>
      <CardHeader
        icon={<Users className="w-5 h-5 text-blue-600" />}
        title="Workers"
        subtitle={`${activeCount} active${employees.length > activeCount ? `, ${employees.length - activeCount} inactive` : ''}`}
        actions={<Button variant="primary" onClick={startAdd}><Plus className="w-4 h-4" /> Add worker</Button>}
      />
      <div className="px-4 pb-4 grid gap-3 lg:grid-cols-2">
        {employees.length === 0 && <p className="text-sm text-slate-500 py-6 text-center lg:col-span-2">No workers yet. Add your team to start scheduling.</p>}
        {employees.map(e => {
          const upcomingOff = toRanges(e.availability.unavailableDates.filter(d => d >= today));
          const upcomingPrefer = (e.availability.preferOffDates || []).filter(d => d >= today).length;
          const inactive = e.active === false;
          return (
            <div key={e.id} className={cx('flex items-start justify-between gap-3 rounded-lg border p-3', inactive ? 'bg-slate-50 border-slate-200 opacity-70' : 'bg-white border-slate-200')}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <ColorDot color={e.color} />
                  <span dir="auto" className="font-medium text-slate-900">{e.name}</span>
                  <Badge tone={preferenceTone(e.preference)}>{PREFERENCE_OPTIONS.find(o => o.value === e.preference)?.label}</Badge>
                  {e.targetShifts ? <Badge tone="green">Max {e.targetShifts}/mo</Badge> : null}
                  {inactive && <Badge>Inactive</Badge>}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                  {e.hourlyRate ? <span>₪{e.hourlyRate}/h</span> : null}
                  {e.availability.daysOff.length > 0 && <span className="text-red-600">Never {e.availability.daysOff.map(d => WEEKDAYS_SHORT[d]).join(', ')}</span>}
                  {(e.availability.preferOffDays?.length || 0) > 0 && <span className="text-amber-700">Prefers off {e.availability.preferOffDays!.map(d => WEEKDAYS_SHORT[d]).join(', ')}</span>}
                  {upcomingOff.slice(0, 2).map(r => <span key={r[0]} className="text-blue-700 flex items-center gap-1"><Plane className="w-3 h-3" />{rangeLabel(r)}</span>)}
                  {upcomingOff.length > 2 && <span className="text-blue-700">+{upcomingOff.length - 2} more</span>}
                  {upcomingPrefer > 0 && <span className="text-amber-700">{upcomingPrefer} prefers-off date{upcomingPrefer > 1 ? 's' : ''}</span>}
                </div>
              </div>
              <div className="flex shrink-0">
                <IconButton label={inactive ? 'Mark active' : 'Mark inactive'} onClick={() => setEmployees(p => p.map(x => (x.id === e.id ? { ...x, active: inactive } : x)))}>
                  {inactive ? <UserCheck className="w-4 h-4" /> : <UserX className="w-4 h-4" />}
                </IconButton>
                <IconButton label="Edit" onClick={() => setEditing({ emp: e, isNew: false })}><Edit2 className="w-4 h-4" /></IconButton>
                <IconButton label="Delete" onClick={() => remove(e)} className="hover:text-red-600"><Trash2 className="w-4 h-4" /></IconButton>
              </div>
            </div>
          );
        })}
      </div>
      {editing && <WorkerEditor initial={editing.emp} isNew={editing.isNew} onSave={save} onClose={() => setEditing(null)} />}
    </Card>
  );
};
