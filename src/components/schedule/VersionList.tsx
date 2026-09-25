import React, { useMemo, useState } from 'react';
import { Check, CheckCircle2, Edit2, Layers, Trash2 } from 'lucide-react';
import { Employee, ScheduleVersion, ShiftConfig } from '../../types';
import { Card, IconButton, cx, inputClass, useConfirm } from '../ui';
import { versionInsights } from './derived';
import { T, useI18n } from '../../i18n';
import { formatDateTime } from '../../lib/dates';

export const qualityLine = (t: T, v: ScheduleVersion, employees: Employee[], config: ShiftConfig) => {
  const q = versionInsights(v, employees, config);
  const parts: { text: string; tone: 'ok' | 'warn' | 'bad' }[] = [];
  parts.push(q.validation.emptySlots ? { text: t('q.unfilled', { n: q.validation.emptySlots }), tone: 'bad' } : { text: t('q.allFilled'), tone: 'ok' });
  parts.push(q.ruleIssues ? { text: t('q.issues', { count: q.ruleIssues }), tone: 'bad' } : { text: t('q.rulesOk'), tone: 'ok' });
  if (v.targets) {
    const gap = Math.round(q.fairness.maxShiftGap * 10) / 10;
    parts.push({ text: gap < 1 ? t('q.within1') : t('q.upTo', { n: gap }), tone: gap < 1 ? 'ok' : gap < 2 ? 'warn' : 'bad' });
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
  const confirm = useConfirm();
  const { t, lang } = useI18n();
  const [draft, setDraft] = useState('');
  const quality = useMemo(() => new Map(versions.map(v => [v.id, qualityLine(t, v, employees, config)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [versions, employees, config, lang]);

  if (versions.length === 0) return null;
  return (
    <Card className="p-4 print:hidden">
      <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-3"><Layers className="w-4 h-4 text-slate-500" /> {t('vl.title')} <span className="text-xs font-normal text-slate-500">({versions.length})</span></h3>
      <div className="grid grid-cols-1 gap-2 max-h-[420px] overflow-y-auto pe-1">
        {versions.map(v => {
          const active = v.id === currentId;
          return (
            <div key={v.id} className={cx('group rounded-lg border p-2.5 transition', active ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:bg-slate-50')}>
              <div className="flex items-start justify-between gap-2">
                {renaming === v.id ? (
                  <form className="flex gap-1 flex-1" onSubmit={e => { e.preventDefault(); onRename(v.id, draft); setRenaming(null); }}>
                    <input autoFocus dir="auto" value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => { onRename(v.id, draft); setRenaming(null); }} className={cx(inputClass, 'flex-1 py-1 text-sm')} aria-label={t('vl.name')} />
                  </form>
                ) : (
                  <button type="button" onClick={() => onSelect(v.id)} className="text-start min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900 flex items-center gap-1.5 min-w-0">
                      <span dir="auto" className="truncate min-w-0">{v.name}</span>
                      {v.final && <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 text-emerald-800 px-1.5 text-[10px] font-semibold shrink-0"><Check className="w-3 h-3" />{t('vl.final')}</span>}
                    </div>
                    <div className="text-[11px] text-slate-500">{formatDateTime(v.timestamp)}</div>
                  </button>
                )}
                <div className="flex shrink-0">
                  <IconButton label={v.final ? t('vl.unmarkFinal') : t('vl.markFinal')} onClick={() => onFinal(v.id)} className={v.final ? 'text-emerald-600' : ''}><CheckCircle2 className="w-4 h-4" /></IconButton>
                  <IconButton label={t('vl.rename')} onClick={() => { setDraft(v.name); setRenaming(v.id); }}><Edit2 className="w-3.5 h-3.5" /></IconButton>
                  <IconButton label={t('vl.delete')} onClick={async () => { if (await confirm({ title: t('vl.deleteTitle', { name: v.name }), message: v.final ? t('vl.deleteFinal') : undefined, confirmLabel: t('ui.delete'), danger: true })) onDelete(v.id); }} className="hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></IconButton>
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
