import { describe, expect, it } from 'vitest';
import { validateSchedule, assignmentHints } from '../src/lib/validate';
import { calculatePayroll, splitTiers } from '../src/lib/payroll';
import { parseBackup, parseScheduleCSV, scheduleToCSV, normalizeVersions } from '../src/lib/io';
import { resolveContinuity, splitContext } from '../src/lib/continuity';
import { generateVersion, keptParts } from '../src/lib/generate';
import { computeStats } from '../src/lib/stats';
import { DailySchedule, ScheduleVersion, ShiftType, WorkerPreference } from '../src/types';
import { config, team, worker } from './helpers';
import { gridKeys, addDays } from '../src/lib/dates';

const day = (date: string, dayShift: string[], nightShift: string[], isPadding = false): DailySchedule => ({ date, dayShift, nightShift, isPadding });

describe('validator', () => {
  const employees = [
    worker('A'), worker('B', WorkerPreference.DAY_ONLY),
    worker('C', WorkerPreference.EITHER, { availability: { daysOff: [6], unavailableDates: ['2026-10-05'] }, targetShifts: 1 }),
  ];
  const cfg = config({ maxConsecutiveDays: 2, minRestDays: 2, requirements: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, { day: 1, night: 1 }])) as any });

  it('flags each kind of rule break', () => {
    const schedule = [
      day('2026-10-04', ['A'], ['B']),        // B works nights? B is day-only -> shiftType
      day('2026-10-05', ['A'], ['C']),        // C unavailable
      day('2026-10-06', ['A'], ['C']),        // A: 3rd day in a row (max 2); C over cap (1)
      day('2026-10-07', [], ['C']),           // day slot empty
      day('2026-10-08', ['C'], []),           // C day after night; night empty
      day('2026-10-09', [], []),
      day('2026-10-10', ['A', 'A'], []),      // A: rest only 1... actually 2 days off; double booked
    ];
    const r = validateSchedule(schedule, employees, cfg);
    const kinds = new Set(r.issues.map(i => i.kind));
    ['shiftType', 'unavailable', 'streak', 'cap', 'empty', 'dayAfterNight', 'double'].forEach(k => expect(kinds.has(k as any)).toBe(true));
    expect(r.emptySlots).toBeGreaterThan(0);
  });

  it('flags too little rest and day/night switches inside a run', () => {
    const schedule = [
      day('2026-10-11', ['A'], []),
      day('2026-10-12', [], ['A']),  // day -> night inside a run
      day('2026-10-13', [], []),
      day('2026-10-14', ['A'], []),  // only 1 day off (min 2)
    ];
    const kinds = validateSchedule(schedule, employees, cfg).issues.map(i => i.kind);
    expect(kinds).toContain('mixedRun');
    expect(kinds).toContain('rest');
  });

  it('uses history before the grid', () => {
    const schedule = [day('2026-10-04', ['A'], [])];
    const history = { '2026-10-02': { dayShift: ['A'], nightShift: [] }, '2026-10-03': { dayShift: [], nightShift: ['A'] } };
    const kinds = validateSchedule(schedule, employees, cfg, history).issues.map(i => i.kind);
    expect(kinds).toContain('dayAfterNight');
    expect(kinds).toContain('streak');
  });

  it('gives hints before an assignment is made', () => {
    const schedule = [day('2026-10-04', [], ['A']), day('2026-10-05', [], [])];
    const hints = assignmentHints(schedule, employees[0], '2026-10-05', ShiftType.DAY, cfg, undefined, employees);
    expect(hints.map(h => h.kind)).toContain('dayAfterNight');
  });
});

describe('payroll', () => {
  it('splits daily hours into tiers', () => {
    expect(splitTiers(7)).toEqual({ reg: 7, ot125: 0, ot150: 0 });
    expect(splitTiers(9.5)).toEqual({ reg: 8, ot125: 1.5, ot150: 0 });
    expect(splitTiers(12)).toEqual({ reg: 8, ot125: 2, ot150: 2 });
  });

  it('pays split days and whole days, skipping padding', () => {
    const employees = [worker('A'), worker('B')];
    const cfg = config({ dailyTimings: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, { startTime: '07:00', endTime: '22:00' }])) as any });
    const schedule = [
      day('2026-10-04', ['A'], ['B']),   // split: (15 + 1) / 2 = 8h each
      day('2026-10-05', ['A'], []),      // whole day: 15h
      day('2026-11-01', ['B'], [], true),
    ];
    const { byWorker, total } = calculatePayroll(schedule, employees, cfg);
    expect(byWorker.A.totalHours).toBe(23);
    expect(byWorker.A.overtime150).toBe(5);
    expect(byWorker.B.totalHours).toBe(8);
    expect(byWorker.A.estimatedPay).toBeCloseTo(8 * 75 + (8 * 75 + 2 * 75 * 1.25 + 5 * 75 * 1.5), 5);
    expect(total.shifts).toBe(3);
  });

  it('uses special-day hours', () => {
    const employees = [worker('A')];
    const cfg = config({ specialDays: { '2026-10-04': { startTime: '07:00', endTime: '12:00' } } });
    const { byWorker } = calculatePayroll([day('2026-10-04', ['A'], [])], employees, cfg);
    expect(byWorker.A.totalHours).toBe(5);
  });
});

describe('CSV import/export', () => {
  const employees = [worker('1', WorkerPreference.EITHER, { name: 'גולן חדד' }), worker('2', WorkerPreference.EITHER, { name: 'Dan "D" Aharoni' })];

  it('round-trips a schedule including Hebrew names and quotes', () => {
    const version = { name: 'x', schedule: [day('2026-10-04', ['1'], ['2']), day('2026-10-05', [], ['1'], true)] } as ScheduleVersion;
    const csv = scheduleToCSV(version, id => employees.find(e => e.id === id)!.name);
    const parsed = parseScheduleCSV(csv, employees);
    expect(parsed.entries['2026-10-04']).toEqual({ dayShift: ['1'], nightShift: ['2'] });
    expect(parsed.entries['2026-10-05']).toEqual({ dayShift: [], nightShift: ['1'] });
    expect(parsed.unmatched).toEqual([]);
  });

  it('reads dates re-saved by Excel as DD/MM/YYYY and reports unknown names', () => {
    const csv = 'Date,Is Padding,Day Shift Worker 1,Night Shift Worker 1\r\n30/11/2025,No,גולן חדד,Someone\r\n01/12/2025,Yes,,גולן חדד\r\n';
    const parsed = parseScheduleCSV(csv, employees);
    expect(Object.keys(parsed.entries).sort()).toEqual(['2025-11-30', '2025-12-01']);
    expect(parsed.unmatched).toEqual(['Someone']);
  });

  it('rejects files without shift columns', () => {
    expect(() => parseScheduleCSV('a,b\n1,2\n', employees)).toThrow();
  });
});

describe('backups and saved data from earlier builds', () => {
  it('loads a v1 backup and fills in new fields', () => {
    const v1 = {
      app: 'ShiftMaster', backupVersion: 1, exportedAt: '2026-07-01T00:00:00Z',
      employees: [{ id: '1', name: 'גולן חדד', preference: 'Day Only', availability: { daysOff: [6] }, color: '#fff', targetShifts: 12, hourlyRate: 75 }],
      config: { dailyTimings: { 0: { startTime: '07:00', endTime: '16:00' } }, requirements: { 0: { day: 1, night: 2 } }, distributeDayShiftsToEither: true },
      versions: [{ id: 'v', timestamp: 1, name: 'Schedule Jul 2026 · v1', month: 6, year: 2026, schedule: [{ date: '2026-07-01', dayShift: ['1'], nightShift: [], locked: true }], stats: {} }],
      selectedVersionId: 'v',
    };
    const data = parseBackup(JSON.stringify(v1));
    expect(data.employees[0].availability.unavailableDates).toEqual([]);
    expect(data.employees[0].color).not.toBe('#fff');
    expect(data.employees[0].targetShifts).toBe(12);
    expect(data.employees[0].active).toBe(true);
    expect(data.config.requirements[3]).toEqual({ day: 1, night: 1 });
    expect(data.config.maxConsecutiveDays).toBe(5);
    expect(data.config.distributeDayShiftsToEither).toBe(true);
    expect(data.versions[0].schedule[0].locked).toBe(true);
    expect(data.monthSetups).toEqual({});
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('{"hello":1}')).toThrow();
  });

  it('computes legacy stats for versions saved without them', () => {
    const [v] = normalizeVersions([{ id: 'a', timestamp: 1, name: 'n', month: 9, year: 2026, schedule: [{ date: '2026-10-01', dayShift: ['x'], nightShift: [] }] }]);
    expect(v.stats.x.totalShifts).toBe(1);
  });
});

describe('month continuity', () => {
  const employees = team();
  const cfg = config();

  it('carries the overlap week of last month and uses earlier days as history', () => {
    const nov = generateVersion({ employees, config: cfg, year: 2025, month: 10, continuity: resolveContinuity([], 2025, 10, undefined), variation: 1, seed: 1 });
    nov.final = true;
    const c = resolveContinuity([nov], 2025, 11, undefined, employees, cfg);
    expect(c.source).toBe('version');
    // December 2025 grid starts Sun Nov 30; November's grid ends Sat Dec 6
    expect(Object.keys(c.carried).sort()).toEqual(['2025-11-30', '2025-12-01', '2025-12-02', '2025-12-03', '2025-12-04', '2025-12-05', '2025-12-06']);
    expect(c.history['2025-11-29']).toBeDefined();
    expect(c.carry).toBeDefined();

    const dec = generateVersion({ employees, config: cfg, year: 2025, month: 11, continuity: c, variation: 1, seed: 2 });
    const novDays = new Map(nov.schedule.map(d => [d.date, d]));
    dec.schedule.filter(d => c.carried[d.date]).forEach(d => {
      expect(d.dayShift).toEqual(novDays.get(d.date)!.dayShift);
      expect(d.nightShift).toEqual(novDays.get(d.date)!.nightShift);
      expect(d.carried && d.locked).toBe(true);
    });
    const issues = validateSchedule(dec.schedule, employees, cfg, dec.history).issues.filter(i => i.severity === 'error');
    expect(issues).toEqual([]);
  });

  it('lets the manager release carried days or start fresh', () => {
    const entries = { '2025-11-29': { dayShift: ['Dan'], nightShift: [] }, '2025-11-30': { dayShift: ['Dan'], nightShift: [] } };
    const custom = resolveContinuity([], 2025, 11, { continuity: 'custom', custom: entries, released: ['2025-11-30'] });
    expect(custom.carried).toEqual({});
    expect(custom.history['2025-11-29']).toBeDefined();
    expect(resolveContinuity([], 2025, 11, { continuity: 'none', custom: entries }).source).toBe('none');
    expect(splitContext(entries, 2025, 11).carried['2025-11-30']).toBeDefined();
  });

  it('keeps locked days and pins from the version being regenerated', () => {
    const grid = gridKeys(2026, 9);
    const base = generateVersion({ employees, config: cfg, year: 2026, month: 9, continuity: resolveContinuity([], 2026, 9, undefined), variation: 1, seed: 3 });
    base.schedule[8] = { ...base.schedule[8], locked: true };
    base.schedule[9] = { ...base.schedule[9], pinned: [base.schedule[9].nightShift[0]] };
    const kept = keptParts({ employees, year: 2026, month: 9, base, continuity: resolveContinuity([], 2026, 9, undefined) });
    expect(kept.locked[grid[8]]).toBeDefined();
    expect(kept.pins[grid[9]].nightShift).toEqual([base.schedule[9].nightShift[0]]);
    const next = generateVersion({ employees, config: cfg, year: 2026, month: 9, base, continuity: resolveContinuity([], 2026, 9, undefined), variation: 2, seed: 4 });
    expect(next.schedule[8].dayShift).toEqual(base.schedule[8].dayShift);
    expect(next.schedule[9].nightShift).toContain(base.schedule[9].nightShift[0]);
  });

  it('evens out last month\'s rounding', () => {
    const nov = generateVersion({ employees, config: cfg, year: 2026, month: 10, continuity: resolveContinuity([], 2026, 10, undefined), variation: 1, seed: 21 });
    const stats = computeStats(nov.schedule, cfg, employees.map(e => e.id), nov.targets);
    const over = employees.filter(e => stats[e.id].shifts > nov.targets![e.id].shifts + 0.3).map(e => e.id);
    const c = resolveContinuity([nov], 2026, 11, undefined, employees, cfg);
    const dec = generateVersion({ employees, config: cfg, year: 2026, month: 11, continuity: c, variation: 1, seed: 22 });
    const base = generateVersion({ employees, config: cfg, year: 2026, month: 11, continuity: { ...c, carry: undefined }, variation: 1, seed: 22 });
    over.forEach(id => expect(dec.targets![id].shifts).toBeLessThan(base.targets![id].shifts));
  });
});

describe('stats', () => {
  it('counts weekends, singles and streaks from the schedule', () => {
    const cfg = config();
    const start = '2026-10-04';
    const schedule = [0, 1, 2, 4, 6].map(i => day(addDays(start, i), ['A'], []));
    const full = Array.from({ length: 7 }, (_, i) => schedule.find(d => d.date === addDays(start, i)) || day(addDays(start, i), [], []));
    const s = computeStats(full, cfg, ['A'])['A'];
    expect(s.shifts).toBe(5);
    expect(s.longestStreak).toBe(3);
    expect(s.weekend).toBe(1); // Sat Oct 10
  });
});

describe('fixes found in browser testing', () => {
  const employees = team();
  const cfg = config();

  it('keeps a hand-edited carried day instead of re-copying last month', () => {
    const nov = generateVersion({ employees, config: cfg, year: 2025, month: 10, continuity: resolveContinuity([], 2025, 10, undefined), variation: 1, seed: 5 });
    const c = resolveContinuity([nov], 2025, 11, undefined, employees, cfg);
    const dec = generateVersion({ employees, config: cfg, year: 2025, month: 11, continuity: c, variation: 1, seed: 6 });
    // The manager edits a carried day: it stays locked but is no longer "carried"
    const edited = dec.schedule.map(d => d.date === '2025-12-02' ? { ...d, dayShift: ['Golan'], nightShift: ['Dan', 'Roy'], carried: undefined, locked: true } : d);
    const kept = keptParts({ employees, year: 2025, month: 11, base: { ...dec, schedule: edited }, continuity: c });
    expect(kept.locked['2025-12-02']).toEqual({ dayShift: ['Golan'], nightShift: ['Dan', 'Roy'] });
    expect(kept.carriedDates.has('2025-12-02')).toBe(false);
    expect(kept.carriedDates.has('2025-12-03')).toBe(true);
  });

  it('warns about people scheduled on a closed day', () => {
    const closed = config({ specialDays: { '2026-10-07': { closed: true, label: 'Holiday' } } });
    const r = validateSchedule([day('2026-10-07', ['Golan'], [])], employees, closed);
    expect(r.issues.some(i => i.kind === 'closedDay' && i.severity === 'warning')).toBe(true);
  });

  it('spots days with too few available people before generating', async () => {
    const { capacityCheck } = await import('../src/lib/engine');
    const away = employees.map((e, i) => i < 4 ? { ...e, availability: { ...e.availability, unavailableDates: ['2026-10-13'] } } : e);
    const cap = capacityCheck({ employees: away, year: 2026, month: 9, config: cfg });
    expect(cap.shortDays).toEqual([{ date: '2026-10-13', available: 2, needed: 3 }]);
    expect(cap.slots).toBe(80);
  });
});
