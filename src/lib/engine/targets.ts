// Fair-share targets: how many shifts, hours and weekend shifts each worker
// "should" get this month.
//
// Shares are proportional to the days each worker can actually work, so time
// off is never compensated later (a week of vacation simply means fewer
// shifts). A worker's max-shifts limit caps their share and the remainder is
// spread over everyone else ("water-filling"). Day-only / night-only workers
// can never exceed the number of slots of their shift type.
import type { Problem } from './model';
import { DAY } from './model';

export function waterFill(weights: number[], caps: number[], total: number): number[] {
  const n = weights.length;
  if (n === 0 || total <= 0) return new Array(n).fill(0);
  const capOf = (i: number) => (weights[i] > 0 ? caps[i] : 0);
  let sumCaps = 0;
  for (let i = 0; i < n; i++) sumCaps += capOf(i);
  if (sumCaps <= total) return weights.map((_, i) => capOf(i));
  const fill = (lambda: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.min(capOf(i), lambda * weights[i]);
    return s;
  };
  let lo = 0;
  let hi = 1;
  while (fill(hi) < total) hi *= 2;
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) / 2;
    if (fill(mid) < total) lo = mid; else hi = mid;
  }
  return weights.map((w, i) => Math.min(capOf(i), hi * w));
}

export function computeTargets(P: Problem, dayShare: number): void {
  const { workers, G } = P;
  let slots = 0, daySlots = 0, nightSlots = 0, premSlots = 0, hours = 0, padSlots = 0;
  for (let g = 0; g < G; g++) {
    const s = P.solo[g];
    const d = s ? (s === DAY ? 1 : 0) : P.reqDay[g];
    const nt = s ? (s === DAY ? 0 : 1) : P.reqNight[g];
    if (P.inMonth[g]) {
      slots += d + nt;
      daySlots += d;
      nightSlots += nt;
      hours += (d + nt) * P.hours[g];
      if (P.premium[g]) premSlots += d + nt;
    } else {
      padSlots += d + nt;
    }
  }
  P.avgShiftHours = slots > 0 ? hours / slots : 1;

  const ratio = P.maxConsecutive / (P.maxConsecutive + P.minRest);
  const weight = workers.map(w => w.availDays);
  const ub = workers.map(w => Math.min(w.cap, w.workDays, Math.ceil(w.workDays * ratio)));
  const T = waterFill(weight, ub, slots);

  const refill = (idx: number[], total: number) => {
    const f = waterFill(idx.map(i => weight[i]), idx.map(i => ub[i]), total);
    idx.forEach((i, j) => { T[i] = f[j]; });
  };
  const indices = (pred: (i: number) => boolean) => workers.map((_, i) => i).filter(pred);
  const sum = (idx: number[]) => idx.reduce((s, i) => s + T[i], 0);

  const dayOnly = indices(i => workers[i].dayOnly);
  const nightOnly = indices(i => workers[i].nightOnly);
  const flexible = indices(i => !workers[i].dayOnly && !workers[i].nightOnly);

  if (sum(dayOnly) > daySlots) refill(dayOnly, daySlots);
  if (sum(nightOnly) > nightSlots) refill(nightOnly, nightSlots);
  // Optional: Day-only workers hand some day shifts to flexible workers
  if (dayShare > 0 && flexible.length > 0) dayOnly.forEach(i => { T[i] = Math.max(0, T[i] - dayShare); });
  refill(flexible, Math.max(0, slots - sum(dayOnly) - sum(nightOnly)));

  applyCarry(T, workers.map(w => w.carryShifts), ub);

  // Weekend share: proportional to each worker's share of work and to how
  // many weekend days they are available.
  const premWeight = workers.map((w, i) => (w.availDays > 0 ? T[i] * w.premAvailDays / w.availDays : 0));
  const premCap = workers.map((w, i) => Math.min(w.premWorkDays, Math.ceil(T[i])));
  const PT = waterFill(premWeight, premCap, premSlots);
  applyCarry(PT, workers.map(w => w.carryWeekend), premCap);

  // Padding days (outside the month) get a light, proportional share so the
  // overlap weeks stay balanced too.
  const padAvail = workers.map(w => {
    let n = 0;
    for (let g = 0; g < G; g++) {
      if (P.inMonth[g] || !w.avail[g]) continue;
      if ((w.canDay && P.reqDay[g] > 0) || (w.canNight && P.reqNight[g] > 0)) n++;
    }
    return n;
  });
  const padWeight = workers.map((w, i) => (w.availDays > 0 ? padAvail[i] * T[i] / w.availDays : padAvail[i] * 0.1));
  const padT = waterFill(padWeight, padAvail, padSlots);

  const hoursPerSlot = slots > 0 ? hours / slots : 0;
  workers.forEach((w, i) => {
    w.target = T[i];
    w.hoursTarget = T[i] * hoursPerSlot;
    w.weekendTarget = PT[i];
    w.padTarget = padT[i];
  });
}

// Whoever got more than their share last month (e.g. the odd extra shift
// from rounding) starts slightly lower this month, and vice versa. The total
// stays the same.
function applyCarry(values: number[], carry: number[], caps: number[]): void {
  if (!carry.some(c => c !== 0)) return;
  const before = values.reduce((a, b) => a + b, 0);
  const next = values.map((v, i) => Math.max(0, Math.min(caps[i], v - carry[i])));
  const after = next.reduce((a, b) => a + b, 0);
  const diff = before - after;
  // Spread the difference in proportion to current values (never past caps)
  const room = next.map((v, i) => (diff > 0 ? (Number.isFinite(caps[i]) ? Math.max(0, caps[i] - v) : v) : v));
  const roomSum = room.reduce((a, b) => a + b, 0);
  if (roomSum > 0) next.forEach((v, i) => { next[i] = v + diff * Math.min(1, room[i] / roomSum); });
  next.forEach((v, i) => { values[i] = Math.max(0, Math.min(caps[i], v)); });
}
