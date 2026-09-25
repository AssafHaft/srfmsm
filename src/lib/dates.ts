// Date helpers. All schedule dates are local-calendar YYYY-MM-DD keys.
// Display helpers follow the current UI language.
import { getLang, localeFor } from '../i18n';

const SHORT = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  he: ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'],
};
const LONG = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  he: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'],
};

export const weekdayShort = (i: number): string => SHORT[getLang()][i];
export const weekdayLong = (i: number): string => LONG[getLang()][i];
export const weekdaysShort = (): string[] => SHORT[getLang()];
export const weekdaysLong = (): string[] => LONG[getLang()];

export const formatDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// new Date('YYYY-MM-DD') parses as UTC and can shift the weekday in
// negative-offset timezones, so parse as a local date instead.
export const parseDateKey = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const isDateKey = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

export const addDays = (key: string, n: number): string => {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return formatDateKey(d);
};

export const weekdayOf = (key: string): number => parseDateKey(key).getDay();

// Inclusive list of date keys from `from` to `to`
export const dateRange = (from: string, to: string): string[] => {
  const out: string[] = [];
  if (!isDateKey(from) || !isDateKey(to) || from > to) return out;
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
};

export const monthKey = (year: number, month: number): string =>
  `${year}-${String(month + 1).padStart(2, '0')}`;

export const shiftMonth = (year: number, month: number, delta: number): { year: number; month: number } => {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
};

export const monthLabel = (year: number, month: number, style: 'long' | 'short' = 'long'): string =>
  new Date(year, month, 1).toLocaleString(localeFor(), { month: style, year: 'numeric' });

// Full-week grid: the Sunday on/before the 1st through the Saturday on/after
// the last day of the month.
export const getFullWeeksRange = (year: number, month: number): Date[] => {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - last.getDay()));
  const days: Date[] = [];
  for (const cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) days.push(new Date(cur));
  return days;
};

export const gridKeys = (year: number, month: number): string[] =>
  getFullWeeksRange(year, month).map(formatDateKey);

export const isInMonth = (key: string, year: number, month: number): boolean =>
  key.startsWith(monthKey(year, month) + '-');

export const formatShortDate = (key: string): string =>
  parseDateKey(key).toLocaleDateString(localeFor(), { month: 'short', day: 'numeric' });

export const formatDayLabel = (key: string): string =>
  getLang() === 'he'
    ? `יום ${LONG.he[parseDateKey(key).getDay()]}, ${formatShortDate(key)}`
    : parseDateKey(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export const formatDateTime = (ts: number, withYear = false): string =>
  new Date(ts).toLocaleString(getLang() === 'he' ? 'he-IL' : 'en-GB', {
    day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit',
  });
