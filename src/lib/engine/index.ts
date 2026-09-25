// Scheduling engine entry point.
import type { DayAssignment, WorkerTarget } from '../../types';
import { createRng, randomSeed } from '../random';
import { buildProblem, DAY, NIGHT, Problem, ProblemInput } from './model';
import { Solver } from './solver';

export { buildProblem } from './model';
export type { Problem, ProblemInput } from './model';
export { waterFill } from './targets';

export interface EngineInput extends ProblemInput {
  seed?: number;
  // Search effort per restart (default tuned for < 1s on a phone)
  iterations?: number;
  restarts?: number;
}

export interface EngineResult {
  days: (DayAssignment & { date: string; inMonth: boolean })[];
  targets: Record<string, WorkerTarget>;
  seed: number;
  cost: number;
  unfilled: number;
}

export function defaultIterations(P: Problem): number {
  // Scale with problem size; small teams converge fast.
  return Math.round(Math.min(120000, Math.max(30000, P.W * P.G * 90)));
}

export function runEngine(input: EngineInput): EngineResult {
  const P = buildProblem(input);
  const seed = input.seed ?? randomSeed();
  const rng = createRng(seed);
  const iterations = input.iterations ?? defaultIterations(P);
  const restarts = Math.max(1, input.restarts ?? 3);

  let best: Solver | null = null;
  for (let r = 0; r < restarts; r++) {
    const s = new Solver(P, rng);
    s.construct();
    if (P.W > 0) s.anneal({ iterations, startTemp: 2.5, endTemp: 0.02 });
    s.restoreBest();
    if (!best || s.cost < best.cost) best = s;
  }
  const solver = best!;

  const days = P.dates.map((date, g) => {
    const kept = input.locked?.[date] || input.pins?.[date];
    const dayShift = kept ? [...kept.dayShift] : [];
    const nightShift = kept ? [...kept.nightShift] : [];
    if (!P.locked[g]) {
      P.workers.forEach((w, i) => {
        if (w.fixed[g] >= 0) return;
        const k = solver.asg[i][g];
        if (k === DAY) dayShift.push(w.id);
        else if (k === NIGHT) nightShift.push(w.id);
      });
    }
    return { date, dayShift, nightShift, inMonth: P.inMonth[g] === 1 };
  });

  const targets: Record<string, WorkerTarget> = {};
  P.workers.forEach(w => {
    targets[w.id] = {
      shifts: round2(w.target),
      hours: round2(w.hoursTarget),
      weekend: round2(w.weekendTarget),
    };
  });

  return { days, targets, seed, cost: solver.cost, unfilled: solver.missing };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CapacityCheck {
  slots: number;     // shifts to fill in the month
  capacity: number;  // rough max the active team can legally cover
  // Days where fewer people are available than the day needs
  shortDays: { date: string; available: number; needed: number }[];
}

// Quick feasibility estimate shown before generating
export function capacityCheck(input: ProblemInput): CapacityCheck {
  const P = buildProblem(input);
  let slots = 0;
  const shortDays: CapacityCheck['shortDays'] = [];
  for (let g = 0; g < P.G; g++) {
    if (!P.inMonth[g]) continue;
    const needDay = P.solo[g] ? (P.solo[g] === DAY ? 1 : 0) : P.reqDay[g];
    const needNight = P.solo[g] ? (P.solo[g] === NIGHT ? 1 : 0) : P.reqNight[g];
    const needed = needDay + needNight;
    slots += needed;
    if (needed === 0) continue;
    let any = 0, day = 0, night = 0;
    P.workers.forEach(w => {
      if (!w.avail[g]) return;
      any++;
      if (w.canDay) day++;
      if (w.canNight) night++;
    });
    const available = Math.min(any, Math.min(day, needDay) + Math.min(night, needNight));
    if (available < needed) shortDays.push({ date: P.dates[g], available, needed });
  }
  const ratio = P.maxConsecutive / (P.maxConsecutive + P.minRest);
  const capacity = P.workers.reduce((sum, w) => sum + Math.min(w.cap, w.workDays, Math.ceil(w.workDays * ratio)), 0);
  return { slots, capacity, shortDays };
}
