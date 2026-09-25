import React from 'react';
import { Priorities, PriorityLevel, ShiftConfig } from '../types';
import { getPriorities, DEFAULT_PRIORITIES } from '../lib/config';
import { Segmented } from './ui';
import { MessageKey, useI18n } from '../i18n';

export const PRIORITY_INFO: { key: keyof Priorities; label: MessageKey; hint: MessageKey }[] = [
  { key: 'workload', label: 'p.workload', hint: 'p.workloadHint' },
  { key: 'weekends', label: 'p.weekends', hint: 'p.weekendsHint' },
  { key: 'mix', label: 'p.mix', hint: 'p.mixHint' },
  { key: 'routine', label: 'p.routine', hint: 'p.routineHint' },
  { key: 'wishes', label: 'p.wishes', hint: 'p.wishesHint' },
];

const LEVELS: { value: PriorityLevel; label: MessageKey }[] = [
  { value: 0, label: 'p.low' },
  { value: 1, label: 'p.normal' },
  { value: 2, label: 'p.high' },
];

export const PrioritiesEditor: React.FC<{ config: ShiftConfig; onChange: (c: ShiftConfig) => void; compact?: boolean }> = ({ config, onChange, compact }) => {
  const p = getPriorities(config);
  const { t } = useI18n();
  const isDefault = PRIORITY_INFO.every(i => p[i.key] === DEFAULT_PRIORITIES[i.key]);
  return (
    <div className="grid grid-cols-1 gap-2.5">
      {PRIORITY_INFO.map(i => (
        <div key={i.key} className={compact ? 'grid gap-1' : 'flex flex-wrap items-center justify-between gap-2'}>
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-800">{t(i.label)}</div>
            {!compact && <div className="text-xs text-slate-500">{t(i.hint)}</div>}
          </div>
          <Segmented size="sm" ariaLabel={t(i.label)} value={p[i.key]} options={LEVELS.map(l => ({ value: l.value, label: t(l.label) }))}
            onChange={v => onChange({ ...config, priorities: { ...p, [i.key]: v } })} />
        </div>
      ))}
      {!isDefault && (
        <button type="button" onClick={() => onChange({ ...config, priorities: { ...DEFAULT_PRIORITIES } })} className="justify-self-start text-xs text-blue-700 hover:underline">
          {t('p.reset')}
        </button>
      )}
    </div>
  );
};
