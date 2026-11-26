// Export for Connecteam's "import shifts from file": the same columns,
// encoding (UTF-8 with BOM) and line endings (CRLF) as the template
// Connecteam provides. One row per worker per shift, so every shift lands
// on the right person without relying on a separator for several users.
import { translate as tr } from '../i18n';
import { parseDateKey } from './dates';
import type { SheetDay, SheetShift, TeamSheet } from './teamSheet';

export const CONNECTEAM_HEADERS = [
  'Date', 'Start', 'End', 'Timezone', 'Unpaid break', 'Paid break', 'Shift title', 'Job', 'Sub item',
  'Users', 'Note', 'Shift tags', 'Address', 'Number of users', 'Require Approval', 'Tasks',
] as const;

type Row = Partial<Record<(typeof CONNECTEAM_HEADERS)[number], string>>;

// The job every exported shift belongs to in Connecteam. Not translated: it
// must match the job's name in Connecteam exactly.
export const CONNECTEAM_JOB = 'תחזוקה כללי';

// Quote only when needed, like the template
const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// MM/DD/YYYY, as in the template
export const usDate = (key: string): string => {
  const d = parseDateKey(key);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
};

// The day's holiday name, events and notes, on one line
const dayNote = (d: SheetDay): string =>
  [d.label, d.events, d.notes]
    .map(s => (s || '').replace(/\s*\r?\n\s*/g, ' · ').replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean)
    .join(' | ');

export interface ConnecteamExport {
  csv: string;
  rows: number;
}

// Days of the month only: days shown from the neighbouring months belong to
// their own month's export. Unfilled places are left out.
export function teamSheetToConnecteam(sheet: TeamSheet, nameOf: (id: string) => string): ConnecteamExport {
  const rows: Row[] = [];
  sheet.weeks.flat().forEach(d => {
    if (!d.inMonth || d.closed) return;
    const note = dayNote(d);
    const add = (s: SheetShift | null, kind: 'day' | 'night') => {
      if (!s) return;
      const title = s.full ? tr('ts.fullShift') : kind === 'day' ? tr('ts.dayShift') : tr('ts.nightShift');
      s.ids.forEach(id => rows.push({
        Date: usDate(d.date),
        Start: s.start,
        End: s.end,
        'Shift title': title,
        Job: CONNECTEAM_JOB,
        Users: nameOf(id).trim(),
        Note: note,
        'Require Approval': 'no',
      }));
    };
    add(d.day, 'day');
    add(d.night, 'night');
  });
  const lines = [
    CONNECTEAM_HEADERS.join(','),
    ...rows.map(r => CONNECTEAM_HEADERS.map(h => cell(r[h] || '')).join(',')),
  ];
  return { csv: '﻿' + lines.join('\r\n') + '\r\n', rows: rows.length };
}

export const connecteamFileName = (sheet: TeamSheet): string => `connecteam_shifts_${sheet.period.replace('.', '_')}.csv`;
