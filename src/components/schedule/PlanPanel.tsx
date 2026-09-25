import React, { useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, FileUp, History, Loader2, Lock, Pin, RotateCcw, SlidersHorizontal, Sparkles, SquarePen } from 'lucide-react';
import { ShiftConfig } from '../../types';
import { formatShortDate, monthLabel, shiftMonth } from '../../lib/dates';
import { Continuity, describeCarried } from '../../lib/continuity';
import type { CapacityCheck } from '../../lib/engine';
import { Button, Card, Menu, MenuItem, cx } from '../ui';
import { PrioritiesEditor } from '../PrioritiesEditor';
import { useI18n } from '../../i18n';

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
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const short = capacity.capacity < capacity.slots;

  const sourceText = continuity.source === 'version'
    ? t('plan.continuesFrom', { label: continuity.label })
    : continuity.source === 'custom'
      ? continuity.label
      : props.continuityMode === 'none' ? t('plan.fresh') : t('plan.freshNoPrev');

  return (
    <Card className="p-4 print:hidden">
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label={t('plan.prevMonth')} onClick={() => goToMonth(prev.year, prev.month)} className="rounded-lg p-2 hover:bg-slate-100 text-slate-600"><ChevronLeft className="w-5 h-5 rtl:rotate-180" /></button>
        <div className="text-center">
          <div className="text-lg font-semibold text-slate-900">{monthLabel(year, month)}</div>
          <div className="text-xs text-slate-500">{t('plan.summary', { slots: capacity.slots, workers: props.activeWorkers })}</div>
        </div>
        <button type="button" aria-label={t('plan.nextMonth')} onClick={() => goToMonth(next.year, next.month)} className="rounded-lg p-2 hover:bg-slate-100 text-slate-600"><ChevronRight className="w-5 h-5 rtl:rotate-180" /></button>
      </div>

      {capacity.shortDays.length > 0 && (
        <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            {t('plan.shortDays', {
              days: capacity.shortDays.slice(0, 3).map(d => t('plan.shortDay', { date: formatShortDate(d.date), available: d.available, needed: d.needed })).join(', ')
                + (capacity.shortDays.length > 3 ? t('plan.andMore', { count: capacity.shortDays.length - 3 }) : ''),
            })}
          </span>
        </div>
      )}

      {short && (
        <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{t('plan.capacity', { capacity: capacity.capacity, slots: capacity.slots, missing: capacity.slots - capacity.capacity })}</span>
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('plan.start')}</span>
          <Menu button={toggle => <Button size="sm" variant="ghost" onClick={toggle} aria-label={t('plan.changeStart')}>{t('plan.change')} <ChevronDown className="w-3.5 h-3.5" /></Button>}>
            {close => <>
              <MenuItem icon={<RotateCcw className="w-4 h-4" />} hint={props.hasPreviousVersion ? t('plan.autoHint') : t('plan.autoNone')}
                onClick={() => { props.setContinuityMode('auto'); close(); }}>{t('plan.auto')}</MenuItem>
              <MenuItem icon={<FileUp className="w-4 h-4" />} hint={t('plan.csvHint')} onClick={() => { fileRef.current?.click(); close(); }}>{t('plan.csv')}</MenuItem>
              <MenuItem icon={<SquarePen className="w-4 h-4" />} hint={t('plan.manualHint')} onClick={() => { props.onEditContext(); close(); }}>{t('plan.manual')}</MenuItem>
              <MenuItem icon={<Sparkles className="w-4 h-4" />} hint={t('plan.freshHint')} onClick={() => { props.setContinuityMode('none'); close(); }}>{t('plan.freshItem')}</MenuItem>
            </>}
          </Menu>
        </div>
        <div className="rounded-lg border border-slate-200 p-2.5 text-sm">
          <div className="flex items-start gap-1.5 text-slate-800"><History className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" /><span className="min-w-0 break-words">{sourceText}</span></div>
          {continuity.source !== 'none' && <div className="text-xs text-slate-500 mt-0.5 ms-5">{describeCarried(continuity)}</div>}
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) props.onImportCsv(f); }} />
      </div>

      {(kept.locked > 0 || kept.pinned > 0) && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-blue-800 bg-blue-50 border border-blue-100 rounded-lg p-2.5">
          <span className="font-medium">{t('plan.kept')}</span>
          {kept.locked > 0 && <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> {t('plan.lockedDays', { count: kept.locked })}</span>}
          {kept.pinned > 0 && <span className="flex items-center gap-1"><Pin className="w-3 h-3" /> {t('plan.pinnedShifts', { count: kept.pinned })}</span>}
        </div>
      )}

      <div className="mt-4">
        <button type="button" onClick={() => setShowPriorities(v => !v)} className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800">
          <span className="flex items-center gap-1.5"><SlidersHorizontal className="w-3.5 h-3.5" /> {t('p.title')}</span>
          <ChevronDown className={cx('w-4 h-4 transition', showPriorities && 'rotate-180')} />
        </button>
        {showPriorities && <div className="mt-2"><PrioritiesEditor compact config={props.config} onChange={props.setConfig} /></div>}
      </div>

      <Button variant="primary" className="w-full mt-4 py-2.5" disabled={generating || props.activeWorkers === 0} onClick={props.onGenerate}>
        {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('plan.generating')}</> : <><Sparkles className="w-4 h-4" /> {props.hasVersion ? t('plan.generateNew') : t('plan.generate')}</>}
      </Button>
      {props.activeWorkers === 0 && <p className="text-xs text-red-600 mt-2 text-center">{t('plan.noWorkers')}</p>}
    </Card>
  );
};
