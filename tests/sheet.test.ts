import { afterEach, describe, expect, it } from 'vitest';
import { buildXlsx, crc32, excelDate, safeSheetName, Sheet } from '../src/lib/xlsx';
import { buildTeamSheet, clock, fitText, hexColor, teamSheetXlsx, teamSheetFileName } from '../src/lib/teamSheet';
import { buildBackup, emptySheetNotes, hasSheetNotes, normalizeSheetNotes, parseBackup, scheduleWorkbook } from '../src/lib/io';
import { setCurrentLang } from '../src/i18n';
import { gridKeys } from '../src/lib/dates';
import { DailySchedule, ScheduleVersion, SheetNotes } from '../src/types';
import { config, team } from './helpers';

// Reads the stored (uncompressed) ZIP written by buildXlsx
const unzip = (bytes: Uint8Array): Record<string, string> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const offset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    const localName = view.getUint16(offset + 26, true);
    const data = bytes.subarray(offset + 30 + localName, offset + 30 + localName + size);
    expect(crc32(data)).toBe(crc);
    out[name] = new TextDecoder().decode(data);
    p += 46 + nameLen;
  }
  return out;
};

const sharedStrings = (files: Record<string, string>) =>
  [...files['xl/sharedStrings.xml'].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(m => m[1]);

// Text of a cell such as "C3" in sheet1
const cellText = (files: Record<string, string>, ref: string): string | undefined => {
  const m = files['xl/worksheets/sheet1.xml'].match(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>(.*?)</c>)`));
  if (!m || !m[1]) return undefined;
  const v = m[1].match(/<v>(.*?)<\/v>/)?.[1];
  return m[0].includes('t="s"') ? sharedStrings(files)[Number(v)] : v;
};

afterEach(() => setCurrentLang('en'));

describe('xlsx writer', () => {
  it('writes a valid stored ZIP with checksums', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const s = new Sheet('Test');
    s.set(1, 1, 'שלום & <hi>');
    s.set(1, 2, 42);
    const files = unzip(buildXlsx([s], { date: new Date(2026, 8, 25) }));
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml', 'xl/sharedStrings.xml',
    ]));
    expect(cellText(files, 'A1')).toBe('שלום &amp; &lt;hi&gt;');
    expect(cellText(files, 'B1')).toBe('42');
  });

  it('uses Excel day numbers for dates', () => {
    expect(excelDate('1900-03-01')).toBe(61);
    expect(excelDate('2026-09-01')).toBe(46266);
  });

  it('writes merges, right-to-left, colors by value and the print area', () => {
    const s = new Sheet('09.2026', true);
    s.merge(3, 3, 3, 10, 'Title', { font: { bold: true } });
    s.set(5, 4, 'Dana');
    s.highlights.push({ range: 'D5:J9', text: 'Dana "D"', fill: 'FF9900' });
    s.print = { area: [3, 3, 9, 10], fitWidth: 1, fitHeight: 1 };
    const files = unzip(buildXlsx([s]));
    const xml = files['xl/worksheets/sheet1.xml'];
    expect(xml).toContain('rightToLeft="1"');
    expect(xml).toContain('<mergeCell ref="C3:J3"/>');
    expect(xml).toContain('<formula>&quot;Dana &quot;&quot;D&quot;&quot;&quot;</formula>');
    expect(xml).toContain('<pageSetUpPr fitToPage="1"/>');
    expect(files['xl/styles.xml']).toContain('<dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFF9900"/>');
    expect(files['xl/workbook.xml']).toContain(`<definedName name="_xlnm.Print_Area" localSheetId="0">'09.2026'!$C$3:$J$9</definedName>`);
    // Every cell of a merged block exists, so its borders draw all round
    expect(xml).toContain('<c r="J3"');
  });

  it('keeps sheet names within Excel limits', () => {
    expect(safeSheetName('a/b:c*d?[e]')).toBe('a-b-c-d--e-');
    expect(safeSheetName('x'.repeat(40)).length).toBe(31);
    expect(safeSheetName('Summary', ['Summary'])).toBe('Summary 2');
  });
});

// September 2026 on a Sunday-to-Saturday grid, everybody on the default team
const septemberVersion = (fill: (date: string, i: number) => Partial<DailySchedule> = () => ({})): ScheduleVersion => ({
  id: 'v', timestamp: 0, name: 'Sept', month: 8, year: 2026, stats: {},
  schedule: gridKeys(2026, 8).map((date, i) => ({
    date, dayShift: ['Nitzan'], nightShift: ['Dan', 'Inbar'], ...(date.startsWith('2026-09') ? {} : { isPadding: true }), ...fill(date, i),
  })),
});

const sheetConfig = () => {
  const c = config();
  for (let i = 0; i < 7; i++) {
    c.dailyTimings[i] = { startTime: '05:00', endTime: '00:00' };
    c.requirements[i] = { day: 1, night: 2 };
  }
  c.requirements[5] = { day: 1, night: 0 }; // Friday: one full shift
  c.dailyTimings[5] = { startTime: '05:00', endTime: '19:00' };
  c.specialDays = {
    '2026-09-20': { closed: true, label: 'Yom Kippur' },
    '2026-09-21': { closed: true, label: 'Yom Kippur' },
    '2026-09-11': { label: 'Rosh Hashana eve' },
  };
  return c;
};

describe('team sheet', () => {
  it('lays out whole weeks with shift labels and hours from the rules', () => {
    const v = septemberVersion((date) => (date.endsWith('-04') || date.endsWith('-11') ? { dayShift: ['Golan'], nightShift: [] } : {}));
    const sheet = buildTeamSheet(v, sheetConfig(), emptySheetNotes());
    expect(sheet.period).toBe('09.2026');
    expect(sheet.weeks).toHaveLength(5);
    expect(sheet.weeks[0][0].date).toBe('2026-08-30');
    expect(sheet.weeks[0][0].inMonth).toBe(false);
    const tue = sheet.weeks[0][2];
    expect(tue.day).toMatchObject({ full: false, hours: '05:00 - 15:00', ids: ['Nitzan'] });
    expect(tue.night).toMatchObject({ full: false, hours: '14:00 - 00:00', ids: ['Dan', 'Inbar'] });
    const fri = sheet.weeks[0][5];
    expect(fri.day).toMatchObject({ full: true, hours: '05:00 - 19:00', ids: ['Golan'] });
    expect(fri.night).toBeNull();
    expect(sheet.dayRows).toBe(2);
    expect(sheet.nightRows).toBe(2);
    expect(sheet.dutyLabel).toBe('Gardening');
  });

  it('shows closed days, holiday names and more rows when a shift has more people', () => {
    const v = septemberVersion(date => (date === '2026-09-08' ? { nightShift: ['Dan', 'Inbar', 'Roy'] } : date === '2026-09-20' || date === '2026-09-21' ? { dayShift: [], nightShift: [] } : {}));
    const sheet = buildTeamSheet(v, sheetConfig(), emptySheetNotes());
    const week4 = sheet.weeks[3];
    expect(week4[0]).toMatchObject({ date: '2026-09-20', closed: true, label: 'Yom Kippur' });
    expect(week4[1].closed).toBe(true);
    expect(sheet.weeks[1][5].label).toBe('Rosh Hashana eve');
    expect(sheet.nightRows).toBe(3);
  });

  it('uses weekly notes unless a date has its own, and keeps events and the extra row', () => {
    const notes: SheetNotes = {
      days: {
        '2026-09-03': { notes: '' },               // cleared on this Thursday only
        '2026-09-06': { events: 'Clalit 80 people', duty: 'Omri' },
      },
      weekly: { 4: 'Replace perlite' },
      dutyLabel: 'Garden',
    };
    const sheet = buildTeamSheet(septemberVersion(), sheetConfig(), notes);
    expect(sheet.weeks[0][4]).toMatchObject({ date: '2026-09-03', notes: '', weeklyNote: false });
    expect(sheet.weeks[1][4]).toMatchObject({ date: '2026-09-10', notes: 'Replace perlite', weeklyNote: true });
    expect(sheet.weeks[1][0]).toMatchObject({ events: 'Clalit 80 people', duty: 'Omri' });
    expect(sheet.dutyLabel).toBe('Garden');
    expect(buildTeamSheet(septemberVersion(), sheetConfig(), { ...notes, dutyOff: true }).dutyLabel).toBeNull();
  });

  it('writes the Excel file in the team layout (Hebrew, right to left)', () => {
    setCurrentLang('he');
    const workers = team();
    const notes: SheetNotes = { days: { '2026-09-06': { events: 'כללית 80 איש', duty: 'Omri' } }, weekly: { 4: '💧 החלפת פרלייט' } };
    const soloFriday = (date: string) => (date === '2026-09-04' ? { dayShift: ['Golan'], nightShift: [] }
      : date === '2026-09-20' || date === '2026-09-21' ? { dayShift: [], nightShift: [] } : {});
    const sheet = buildTeamSheet(septemberVersion(soloFriday), sheetConfig(), notes);
    const files = unzip(teamSheetXlsx(sheet, id => id, workers.map(w => ({ name: w.name, color: '#9fc5e8' })), true));
    const xml = files['xl/worksheets/sheet1.xml'];
    expect(files['xl/workbook.xml']).toContain('<sheet name="09.2026"');
    expect(xml).toContain('rightToLeft="1"');
    expect(cellText(files, 'C3')).toBe('לו&quot;ז משמרות - 09.2026');
    expect(cellText(files, 'D4')).toBe('ראשון');
    expect(cellText(files, 'C5')).toBe('ימים:');
    expect(cellText(files, 'D5')).toBe(String(excelDate('2026-08-30')));
    expect(cellText(files, 'D6')).toBe('משמרת בוקר');
    expect(cellText(files, 'D7')).toBe('05:00 - 15:00');
    expect(cellText(files, 'D8')).toBe('Nitzan');
    expect(cellText(files, 'C10')).toBe('גננות:');
    expect(cellText(files, 'D11')).toBe('משמרת לילה');
    expect(cellText(files, 'I6')).toBe('משמרת מלאה');
    expect(cellText(files, 'C15')).toBe('אירועים');
    expect(cellText(files, 'H16')).toBe('💧 החלפת פרלייט');
    // Second week starts 12 rows later, with the event and the extra row
    expect(cellText(files, 'D22')).toBe('Omri');
    expect(cellText(files, 'D27')).toBe('כללית 80 איש');
    // Yom Kippur (Sun + Mon of week 4): one merged block over both shifts
    expect(xml).toContain('<mergeCell ref="D42:E50"/>');
    expect(cellText(files, 'D42')).toBe('Yom Kippur');
    // Day labels are merged over the two worker rows, like the original
    expect(xml).toContain('<mergeCell ref="C8:C9"/>');
    // Worker colors follow the name, also after edits in Excel
    expect(xml).toContain('<formula>&quot;Golan&quot;</formula>');
    expect(files['xl/styles.xml']).toContain('formatCode="dd&quot;/&quot;mm"');
    expect(files['xl/workbook.xml']).toContain(`'09.2026'!$C$3:$J$64`);
    expect(teamSheetFileName(sheet)).toBe('Shift schedule 09.2026.xlsx');
  });

  it('formats times and colors', () => {
    expect(clock(24)).toBe('00:00');
    expect(clock(25.5)).toBe('01:30');
    expect(clock(14.75)).toBe('14:45');
    expect(hexColor('#fecaca')).toBe('FECACA');
    expect(hexColor('#abc')).toBe('AABBCC');
    expect(hexColor('red')).toBeNull();
  });

  it('shrinks long text a little, then grows the row', () => {
    expect(fitText('')).toEqual({ size: 11, height: 45 });
    expect(fitText('Surf & Slice').size).toBe(11);
    const long = fitText('עיריית תל אביב 280 איש דשא שמאל, סיסטמטיקס 100 איש טריבונה ודשא');
    expect(long.size).toBe(9);
    expect(long.height).toBeGreaterThan(45);
  });
});

describe('team sheet notes in saved data', () => {
  it('normalizes what was saved', () => {
    const n = normalizeSheetNotes({
      days: { '2026-09-01': { events: 'Party', notes: '', duty: '  ' }, 'bad': { events: 'x' }, '2026-09-02': { events: '  ' } },
      weekly: { 4: 'Perlite', 9: 'nope', 2: ' ' },
      dutyLabel: 'Garden',
      dutyOff: 1,
    });
    expect(n).toEqual({ days: { '2026-09-01': { events: 'Party', notes: '' } }, weekly: { 4: 'Perlite' }, dutyLabel: 'Garden', dutyOff: true });
    expect(normalizeSheetNotes(undefined)).toEqual(emptySheetNotes());
    expect(hasSheetNotes(emptySheetNotes())).toBe(false);
    expect(hasSheetNotes(n)).toBe(true);
  });

  it('travels with backups; older backups load with none', () => {
    const base = { employees: team(), config: config(), versions: [], selectedVersionId: null, monthSetups: {} };
    const notes: SheetNotes = { days: { '2026-09-06': { events: 'Clalit' } }, weekly: { 4: 'Perlite' } };
    expect(parseBackup(buildBackup({ ...base, sheetNotes: notes })).sheetNotes).toEqual(notes);
    const old = JSON.parse(buildBackup({ ...base, sheetNotes: notes }));
    delete old.sheetNotes;
    expect(parseBackup(JSON.stringify(old)).sheetNotes).toEqual(emptySheetNotes());
  });
});

describe('data export', () => {
  it('writes a real workbook with the schedule and a summary', () => {
    const v = septemberVersion();
    const files = unzip(scheduleWorkbook(v, id => id, [{ name: 'Dan', shifts: 20, day: 5, night: 15, weekend: 4, hours: 190.5, pay: 15000 }], false));
    expect(files['xl/workbook.xml']).toContain('<sheet name="Schedule"');
    expect(files['xl/workbook.xml']).toContain('<sheet name="Summary"');
    expect(cellText(files, 'A3')).toBe(String(excelDate('2026-08-30')));
    expect(cellText(files, 'C3')).toBe('Nitzan');
    expect(files['xl/worksheets/sheet2.xml']).toContain('<v>190.5</v>');
  });
});
