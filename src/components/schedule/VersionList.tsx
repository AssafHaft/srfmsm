import React, { useMemo, useState } from 'react';
import { Check, CheckCircle2, Edit2, Layers, Trash2 } from 'lucide-react';
import { Employee, ScheduleVersion, ShiftConfig } from '../../types';
import { Card, IconButton, cx, inputClass } from '../ui';
import { versionInsights } from './derived';

export const qualityLine = (v: ScheduleVersion, employees: Employee[], config: ShiftConfig) => {
  const q = versionInsights(v, employees, config);
  const parts: { text: string; tone: 'ok' | 'warn' | 'bad' }[] = [];
  parts.push(q.validation.emptySlots ? { text: `${q.validation.emptySlots} unfilled`, tone: 'bad' } : { text: 'all filled', tone: 'ok' });
  parts.push(q.ruleIssues ? { text: `${q.ruleIssues} rule issue${q.ruleIssues > 1 ? 's' : ''}`, tone: 'bad' } : { text: 'rules OK', tone: 'ok' });
  if (v.targets) {
    const gap = Math.round(q.fairness.maxShiftGap * 10) / 10;
    parts.push({ text: gap < 1 ? 'within 1 of fair share' : `up to ${gap} from fair share`, tone: gap < 1 ? 'ok' : gap < 2 ? 'warn' : 'bad' });
  }
  return parts;
};

export const VersionList: React.FC<{
  versions: ScheduleVersion[];
  currentId: string | null;
  employees: Employee[];
  config: ShiftConfig;
  onSelect: (id: string) => void;
  onFinal: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}> = ({ versions, currentId, employees, config, onSelect, onFinal, onRename, onDelete }) => {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const quality = useMemo(() => new Map(versions.map(v => [v.id, qualityLine(v, employees, config)])), [versions, employees, config]);

  if (versions.length === 0) return null;
  return (
    <Card className="p-4 print:hidden">
      <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-3"><Layers className="w-4 h-4 text-slate-500" /> Versions <span className="text-xs font-normal text-slate-500">({versions.length})</span></h3>
      <div className="grid grid-cols-1 gap-2 max-h-[420px] overflow-y-auto pr-1">
        {versions.map(v => {
          const active = v.id === currentId;
          return (
            <div key={v.id} className={cx('group rounded-lg border p-2.5 transition', active ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:bg-slate-50')}>
              <div className="flex items-start justify-between gap-2">
                {renaming === v.id ? (
                  <form className="flex gap-1 flex-1" onSubmit={e => { e.preventDefault(); onRename(v.id, draft); setRenaming(null); }}>
                    <input autoFocus dir="auto" value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => { onRename(v.id, draft); setRenaming(null); }} className={cx(inputClass, 'flex-1 py-1 text-sm')} aria-label="Version name" />
                  </form>
                ) : (
                  <button type="button" onClick={() => onSelect(v.id)} className="text-left min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900 flex items-center gap-1.5 min-w-0">
                      <span dir="auto" className="truncate min-w-0">{v.name}</span>
                      {v.final && <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 text-emerald-800 px-1.5 text-[10px] font-semibold shrink-0"><Check className="w-3 h-3" />Final</span>}
                    </div>
                    <div className="text-[11px] text-slate-500">{new Date(v.timestamp).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                  </button>
                )}
                <div className="flex shrink-0">
                  <IconButton label={v.final ? 'Unmark final' : 'Mark as final'} onClick={() => onFinal(v.id)} className={v.final ? 'text-emerald-600' : ''}><CheckCircle2 className="w-4 h-4" /></IconButton>
                  <IconButton label="Rename" onClick={() => { setDraft(v.name); setRenaming(v.id); }}><Edit2 className="w-3.5 h-3.5" /></IconButton>
                  <IconButton label="Delete version" onClick={() => { if (window.confirm(`Delete "${v.name}"?`)) onDelete(v.id); }} className="hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></IconButton>
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(quality.get(v.id) || []).map((p, i) => (
                  <span key={i} className={cx('rounded px-1.5 py-0.5 text-[10px] font-medium',
                    p.tone === 'ok' && 'bg-emerald-50 text-emerald-700', p.tone === 'warn' && 'bg-amber-50 text-amber-800', p.tone === 'bad' && 'bg-red-50 text-red-700')}>{p.text}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};
