// Small shared UI building blocks.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../i18n';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

export const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
  <div className={cx('bg-white rounded-xl border border-slate-200 shadow-sm', className)}>{children}</div>
);

export const CardHeader: React.FC<{ icon?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }> = ({ icon, title, subtitle, actions }) => (
  <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
    <div className="min-w-0">
      <h2 className="font-semibold text-slate-900 flex items-center gap-2">{icon}{title}</h2>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }> = ({
  variant = 'secondary', size = 'md', className, children, ...rest
}) => (
  <button
    type="button"
    {...rest}
    className={cx(
      'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
      size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
      variant === 'primary' && 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm',
      variant === 'secondary' && 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
      variant === 'ghost' && 'text-slate-600 hover:bg-slate-100',
      variant === 'danger' && 'bg-white text-red-600 border border-red-200 hover:bg-red-50',
      className
    )}
  >
    {children}
  </button>
);

export const IconButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }> = ({ label, className, children, ...rest }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    {...rest}
    className={cx('inline-flex items-center justify-center rounded-md p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400', className)}
  >
    {children}
  </button>
);

export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label?: string }> = ({ checked, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={cx('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400', checked ? 'bg-blue-600' : 'bg-slate-300')}
  >
    <span className={cx('inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform', checked ? 'translate-x-6 rtl:-translate-x-6' : 'translate-x-1 rtl:-translate-x-1')} />
  </button>
);

export function Segmented<T extends string | number>({ value, options, onChange, size = 'md', ariaLabel }: {
  value: T;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex flex-wrap rounded-lg bg-slate-100 p-0.5 gap-0.5">
      {options.map(o => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md font-medium transition',
            size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            o.value === value ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const NumberField: React.FC<{
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  allowEmpty?: boolean;
}> = ({ value, onChange, min, max, step, placeholder, className, ariaLabel, allowEmpty }) => {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => { setText(value === undefined ? '' : String(value)); }, [value]);
  const commit = (raw: string) => {
    if (raw.trim() === '') {
      if (allowEmpty) onChange(undefined);
      else setText(value === undefined ? '' : String(value));
      return;
    }
    let n = Number(raw);
    if (!Number.isFinite(n)) { setText(value === undefined ? '' : String(value)); return; }
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    onChange(n);
    setText(String(n));
  };
  return (
    <input
      type="number"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={text}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onChange={e => setText(e.target.value)}
      onBlur={e => commit(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={cx('rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500', className)}
    />
  );
};

export const inputClass = 'rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

export const Badge: React.FC<{ tone?: 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'indigo' | 'purple'; children: React.ReactNode; className?: string; title?: string }> = ({ tone = 'slate', children, className, title }) => (
  <span title={title} className={cx(
    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
    tone === 'slate' && 'bg-slate-100 text-slate-600',
    tone === 'blue' && 'bg-blue-50 text-blue-700',
    tone === 'green' && 'bg-emerald-50 text-emerald-700',
    tone === 'amber' && 'bg-amber-50 text-amber-800',
    tone === 'red' && 'bg-red-50 text-red-700',
    tone === 'indigo' && 'bg-indigo-50 text-indigo-700',
    tone === 'purple' && 'bg-purple-50 text-purple-700',
    className
  )}>{children}</span>
);

export const ColorDot: React.FC<{ color?: string; className?: string }> = ({ color, className }) => (
  <span className={cx('inline-block w-3 h-3 rounded-full border border-black/10 shrink-0', className)} style={{ backgroundColor: color || '#e5e7eb' }} />
);

export const Modal: React.FC<{ open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }> = ({ open, onClose, title, children, footer, wide }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4 print:hidden" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className={cx('bg-white w-full rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] focus:outline-none', wide ? 'sm:max-w-4xl' : 'sm:max-w-lg')}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h3 className="font-semibold text-slate-900 min-w-0">{title}</h3>
          <IconButton label={t('ui.close')} onClick={onClose}><X className="w-5 h-5" /></IconButton>
        </div>
        <div className="overflow-y-auto px-4 py-3 flex-1">{children}</div>
        {footer && <div className="border-t border-slate-200 px-4 py-3 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  );
};

// Lightweight dropdown menu
export const Menu: React.FC<{ button: (open: () => void) => React.ReactNode; children: (close: () => void) => React.ReactNode; align?: 'left' | 'right' }> = ({ button, children, align = 'right' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      {button(() => setOpen(o => !o))}
      {open && (
        <div className={cx('absolute z-40 mt-1 min-w-[220px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg', align === 'right' ? 'end-0' : 'start-0')}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
};

export const MenuItem: React.FC<{ onClick: () => void; icon?: React.ReactNode; children: React.ReactNode; hint?: string; danger?: boolean }> = ({ onClick, icon, children, hint, danger }) => (
  <button type="button" onClick={onClick} className={cx('w-full text-start px-3 py-2 text-sm flex items-start gap-2 hover:bg-slate-50', danger ? 'text-red-600' : 'text-slate-700')}>
    {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
    <span className="min-w-0">
      <span className="block">{children}</span>
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </span>
  </button>
);

// Toasts
export interface ToastMsg { id: number; text: string; tone: 'ok' | 'error' }

export const Toasts: React.FC<{ items: ToastMsg[]; onDismiss: (id: number) => void }> = ({ items, onDismiss }) => {
  const { t } = useI18n();
  return (
  <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 w-[min(92vw,420px)] print:hidden" aria-live="polite">
    {items.map(m => (
      <div key={m.id} className={cx('rounded-lg px-4 py-3 text-sm shadow-lg flex items-start justify-between gap-3', m.tone === 'ok' ? 'bg-slate-900 text-white' : 'bg-red-600 text-white')}>
        <span className="whitespace-pre-line" dir="auto">{m.text}</span>
        <button type="button" aria-label={t('ui.dismiss')} onClick={() => onDismiss(m.id)} className="opacity-70 hover:opacity-100"><X className="w-4 h-4" /></button>
      </div>
    ))}
  </div>
  );
};

export function useToasts() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  const nextId = useRef(1);
  const dismiss = (id: number) => setItems(p => p.filter(t => t.id !== id));
  const push = (text: string, tone: 'ok' | 'error' = 'ok') => {
    const id = nextId.current++;
    setItems(p => [...p, { id, text, tone }]);
    setTimeout(() => dismiss(id), tone === 'ok' ? 3500 : 7000);
  };
  return { items, push, dismiss };
}

export const FieldLabel: React.FC<{ children: React.ReactNode; hint?: React.ReactNode; htmlFor?: string }> = ({ children, hint, htmlFor }) => (
  <label htmlFor={htmlFor} className="block mb-1">
    <span className="text-sm font-medium text-slate-700">{children}</span>
    {hint && <span className="block text-xs text-slate-500 font-normal">{hint}</span>}
  </label>
);

// In-app confirmation dialog (browser confirm() is blocked in some embeds)
interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const { t } = useI18n();
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>(resolve => setPending({ ...o, resolve })), []);
  const finish = (v: boolean) => { pending?.resolve(v); setPending(null); };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Modal open onClose={() => finish(false)} title={pending.title}
          footer={<>
            <Button variant="ghost" onClick={() => finish(false)}>{t('ui.cancel')}</Button>
            <Button variant={pending.danger ? 'danger' : 'primary'} onClick={() => finish(true)}>{pending.confirmLabel || t('ui.ok')}</Button>
          </>}>
          {pending.message && <div className="text-sm text-slate-700 whitespace-pre-line">{pending.message}</div>}
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
};

export const useConfirm = () => useContext(ConfirmContext);

// True when the app runs inside another page's frame (e.g. a preview),
// where downloads and printing are usually blocked.
export const isEmbedded = (): boolean => {
  try { return window.self !== window.top; } catch { return true; }
};
