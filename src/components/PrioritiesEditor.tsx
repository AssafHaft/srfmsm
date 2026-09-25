import React from 'react';
import { Priorities, PriorityLevel, ShiftConfig } from '../types';
import { getPriorities, DEFAULT_PRIORITIES } from '../lib/config';
import { Segmented } from './ui';

export const PRIORITY_INFO: { key: keyof Priorities; label: string; hint: string }[] = [
  { key: 'workload', label: 'Equal workload', hint: 'Everyone gets their fair share of shifts and hours' },
  { key: 'weekends', label: 'Fair weekends', hint: 'Weekend days are shared evenly' },
  { key: 'mix', label: 'Day/night balance', hint: '"Either" workers get a similar day/night mix' },
  { key: 'routine', label: 'Steady routine', hint: 'Even weeks, runs of days instead of scattered single days' },
  { key: 'wishes', label: 'Worker wishes', hint: '"Prefers day/night" and "prefers off" days' },
];

const LEVELS: { value: PriorityLevel; label: string }[] = [
  { value: 0, label: 'Low' },
  { value: 1, label: 'Normal' },
  { value: 2, label: 'High' },
];

export const PrioritiesEditor: React.FC<{ config: ShiftConfig; onChange: (c: ShiftConfig) => void; compact?: boolean }> = ({ config, onChange, compact }) => {
  const p = getPriorities(config);
  const isDefault = PRIORITY_INFO.every(i => p[i.key] === DEFAULT_PRIORITIES[i.key]);
  return (
    <div className="grid grid-cols-1 gap-2.5">
      {PRIORITY_INFO.map(i => (
        <div key={i.key} className={compact ? 'grid gap-1' : 'flex flex-wrap items-center justify-between gap-2'}>
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-800">{i.label}</div>
            {!compact && <div className="text-xs text-slate-500">{i.hint}</div>}
          </div>
          <Segmented size="sm" ariaLabel={i.label} value={p[i.key]} options={LEVELS}
            onChange={v => onChange({ ...config, priorities: { ...p, [i.key]: v } })} />
        </div>
      ))}
      {!isDefault && (
        <button type="button" onClick={() => onChange({ ...config, priorities: { ...DEFAULT_PRIORITIES } })} className="justify-self-start text-xs text-blue-700 hover:underline">
          Reset to defaults
        </button>
      )}
    </div>
  );
};
