import { describe, expect, it } from 'vitest';
import { runEngine } from '../src/lib/engine';
import { validateSchedule } from '../src/lib/validate';
import { computeStats } from '../src/lib/stats';
import { DailySchedule, DayAssignmentMap, WorkerPreference } from '../src/types';
import { config, team, vacation, worker } from './helpers';
import { addDays, gridKeys, weekdayOf } from '../src/lib/dates';

const toSchedule = (days: ReturnType<typeof runEngine>['days']): DailySchedule[] =>
  days.map(d => ({ date: d.date, dayShift: d.dayShift, nightShift: d.nightShift, isPadding: !d.inMonth }));

const hardErrors = (schedule: DailySchedule[], employees: ReturnType<typeof team>, cfg: ReturnType<typeof config>, history?: DayAssignmentMap) =>
  validateSchedule(schedule, employees, cfg, history).issues.filter(i => i.severity === 'error' && i.kind !== 'empty');

const scenarios = [
  { name: 'default team', employees: team(), cfg: config(), year: 2026, month: 9 },
  { name: 'blocks off', employees: team(), cfg: config({ blockScheduling: false }), year: 2026, month: 10 },
  {
    name: 'understaffed with cap and long absence',
    employees: [worker('A'), worker('B', WorkerPreference.EITHER, { targetShifts: 12 }),
      worker('C', WorkerPreference.EITHER, { availability: { daysOff: [], unavailableDates: vacation('2026-08-11', '2026-08-31') } }), worker('D')],
    cfg: config({ requirements: { 0: { day: 1, night: 2 }, 1: { day: 1, night: 1 }, 2: { day: 1, night: 2 }, 3: { day: 1, night: 2 }, 4: { day: 1, night: 2 }, 5: { day: 1, night: 1 }, 6: { day: 1, night: 1 } } }),
    year: 2026, month: 7,
  },
  {
    name: 'solo days, strict rest',
    employees: [worker('A', WorkerPreference.DAY_ONLY), worker('B'), worker('C'), worker('D', WorkerPreference.NIGHT_ONLY), worker('E')],
    cfg: config({ maxConsecutiveDays: 4, minRestDays: 2, requirements: { 0: { day: 1, night: 1 }, 1: { day: 1, night: 0 }, 2: { day: 1, night: 1 }, 3: { day: 0, night: 1 }, 4: { day: 1, night: 1 }, 5: { day: 1, night: 0 }, 6: { day: 1, night: 2 } } }),
    year: 2027, month: 5,
  },
  {
    name: 'soft wishes',
    employees: [worker('A', WorkerPreference.PREFERS_DAY), worker('B', WorkerPreference.PREFERS_NIGHT), worker('C'), worker('D'),
      worker('E', WorkerPreference.EITHER, { availability: { daysOff: [], unavailableDates: [], preferOffDays: [5, 6] } }), worker('F')],
    cfg: config(), year: 2026, month: 11,
  },
];

describe('engine: hard rules', () => {
  for (const sc of scenarios) {
    it(`never breaks a rule: ${sc.name}`, () => {
      for (let seed = 1; seed <= 6; seed++) {
        const res = runEngine({ employees: sc.employees, year: sc.year, month: sc.month, config: sc.cfg, seed, iterations: 15000, restarts: 1 });
        const schedule = toSchedule(res.days);
        expect(hardErrors(schedule, sc.employees, sc.cfg)).toEqual([]);
        if (sc.cfg.blockScheduling !== false) {
          const mixed = validateSchedule(schedule, sc.employees, sc.cfg).issues.filter(i => i.kind === 'mixedRun');
          expect(mixed).toEqual([]);
        }
      }
    });
  }

  it('fills every slot when there are enough people', () => {
    const sc = scenarios[0];
    const res = runEngine({ employees: sc.employees, year: sc.year, month: sc.month, config: sc.cfg, seed: 3 });
    expect(res.unfilled).toBe(0);
    expect(validateSchedule(toSchedule(res.days), sc.employees, sc.cfg).emptySlots).toBe(0);
  });

  it('is reproducible from its seed', () => {
    const sc = scenarios[0];
    const a = runEngine({ employees: sc.employees, year: sc.year, month: sc.month, config: sc.cfg, seed: 42, iterations: 8000 });
    const b = runEngine({ employees: sc.employees, year: sc.year, month: sc.month, config: sc.cfg, seed: 42, iterations: 8000 });
    expect(a.days).toEqual(b.days);
  });
});

describe('engine: fairness', () => {
  it('keeps everyone within one shift of their fair share', () => {
    const employees = team();
    const cfg = config();
    const res = runEngine({ employees, year: 2026, month: 9, config: cfg, seed: 7 });
    const stats = computeStats(toSchedule(res.days), cfg, employees.map(e => e.id), res.targets);
    employees.forEach(e => {
      expect(Math.abs(stats[e.id].shifts - res.targets[e.id].shifts)).toBeLessThanOrEqual(1);
    });
    const weekends = employees.map(e => stats[e.id].weekend);
    expect(Math.max(...weekends) - Math.min(...weekends)).toBeLessThanOrEqual(2);
  });

  it('honours a max-shifts limit exactly when work is plentiful, spread over the month', () => {
    const employees = team();
    employees[1] = { ...employees[1], targetShifts: 7 };
    const cfg = config();
    const res = runEngine({ employees, year: 2027, month: 1, config: cfg, seed: 11 });
    const schedule = toSchedule(res.days);
    const stats = computeStats(schedule, cfg, employees.map(e => e.id), res.targets);
    expect(stats[employees[1].id].shifts).toBe(7);
    // no week with more than 3 of those 7 shifts
    const perWeek = new Map<number, number>();
    schedule.forEach((d, i) => {
      if (!d.isPadding && (d.dayShift.includes(employees[1].id) || d.nightShift.includes(employees[1].id))) {
        const w = Math.floor(i / 7);
        perWeek.set(w, (perWeek.get(w) || 0) + 1);
      }
    });
    expect(Math.max(...perWeek.values())).toBeLessThanOrEqual(3);
  });

  it('does not compensate time off', () => {
    const employees = team();
    employees[2] = { ...employees[2], availability: { ...employees[2].availability, unavailableDates: vacation('2027-01-10', '2027-01-16') } };
    const cfg = config();
    const res = runEngine({ employees, year: 2027, month: 0, config: cfg, seed: 5 });
    const stats = computeStats(toSchedule(res.days), cfg, employees.map(e => e.id), res.targets);
    const others = employees.filter((_, i) => i !== 2 && i !== 0).map(e => stats[e.id].shifts);
    expect(stats[employees[2].id].shifts).toBeLessThan(Math.min(...others));
    expect(res.targets[employees[2].id].shifts).toBeLessThan(res.targets[employees[3].id].shifts);
  });

  it('gives night-only and day-only workers a full share when their shift type has room', () => {
    const employees = [worker('A', WorkerPreference.DAY_ONLY), worker('B'), worker('C'), worker('D', WorkerPreference.NIGHT_ONLY), worker('E')];
    const cfg = config({ requirements: { 0: { day: 1, night: 1 }, 1: { day: 1, night: 0 }, 2: { day: 1, night: 1 }, 3: { day: 0, night: 1 }, 4: { day: 1, night: 1 }, 5: { day: 1, night: 0 }, 6: { day: 1, night: 2 } } });
    const res = runEngine({ employees, year: 2027, month: 5, config: cfg, seed: 2 });
    const t = employees.map(e => res.targets[e.id].shifts);
    expect(Math.max(...t) - Math.min(...t)).toBeLessThan(0.01);
  });

  it('moves day shifts from Day-only workers to Either workers when asked', () => {
    const employees = team();
    const on = runEngine({ employees, year: 2026, month: 11, config: config({ distributeDayShiftsToEither: true, dayShareAmount: 3 }), seed: 9 });
    const off = runEngine({ employees, year: 2026, month: 11, config: config(), seed: 9 });
    expect(on.targets.Golan.shifts).toBeCloseTo(off.targets.Golan.shifts - 3, 5);
    const stats = computeStats(toSchedule(on.days), config(), employees.map(e => e.id), on.targets);
    expect(stats.Golan.shifts).toBeLessThanOrEqual(Math.round(on.targets.Golan.shifts) + 1);
  });

  it('respects soft wishes when the team allows it', () => {
    const employees = [worker('A', WorkerPreference.PREFERS_DAY), worker('B', WorkerPreference.PREFERS_NIGHT), worker('C'), worker('D'),
      worker('E', WorkerPreference.EITHER, { availability: { daysOff: [], unavailableDates: [], preferOffDays: [5] } }), worker('F')];
    const cfg = config();
    const res = runEngine({ employees, year: 2026, month: 11, config: cfg, seed: 4 });
    const schedule = toSchedule(res.days);
    const stats = computeStats(schedule, cfg, employees.map(e => e.id), res.targets);
    expect(stats.A.day).toBeGreaterThan(stats.A.night);
    expect(stats.B.night).toBeGreaterThan(stats.B.day);
    const fridays = schedule.filter(d => !d.isPadding && weekdayOf(d.date) === 5 && (d.dayShift.includes('E') || d.nightShift.includes('E')));
    expect(fridays.length).toBeLessThanOrEqual(1);
  });
});

describe('engine: kept days and history', () => {
  const employees = team();
  const cfg = config();
  const grid = gridKeys(2026, 9);

  it('keeps locked days and pinned shifts exactly', () => {
    const locked: DayAssignmentMap = { [grid[10]]: { dayShift: ['Nitzan'], nightShift: [] } }; // deliberately short-staffed
    const pins: DayAssignmentMap = { [grid[12]]: { dayShift: [], nightShift: ['Dan'] } };
    const res = runEngine({ employees, year: 2026, month: 9, config: cfg, locked, pins, seed: 1 });
    const d10 = res.days[10];
    expect(d10.dayShift).toEqual(['Nitzan']);
    expect(d10.nightShift).toEqual([]);
    expect(res.days[12].nightShift).toContain('Dan');
    expect(res.days[12].nightShift.length).toBe(cfg.requirements[weekdayOf(grid[12])].night);
  });

  it('continues streaks and night shifts from history', () => {
    const history: DayAssignmentMap = {};
    for (let i = 5; i >= 1; i--) history[addDays(grid[0], -i)] = { dayShift: ['Golan'], nightShift: i === 1 ? ['Dan'] : [] };
    for (let seed = 1; seed <= 5; seed++) {
      const res = runEngine({ employees, year: 2026, month: 9, config: cfg, history, seed, iterations: 10000 });
      expect(res.days[0].dayShift).not.toContain('Golan'); // would be a 6th day in a row
      expect(res.days[0].dayShift).not.toContain('Dan');   // day right after a night
      expect(hardErrors(toSchedule(res.days), employees, cfg, history)).toEqual([]);
    }
  });

  it('honours special days (closed and custom staffing)', () => {
    const special = config({ specialDays: { '2026-10-07': { closed: true, label: 'Holiday' }, '2026-10-14': { day: 2, night: 2 } } });
    const res = runEngine({ employees, year: 2026, month: 9, config: special, seed: 8 });
    const closed = res.days.find(d => d.date === '2026-10-07')!;
    expect(closed.dayShift.length + closed.nightShift.length).toBe(0);
    const busy = res.days.find(d => d.date === '2026-10-14')!;
    expect(busy.dayShift.length).toBe(2);
    expect(busy.nightShift.length).toBe(2);
  });

  it('never schedules inactive or unknown workers on its own', () => {
    const res = runEngine({ employees: employees.slice(0, 5), year: 2026, month: 9, config: cfg, seed: 3 });
    res.days.forEach(d => expect([...d.dayShift, ...d.nightShift]).not.toContain('Omri'));
  });
});
