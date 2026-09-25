import React, { useState } from 'react';
import { CalendarDays, Clock, Gauge, Plus, Settings, Star, Sun, Trash2 } from 'lucide-react';
import { ShiftConfig, SpecialDay } from '../types';
import { Badge, Button, Card, CardHeader, FieldLabel, IconButton, NumberField, Segmented, Toggle, cx, inputClass } from './ui';
import { DEFAULTS, DEFAULT_TIMING, splitShiftHours, windowHours } from '../lib/config';
import { dateRange, formatDateKey, formatDayLabel, weekdayLong, weekdayOf, weekdaysLong, weekdaysShort } from '../lib/dates';
import { PrioritiesEditor } from './PrioritiesEditor';
import { T, useI18n } from '../i18n';

const fmtH = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(1));

export const shiftLengthLabel = (t: T, day: number, night: number, window: number) =>
  day + night === 0 ? t('r.closed')
    : day > 0 && night > 0 ? t('r.split', { h: fmtH(splitShiftHours(window)) })
      : t('r.fullDay', { h: fmtH(window) });

const HoursAndStaffing: React.FC<{ config: ShiftConfig; onChange: (c: ShiftConfig) => void }> = ({ config, onChange }) => {
  const { t } = useI18n();
  const setReq = (i: number, field: 'day' | 'night', v: number) =>
    onChange({ ...config, requirements: { ...config.requirements, [i]: { ...config.requirements[i], [field]: v } } });
  const setTime = (i: number, field: 'startTime' | 'endTime', v: string) =>
    onChange({ ...config, dailyTimings: { ...config.dailyTimings, [i]: { ...(config.dailyTimings[i] || DEFAULT_TIMING), [field]: v } } });
  const copyToAll = (i: number) => {
    const tm = config.dailyTimings[i] || DEFAULT_TIMING;
    const dailyTimings = { ...config.dailyTimings };
    for (let d = 0; d < 7; d++) dailyTimings[d] = { ...tm };
    onChange({ ...config, dailyTimings });
  };
  return (
    <Card>
      <CardHeader icon={<Clock className="w-5 h-5 text-blue-600" />} title={t('r.hoursTitle')} subtitle={t('r.hoursSub')} />
      <div className="px-4 pb-4 grid grid-cols-1 gap-2">
        {weekdaysLong().map((name, i) => {
          const req = config.requirements[i] || { day: 1, night: 1 };
          const tm = config.dailyTimings[i] || DEFAULT_TIMING;
          return (
            <div key={i} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-200 p-2.5">
              <div className="font-medium text-slate-800 text-sm w-24">{name}</div>
              <div className="flex items-center gap-1.5">
                <input type="time" aria-label={t('r.opens', { day: name })} value={tm.startTime} onChange={e => setTime(i, 'startTime', e.target.value)} className={cx(inputClass, 'w-[7.75rem]')} />
                <span className="text-slate-400 text-xs">–</span>
                <input type="time" aria-label={t('r.closes', { day: name })} value={tm.endTime} onChange={e => setTime(i, 'endTime', e.target.value)} className={cx(inputClass, 'w-[7.75rem]')} />
              </div>
              <button type="button" onClick={() => copyToAll(i)} className="text-[11px] text-blue-700 hover:underline" title={t('r.copyAllHint')}>{t('r.copyAll')}</button>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1 text-xs font-semibold text-amber-700"><Sun className="w-3.5 h-3.5" /> {t('s.day')}
                  <NumberField ariaLabel={t('r.dayWorkersOn', { day: name })} min={0} max={20} value={req.day} onChange={v => setReq(i, 'day', Math.round(v ?? 0))} className="w-14 text-center" />
                </label>
                <label className="flex items-center gap-1 text-xs font-semibold text-indigo-700">{t('s.night')}
                  <NumberField ariaLabel={t('r.nightWorkersOn', { day: name })} min={0} max={20} value={req.night} onChange={v => setReq(i, 'night', Math.round(v ?? 0))} className="w-14 text-center" />
                </label>
              </div>
              <div className="text-xs text-slate-500 sm:ms-auto">{shiftLengthLabel(t, req.day, req.night, windowHours(tm))}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

const WorkLimits: React.FC<{ config: ShiftConfig; onChange: (c: ShiftConfig) => void }> = ({ config, onChange }) => {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader icon={<Gauge className="w-5 h-5 text-blue-600" />} title={t('r.limitsTitle')} subtitle={t('r.limitsSub')} />
      <div className="px-4 pb-4 grid gap-4 sm:grid-cols-3">
        <div>
          <FieldLabel hint={t('r.maxRowHint')}>{t('r.maxRow')}</FieldLabel>
          <NumberField min={1} max={14} value={config.maxConsecutiveDays ?? DEFAULTS.maxConsecutiveDays} onChange={v => onChange({ ...config, maxConsecutiveDays: Math.round(v ?? 5) })} className="w-24" ariaLabel={t('r.maxRow')} />
        </div>
        <div>
          <FieldLabel hint={t('r.minRestHint')}>{t('r.minRest')}</FieldLabel>
          <NumberField min={1} max={7} value={config.minRestDays ?? DEFAULTS.minRestDays} onChange={v => onChange({ ...config, minRestDays: Math.round(v ?? 1) })} className="w-24" ariaLabel={t('r.minRest')} />
        </div>
        <div>
          <FieldLabel hint={t('r.maxShiftsHint')}>{t('w.max')}</FieldLabel>
          <NumberField allowEmpty min={1} max={31} value={config.maxShiftsPerMonth || undefined} placeholder={t('ui.noLimit')} onChange={v => onChange({ ...config, maxShiftsPerMonth: v ? Math.round(v) : 0 })} className="w-24" ariaLabel={t('w.max')} />
        </div>
        <div className="sm:col-span-3 flex items-center justify-between gap-3 rounded-lg bg-slate-50 border border-slate-200 p-3">
          <div>
            <div className="text-sm font-medium text-slate-800">{t('r.sameType')}</div>
            <div className="text-xs text-slate-500">{t('r.sameTypeHint')}</div>
          </div>
          <Toggle label={t('r.sameType')} checked={config.blockScheduling ?? true} onChange={v => onChange({ ...config, blockScheduling: v })} />
        </div>
      </div>
    </Card>
  );
};

const WeekendAndSharing: React.FC<{ config: ShiftConfig; onChange: (c: ShiftConfig) => void }> = ({ config, onChange }) => {
  const { t } = useI18n();
  const premium = config.premiumDays ?? DEFAULTS.premiumDays;
  return (
    <Card>
      <CardHeader icon={<Star className="w-5 h-5 text-amber-500" />} title={t('r.weekendTitle')} />
      <div className="px-4 pb-4 grid grid-cols-1 gap-4">
        <div>
          <FieldLabel hint={t('r.premiumHint')}>{t('r.premium')}</FieldLabel>
          <div className="flex gap-1.5 flex-wrap">
            {weekdaysShort().map((d, i) => {
              const on = premium.includes(i);
              return (
                <button key={i} type="button" aria-pressed={on}
                  onClick={() => onChange({ ...config, premiumDays: on ? premium.filter(x => x !== i) : [...premium, i].sort() })}
                  className={cx('w-14 py-1.5 rounded-lg text-sm border font-medium', on ? 'bg-amber-50 text-amber-800 border-amber-300' : 'bg-white text-slate-600 border-slate-300')}>
                  {d}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 border border-slate-200 p-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-800">{t('r.share')}</div>
            <div className="text-xs text-slate-500">{t('r.shareHint')}</div>
          </div>
          <div className="flex items-center gap-2">
            {config.distributeDayShiftsToEither && (
              <label className="text-xs text-slate-600 flex items-center gap-1.5">
                <NumberField min={1} max={15} value={config.dayShareAmount ?? DEFAULTS.dayShareAmount} onChange={v => onChange({ ...config, dayShareAmount: Math.round(v ?? 2) })} className="w-14 text-center" ariaLabel={t('r.shareAmount')} />
                {t('r.shareUnit')}
              </label>
            )}
            <Toggle label={t('r.share')} checked={!!config.distributeDayShiftsToEither} onChange={v => onChange({ ...config, distributeDayShiftsToEither: v })} />
          </div>
        </div>
      </div>
    </Card>
  );
};

export const specialDaySummary = (t: T, s: SpecialDay): string => {
  if (s.closed) return t('r.closed');
  const parts: string[] = [];
  if (s.day !== undefined || s.night !== undefined) parts.push(t('r.staffing', { day: s.day ?? '–', night: s.night ?? '–' }));
  if (s.startTime || s.endTime) parts.push(`${s.startTime || '…'}–${s.endTime || '…'}`);
  if (s.premium) parts.push(t('r.weekendDay'));
  return parts.join(' · ') || t('r.noChanges');
};

export const SpecialDayForm: React.FC<{
  initialDate?: string;
  initial?: SpecialDay;
  config: ShiftConfig;
  onSave: (dates: string[], s: SpecialDay | null) => void;
  onCancel?: () => void;
  allowRange?: boolean;
}> = ({ initialDate = '', initial, config, onSave, onCancel, allowRange = true }) => {
  const { t } = useI18n();
  const [from, setFrom] = useState(initialDate);
  const [to, setTo] = useState('');
  const [label, setLabel] = useState(initial?.label || '');
  const [mode, setMode] = useState<'closed' | 'custom'>(initial?.closed ? 'closed' : 'custom');
  const dow = from ? weekdayOf(from) : 0;
  const base = config.requirements[dow] || { day: 1, night: 1 };
  const baseT = config.dailyTimings[dow] || DEFAULT_TIMING;
  const [day, setDay] = useState<number | undefined>(initial?.day);
  const [night, setNight] = useState<number | undefined>(initial?.night);
  const [start, setStart] = useState(initial?.startTime || '');
  const [end, setEnd] = useState(initial?.endTime || '');
  const [premium, setPremium] = useState(!!initial?.premium);

  const save = () => {
    if (!from) return;
    const dates = allowRange && to && to >= from ? dateRange(from, to) : [from];
    const s: SpecialDay = mode === 'closed' ? { closed: true } : {};
    if (label.trim()) s.label = label.trim();
    if (mode === 'custom') {
      if (day !== undefined) s.day = day;
      if (night !== undefined) s.night = night;
      if (start) s.startTime = start;
      if (end) s.endTime = end;
      if (premium) s.premium = true;
    }
    onSave(dates, s);
  };

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-xs text-slate-600">{allowRange ? t('ui.from') : t('r.date')}<input type="date" value={from} onChange={e => setFrom(e.target.value)} className={cx(inputClass, 'block mt-0.5')} disabled={!allowRange && !!initialDate} /></label>
        {allowRange && <label className="text-xs text-slate-600">{t('r.toOptional')}<input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} className={cx(inputClass, 'block mt-0.5')} /></label>}
        <label className="text-xs text-slate-600 flex-1 min-w-[140px]">{t('r.nameOptional')}<input dir="auto" value={label} placeholder={t('r.namePlaceholder')} onChange={e => setLabel(e.target.value)} className={cx(inputClass, 'block mt-0.5 w-full')} /></label>
      </div>
      <Segmented size="sm" value={mode} onChange={setMode} ariaLabel={t('r.specialType')} options={[{ value: 'custom', label: t('r.different') }, { value: 'closed', label: t('r.closed') }]} />
      {mode === 'custom' && (
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-xs text-slate-600">{t('r.dayWorkers')}<NumberField allowEmpty min={0} max={20} value={day} placeholder={String(base.day)} onChange={v => setDay(v === undefined ? undefined : Math.round(v))} className="block mt-0.5 w-20" /></label>
          <label className="text-xs text-slate-600">{t('r.nightWorkers')}<NumberField allowEmpty min={0} max={20} value={night} placeholder={String(base.night)} onChange={v => setNight(v === undefined ? undefined : Math.round(v))} className="block mt-0.5 w-20" /></label>
          <label className="text-xs text-slate-600">{t('r.opensShort')}<input type="time" value={start} placeholder={baseT.startTime} onChange={e => setStart(e.target.value)} className={cx(inputClass, 'block mt-0.5')} /></label>
          <label className="text-xs text-slate-600">{t('r.closesShort')}<input type="time" value={end} placeholder={baseT.endTime} onChange={e => setEnd(e.target.value)} className={cx(inputClass, 'block mt-0.5')} /></label>
          <label className="text-xs text-slate-600 flex items-center gap-2 pb-1.5"><Toggle checked={premium} onChange={setPremium} label={t('r.countsWeekend')} /> {t('r.countsWeekend')}</label>
        </div>
      )}
      <p className="text-xs text-slate-500">{from ? t('r.emptyKeeps', { day: weekdayLong(dow) }) : t('r.emptyKeepsGeneric')}</p>
      <div className="flex gap-2 justify-end">
        {initial && <Button variant="danger" size="sm" onClick={() => onSave([from], null)}><Trash2 className="w-3.5 h-3.5" /> {t('ui.remove')}</Button>}
        {onCancel && <Button variant="ghost" size="sm" onClick={onCancel}>{t('ui.cancel')}</Button>}
        <Button variant="primary" size="sm" disabled={!from} onClick={save}>{initial ? t('ui.save') : <><Plus className="w-3.5 h-3.5" /> {t('ui.add')}</>}</Button>
      </div>
    </div>
  );
};

export const applySpecialDays = (config: ShiftConfig, dates: string[], s: SpecialDay | null): ShiftConfig => {
  const specialDays = { ...(config.specialDays || {}) };
  dates.forEach(d => { if (s) specialDays[d] = s; else delete specialDays[d]; });
  return { ...config, specialDays };
};

const SpecialDays: React.FC<{ config: ShiftConfig; onChange: (c: ShiftConfig) => void }> = ({ config, onChange }) => {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const today = formatDateKey(new Date());
  const all = Object.entries(config.specialDays || {}).sort(([a], [b]) => a.localeCompare(b));
  const past = all.filter(([d]) => d < today);
  const shown = showPast ? all : all.filter(([d]) => d >= today);
  return (
    <Card>
      <CardHeader icon={<CalendarDays className="w-5 h-5 text-blue-600" />} title={t('r.specialTitle')} subtitle={t('r.specialSub')}
        actions={!adding && <Button size="sm" onClick={() => setAdding(true)}><Plus className="w-3.5 h-3.5" /> {t('ui.add')}</Button>} />
      <div className="px-4 pb-4 grid grid-cols-1 gap-2">
        {adding && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
            <SpecialDayForm config={config} onCancel={() => setAdding(false)} onSave={(dates, s) => { onChange(applySpecialDays(config, dates, s)); setAdding(false); }} />
          </div>
        )}
        {shown.length === 0 && !adding && <p className="text-sm text-slate-500">{t('r.noSpecial')}</p>}
        {shown.map(([date, s]) => (
          <div key={date} className="rounded-lg border border-slate-200 p-2.5">
            {editing === date ? (
              <SpecialDayForm config={config} initialDate={date} initial={s} allowRange={false} onCancel={() => setEditing(null)}
                onSave={(dates, ns) => { onChange(applySpecialDays(config, dates, ns)); setEditing(null); }} />
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 text-sm">
                  <span className="font-medium text-slate-800">{formatDayLabel(date)}</span>
                  {s.label && <span dir="auto" className="ms-2 text-slate-600">{s.label}</span>}
                  <div className="text-xs text-slate-500">{specialDaySummary(t, s)}</div>
                </div>
                <div className="flex items-center gap-1">
                  {s.closed && <Badge tone="red">{t('r.closed')}</Badge>}
                  <IconButton label={t('ui.edit')} onClick={() => setEditing(date)}><Settings className="w-4 h-4" /></IconButton>
                  <IconButton label={t('ui.remove')} onClick={() => onChange(applySpecialDays(config, [date], null))} className="hover:text-red-600"><Trash2 className="w-4 h-4" /></IconButton>
                </div>
              </div>
            )}
          </div>
        ))}
        {past.length > 0 && (
          <button type="button" onClick={() => setShowPast(v => !v)} className="justify-self-start text-xs text-blue-700 hover:underline">
            {showPast ? t('r.hidePast') : t('r.showPast', { count: past.length })}
          </button>
        )}
      </div>
    </Card>
  );
};

export const RulesTab: React.FC<{ config: ShiftConfig; setConfig: (c: ShiftConfig) => void }> = ({ config, setConfig }) => {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-1 gap-4">
      <HoursAndStaffing config={config} onChange={setConfig} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 items-start">
        <div className="grid grid-cols-1 gap-4 min-w-0">
          <WorkLimits config={config} onChange={setConfig} />
          <WeekendAndSharing config={config} onChange={setConfig} />
        </div>
        <div className="grid grid-cols-1 gap-4 min-w-0">
          <Card>
            <CardHeader icon={<Settings className="w-5 h-5 text-blue-600" />} title={t('p.title')} subtitle={t('p.sub')} />
            <div className="px-4 pb-4"><PrioritiesEditor config={config} onChange={setConfig} /></div>
          </Card>
          <SpecialDays config={config} onChange={setConfig} />
        </div>
      </div>
    </div>
  );
};
