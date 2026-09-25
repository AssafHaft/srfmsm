import React, { useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, FileUp, History, Loader2, Lock, Pin, RotateCcw, SlidersHorizontal, Sparkles, SquarePen } from 'lucide-react';
import { ShiftConfig } from '../../types';
import { formatShortDate, monthLabel, shiftMonth } from '../../lib/dates';
import { Continuity, describeCarried } from '../../lib/continuity';
import type { CapacityCheck } from '../../lib/engine';
import { Button, Card, Menu, MenuItem, cx } from '../ui';
import { PrioritiesEditor } from '../PrioritiesEditor';

export const PlanPanel: React.FC<{
  year: number;
  month: number;
  goToMonth: (y: number, m: number) => void;
  continuity: Continuity;
  continuityMode: 'auto' | 'custom' | 'none';
  hasPreviousVersion: boolean;
  setContinuityMode: (m: 'auto' | 'none') => void;
  onImportCsv: (file: File) => void;
  onEditContext: () => void;
  kept: { locked: number; pinned: number; carried: number };
  capacity: CapacityCheck;
  activeWorkers: number;
  config: ShiftConfig;
  setConfig: (c: ShiftConfig) => void;
  generating: boolean;
  onGenerate: () => void;
  hasVersion: boolean;
}> = props => {
  const { year, month, goToMonth, continuity, kept, capacity, generating } = props;
  const [showPriorities, setShowPriorities] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const short = capacity.capacity < capacity.slots;

  const sourceText = continuity.source === 'version'
    ? `Continues from ${continuity.label}`
    : continuity.source === 'custom'
      ? continuity.label
      : props.continuityMode === 'none' ? 'Starts fresh' : 'Starts fresh (no schedule for last month)';

  return (
    <Card className="p-4 print:hidden">
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label="Previous month" onClick={() => goToMonth(prev.year, prev.month)} className="rounded-lg p-2 hover:bg-slate-100 text-slate-600"><ChevronLeft className="w-5 h-5" /></button>
        <div className="text-center">
          <div className="text-lg font-semibold text-slate-900">{monthLabel(year, month)}</div>
          <div className="text-xs text-slate-500">{capacity.slots} shifts to fill · {props.activeWorkers} active workers</div>
        </div>
        <button type="button" aria-label="Next month" onClick={() => goToMonth(next.year, next.month)} className="rounded-lg p-2 hover:bg-slate-100 text-slate-600"><ChevronRight className="w-5 h-5" /></button>
      </div>

      {capacity.shortDays.length > 0 && (
        <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            Not enough people available on {capacity.shortDays.slice(0, 3).map(d => `${formatShortDate(d.date)} (${d.available} of ${d.needed})`).join(', ')}
            {capacity.shortDays.length > 3 && ` and ${capacity.shortDays.length - 3} more day${capacity.shortDays.length > 4 ? 's' : ''}`}. Those slots will stay unfilled unless time off or staffing changes.
          </span>
        </div>
      )}

      {short && (
        <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Your team can legally cover about <b>{capacity.capacity}</b> of <b>{capacity.slots}</b> shifts (limits, time off, rest rules). Expect around {capacity.slots - capacity.capacity} unfilled slots.</span>
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Start of month</span>
          <Menu button={toggle => <Button size="sm" variant="ghost" onClick={toggle} aria-label="Change start of month">Change <ChevronDown className="w-3.5 h-3.5" /></Button>}>
            {close => <>
              <MenuItem icon={<RotateCcw className="w-4 h-4" />} hint={props.hasPreviousVersion ? 'Use last month\'s final (or latest) schedule' : 'No schedule for last month yet'}
                onClick={() => { props.setContinuityMode('auto'); close(); }}>Continue from last month</MenuItem>
              <MenuItem icon={<FileUp className="w-4 h-4" />} hint="A CSV exported from this app" onClick={() => { fileRef.current?.click(); close(); }}>Import CSV…</MenuItem>
              <MenuItem icon={<SquarePen className="w-4 h-4" />} hint="Type in how last month ended" onClick={() => { props.onEditContext(); close(); }}>Enter / edit manually…</MenuItem>
              <MenuItem icon={<Sparkles className="w-4 h-4" />} hint="Ignore last month" onClick={() => { props.setContinuityMode('none'); close(); }}>Start fresh</MenuItem>
            </>}
          </Menu>
        </div>
        <div className="rounded-lg border border-slate-200 p-2.5 text-sm">
          <div className="flex items-start gap-1.5 text-slate-800"><History className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" /><span className="min-w-0 break-words">{sourceText}</span></div>
          {continuity.source !== 'none' && <div className="text-xs text-slate-500 mt-0.5 ml-5">{describeCarried(continuity)}</div>}
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) props.onImportCsv(f); }} />
      </div>

      {(kept.locked > 0 || kept.pinned > 0) && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-blue-800 bg-blue-50 border border-blue-100 rounded-lg p-2.5">
          <span className="font-medium">Kept when regenerating:</span>
          {kept.locked > 0 && <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> {kept.locked} locked day{kept.locked > 1 ? 's' : ''}</span>}
          {kept.pinned > 0 && <span className="flex items-center gap-1"><Pin className="w-3 h-3" /> {kept.pinned} pinned shift{kept.pinned > 1 ? 's' : ''}</span>}
        </div>
      )}

      <div className="mt-4">
        <button type="button" onClick={() => setShowPriorities(v => !v)} className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800">
          <span className="flex items-center gap-1.5"><SlidersHorizontal className="w-3.5 h-3.5" /> Priorities</span>
          <ChevronDown className={cx('w-4 h-4 transition', showPriorities && 'rotate-180')} />
        </button>
        {showPriorities && <div className="mt-2"><PrioritiesEditor compact config={props.config} onChange={props.setConfig} /></div>}
      </div>

      <Button variant="primary" className="w-full mt-4 py-2.5" disabled={generating || props.activeWorkers === 0} onClick={props.onGenerate}>
        {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : <><Sparkles className="w-4 h-4" /> {props.hasVersion ? 'Generate new version' : 'Generate schedule'}</>}
      </Button>
      {props.activeWorkers === 0 && <p className="text-xs text-red-600 mt-2 text-center">Add at least one active worker first.</p>}
    </Card>
  );
};
