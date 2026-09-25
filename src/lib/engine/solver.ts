// Schedule search.
//
// 1. Greedy construction walks the grid day by day and fills each slot with
//    the best-paced worker who can legally take it.
// 2. Local search (simulated annealing) then keeps making small changes -
//    hand a shift or a run of shifts to someone else, swap days between two
//    workers, swap day/night between two workers - and keeps the ones that
//    make the schedule fairer.
//
// Hard rules are never traded for fairness: every change is checked and
// rejected if it adds a rule break for any worker involved (breaks that
// already exist in days the manager locked or pinned are left alone).
import type { Problem } from './model';
import { DAY, NIGHT, NEVER, OFF, Kind } from './model';
import { Rng, randInt } from '../random';

export interface SolveOptions {
  iterations: number;
  startTemp: number;
  endTemp: number;
}

export class Solver {
  readonly P: Problem;
  readonly rng: Rng;
  readonly asg: Int8Array[];
  readonly cntDay: Int16Array;
  readonly cntNight: Int16Array;

  // Per-worker cached evaluation
  readonly viol: Int32Array;
  readonly local: Float64Array;
  readonly shifts: Int32Array;
  readonly days: Int32Array;
  readonly prem: Int32Array;

  missing = 0;       // unfilled slots (count)
  missingCost = 0;   // unfilled slots weighted (month days count more than padding)
  mix = 0;
  cost = 0;

  best: Int8Array[];
  bestCost = Infinity;

  // Scratch for evaluation
  private readonly weekBuf: Float64Array;
  private ev = { viol: 0, cost: 0, shifts: 0, days: 0, prem: 0 };

  // Undo log of cell changes for the move being tried
  private uW: number[] = [];
  private uG: number[] = [];
  private uK: number[] = [];

  // Affected workers of the move being tried + their previous cached values
  private affected: number[] = [];
  private oldViol: number[] = [];
  private oldLocal: number[] = [];
  private oldShifts: number[] = [];
  private oldDays: number[] = [];
  private oldPrem: number[] = [];
  private oldMix = 0;
  private oldMissing = 0;
  private oldMissingCost = 0;

  // For greedy pacing: in-month available days up to and including g
  private readonly availPassed: Int16Array[];
  private readonly premPassed: Int16Array[];
  private readonly mixDayFraction: number;

  constructor(P: Problem, rng: Rng) {
    this.P = P;
    this.rng = rng;
    const { W, G } = P;
    this.asg = P.workers.map(w => {
      const a = new Int8Array(G);
      for (let g = 0; g < G; g++) if (w.fixed[g] > 0) a[g] = w.fixed[g];
      return a;
    });
    this.best = this.asg.map(a => a.slice());
    this.cntDay = new Int16Array(G);
    this.cntNight = new Int16Array(G);
    for (let g = 0; g < G; g++) {
      this.cntDay[g] = P.ghostDay[g];
      this.cntNight[g] = P.ghostNight[g];
      for (let w = 0; w < W; w++) {
        if (this.asg[w][g] === DAY) this.cntDay[g]++;
        else if (this.asg[w][g] === NIGHT) this.cntNight[g]++;
      }
    }
    this.viol = new Int32Array(W);
    this.local = new Float64Array(W);
    this.shifts = new Int32Array(W);
    this.days = new Int32Array(W);
    this.prem = new Int32Array(W);
    this.weekBuf = new Float64Array(Math.max(1, P.weeks));

    this.availPassed = P.workers.map(w => {
      const arr = new Int16Array(G);
      let n = 0;
      for (let g = 0; g < G; g++) {
        const slot = (w.canDay && P.reqDay[g] > 0) || (w.canNight && P.reqNight[g] > 0);
        if (P.inMonth[g] && w.avail[g] > 0 && slot) n++;
        arr[g] = n;
      }
      return arr;
    });
    this.premPassed = P.workers.map(w => {
      const arr = new Int16Array(G);
      let n = 0;
      for (let g = 0; g < G; g++) {
        const slot = (w.canDay && P.reqDay[g] > 0) || (w.canNight && P.reqNight[g] > 0);
        if (P.inMonth[g] && P.premium[g] && w.avail[g] > 0 && slot) n++;
        arr[g] = n;
      }
      return arr;
    });

    let daySlots = 0;
    let mixTarget = 0;
    let dayOnlyTarget = 0;
    for (let g = 0; g < G; g++) if (P.inMonth[g]) daySlots += P.solo[g] ? (P.solo[g] === DAY ? 1 : 0) : P.reqDay[g];
    P.workers.forEach(w => {
      if (w.mixGroup) mixTarget += w.target;
      if (w.dayOnly || w.prefKind === DAY) dayOnlyTarget += w.target;
    });
    this.mixDayFraction = mixTarget > 0 ? Math.min(1, Math.max(0, (daySlots - dayOnlyTarget) / mixTarget)) : 0.5;

    this.recomputeAll();
  }

  // ---------- Evaluation ----------

  missingAt(g: number): number {
    const P = this.P;
    if (P.locked[g]) return 0;
    const d = this.cntDay[g];
    const n = this.cntNight[g];
    if (P.solo[g]) return d + n >= 1 ? 0 : 1;
    return Math.max(0, P.reqDay[g] - d) + Math.max(0, P.reqNight[g] - n);
  }

  private canAdd(g: number, k: Kind): boolean {
    const P = this.P;
    if (P.locked[g]) return false;
    if (P.solo[g]) return k === P.solo[g] && this.cntDay[g] + this.cntNight[g] < 1;
    return k === DAY ? this.cntDay[g] < P.reqDay[g] : this.cntNight[g] < P.reqNight[g];
  }

  private eligible(w: number, g: number, k: Kind): boolean {
    const wm = this.P.workers[w];
    return wm.fixed[g] < 0 && wm.avail[g] > 0 && (k === DAY ? wm.canDay : wm.canNight);
  }

  // Full pass over one worker's month: rule breaks + fairness cost terms.
  private evalWorker(wi: number): void {
    const P = this.P;
    const w = P.workers[wi];
    const a = this.asg[wi];
    const { G, maxConsecutive: maxC, minRest, blockMode, weights: Wt } = P;
    const wk = this.weekBuf;
    wk.fill(0);
    let prev: number = w.histKind;
    let run = w.histRun;
    let lastWork = w.histLastWork;
    let viol = 0, shifts = 0, hours = 0, prem = 0, day = 0, pad = 0;
    let singles = 0, prefOff = 0, prefKindMiss = 0;
    for (let g = 0; g < G; g++) {
      const k = a[g];
      if (k) {
        const av = w.avail[g];
        if (av === 0) viol++;
        if (k === DAY ? !w.canDay : !w.canNight) viol++;
        if (prev === NIGHT && (k === DAY || P.solo[g])) viol++;
        if (prev) {
          if (blockMode && prev !== k) viol++;
          run++;
        } else {
          if (lastWork > NEVER && g - lastWork - 1 < minRest) viol++;
          run = 1;
          if (g + 1 < G && !a[g + 1]) singles++;
        }
        if (run > maxC) viol++;
        lastWork = g;
        if (av === 2) prefOff++;
        if (w.prefKind && k !== w.prefKind) prefKindMiss++;
        if (P.inMonth[g]) {
          shifts++;
          hours += P.hours[g];
          if (P.premium[g]) prem++;
          if (k === DAY) day++;
          wk[P.week[g]]++;
        } else {
          pad++;
        }
      } else {
        run = 0;
      }
      prev = k;
    }
    if (shifts > w.cap) viol += shifts - w.cap;

    let c = 0;
    const dl = shifts - w.target;
    c += Wt.load * dl * dl;
    const dh = (hours - w.hoursTarget) / P.avgShiftHours;
    c += Wt.hours * dh * dh;
    const dp = pad - w.padTarget;
    c += Wt.pad * dp * dp;
    const dw = prem - w.weekendTarget;
    c += Wt.weekend * dw * dw;
    if (w.workDays > 0 && shifts > 0) {
      let s = 0;
      for (let i = 0; i < P.weeks; i++) {
        const d = wk[i] - shifts * w.weekAvail[i] / w.workDays;
        s += d * d;
      }
      c += Wt.spread * s;
    }
    c += Wt.single * singles + Wt.prefOff * prefOff + Wt.prefKind * prefKindMiss;

    const ev = this.ev;
    ev.viol = viol;
    ev.cost = c;
    ev.shifts = shifts;
    ev.days = day;
    ev.prem = prem;
  }

  // Day/night balance among "Either" workers: everyone's share of day
  // shifts should match the group's (last month's imbalance included).
  private computeMix(): number {
    const P = this.P;
    let sd = 0, ss = 0;
    for (let w = 0; w < P.W; w++) {
      const wm = P.workers[w];
      if (!wm.mixGroup) continue;
      sd += this.days[w] + wm.carryDay;
      ss += this.shifts[w];
    }
    if (ss === 0) return 0;
    const f = sd / ss;
    let c = 0;
    for (let w = 0; w < P.W; w++) {
      const wm = P.workers[w];
      if (!wm.mixGroup) continue;
      const d = this.days[w] + wm.carryDay - f * this.shifts[w];
      c += d * d;
    }
    return P.weights.mix * c;
  }

  recomputeAll(): void {
    const P = this.P;
    let localSum = 0;
    for (let w = 0; w < P.W; w++) {
      this.evalWorker(w);
      this.viol[w] = this.ev.viol;
      this.local[w] = this.ev.cost;
      this.shifts[w] = this.ev.shifts;
      this.days[w] = this.ev.days;
      this.prem[w] = this.ev.prem;
      localSum += this.ev.cost;
    }
    this.missing = 0;
    this.missingCost = 0;
    for (let g = 0; g < P.G; g++) {
      const m = this.missingAt(g);
      this.missing += m;
      this.missingCost += m * P.emptyWeight[g];
    }
    this.mix = this.computeMix();
    this.cost = localSum + this.mix + this.missingCost;
  }

  // ---------- Move mechanics ----------

  private untrack(g: number): void {
    const m = this.missingAt(g);
    this.missing -= m;
    this.missingCost -= m * this.P.emptyWeight[g];
  }

  private track(g: number): void {
    const m = this.missingAt(g);
    this.missing += m;
    this.missingCost += m * this.P.emptyWeight[g];
  }

  private set(w: number, g: number, k: Kind): void {
    const a = this.asg[w];
    const old = a[g];
    if (old === k) return;
    this.uW.push(w);
    this.uG.push(g);
    this.uK.push(old);
    this.untrack(g);
    if (old === DAY) this.cntDay[g]--; else if (old === NIGHT) this.cntNight[g]--;
    if (k === DAY) this.cntDay[g]++; else if (k === NIGHT) this.cntNight[g]++;
    a[g] = k;
    this.track(g);
  }

  private revertCells(): void {
    for (let i = this.uW.length - 1; i >= 0; i--) {
      const w = this.uW[i], g = this.uG[i], k = this.uK[i] as Kind;
      const a = this.asg[w];
      const cur = a[g];
      this.untrack(g);
      if (cur === DAY) this.cntDay[g]--; else if (cur === NIGHT) this.cntNight[g]--;
      if (k === DAY) this.cntDay[g]++; else if (k === NIGHT) this.cntNight[g]++;
      a[g] = k;
      this.track(g);
    }
    this.uW.length = 0;
    this.uG.length = 0;
    this.uK.length = 0;
  }

  private beginMove(): void {
    this.uW.length = 0;
    this.uG.length = 0;
    this.uK.length = 0;
    this.oldMissing = this.missing;
    this.oldMissingCost = this.missingCost;
    this.oldMix = this.mix;
  }

  // Evaluates the pending move. Returns the cost change, or NaN when the move
  // adds a rule break (the move is then already rolled back).
  private evaluate(): number {
    const aff = this.affected;
    aff.length = 0;
    for (let i = 0; i < this.uW.length; i++) if (!aff.includes(this.uW[i])) aff.push(this.uW[i]);
    this.oldViol.length = this.oldLocal.length = this.oldShifts.length = this.oldDays.length = this.oldPrem.length = 0;
    let delta = 0;
    let broke = false;
    for (let i = 0; i < aff.length; i++) {
      const w = aff[i];
      this.oldViol.push(this.viol[w]);
      this.oldLocal.push(this.local[w]);
      this.oldShifts.push(this.shifts[w]);
      this.oldDays.push(this.days[w]);
      this.oldPrem.push(this.prem[w]);
      this.evalWorker(w);
      if (this.ev.viol > this.viol[w]) broke = true;
      delta += this.ev.cost - this.local[w];
      this.viol[w] = this.ev.viol;
      this.local[w] = this.ev.cost;
      this.shifts[w] = this.ev.shifts;
      this.days[w] = this.ev.days;
      this.prem[w] = this.ev.prem;
    }
    if (broke) {
      this.rollback();
      return NaN;
    }
    this.mix = this.computeMix();
    delta += this.mix - this.oldMix;
    delta += this.missingCost - this.oldMissingCost;
    this.cost += delta;
    return delta;
  }

  private rollback(): void {
    const aff = this.affected;
    for (let i = 0; i < aff.length && i < this.oldViol.length; i++) {
      const w = aff[i];
      this.viol[w] = this.oldViol[i];
      this.local[w] = this.oldLocal[i];
      this.shifts[w] = this.oldShifts[i];
      this.days[w] = this.oldDays[i];
      this.prem[w] = this.oldPrem[i];
    }
    this.revertCells();
    this.mix = this.oldMix;
    this.missing = this.oldMissing;
    this.missingCost = this.oldMissingCost;
  }

  // Undo an evaluated (valid) move and restore the running cost
  private reject(delta: number): void {
    this.cost -= delta;
    this.rollback();
  }

  private commit(): void {
    this.uW.length = 0;
    this.uG.length = 0;
    this.uK.length = 0;
  }

  // ---------- Construction ----------

  private greedyScore(w: number, g: number, k: Kind): number {
    const P = this.P;
    const wm = P.workers[w];
    const a = this.asg[w];
    const inMonth = P.inMonth[g] === 1;
    let s = 0;
    if (wm.workDays > 0) {
      const progress = this.availPassed[w][g] / wm.workDays;
      s += (this.shifts[w] + (inMonth ? 1 : 0)) - wm.target * progress;
    } else {
      s += this.shifts[w];
    }
    if (P.premium[g] && inMonth && wm.premWorkDays > 0) {
      const pp = this.premPassed[w][g] / wm.premWorkDays;
      s += 0.7 * ((this.prem[w] + 1) - wm.weekendTarget * pp);
    }
    if (wm.mixGroup && inMonth) {
      const f = this.mixDayFraction;
      const total = this.shifts[w] + 1;
      s += 0.4 * (k === DAY ? (this.days[w] + 1 - f * total) : (this.shifts[w] - this.days[w] + 1 - (1 - f) * total));
    }
    const prev = g > 0 ? a[g - 1] : wm.histKind;
    if (prev === k) s -= 0.5;
    if (wm.avail[g] === 2) s += 1.5;
    if (wm.prefKind && k !== wm.prefKind) s += 1;
    s += this.rng() * 0.6;
    return s;
  }

  construct(): void {
    const P = this.P;
    const { W, G } = P;
    const order = Array.from({ length: W }, (_, i) => i);
    for (let g = 0; g < G; g++) {
      if (P.locked[g]) continue;
      for (let guard = 0; guard < 50 && this.missingAt(g) > 0; guard++) {
        // Fill the scarcer shift type first
        let k: Kind;
        if (P.solo[g]) {
          k = P.solo[g] as Kind;
        } else {
          const needD = this.cntDay[g] < P.reqDay[g];
          const needN = this.cntNight[g] < P.reqNight[g];
          if (needD && needN) {
            let poolD = 0, poolN = 0;
            for (let w = 0; w < W; w++) {
              if (this.asg[w][g]) continue;
              if (this.eligible(w, g, DAY)) poolD++;
              if (this.eligible(w, g, NIGHT)) poolN++;
            }
            k = poolD / Math.max(1, P.reqDay[g] - this.cntDay[g]) <= poolN / Math.max(1, P.reqNight[g] - this.cntNight[g]) ? DAY : NIGHT;
          } else {
            k = needD ? DAY : NIGHT;
          }
        }
        let bestW = -1;
        let bestScore = Infinity;
        for (const w of order) {
          if (this.asg[w][g] || !this.eligible(w, g, k)) continue;
          this.beginMove();
          this.set(w, g, k);
          const d = this.evaluate();
          if (Number.isNaN(d)) continue;
          this.reject(d);
          const score = this.greedyScore(w, g, k);
          if (score < bestScore) {
            bestScore = score;
            bestW = w;
          }
        }
        if (bestW < 0) {
          // Nobody can legally take this type today; try the other type once
          if (!P.solo[g]) {
            const other: Kind = k === DAY ? NIGHT : DAY;
            const stillNeed = other === DAY ? this.cntDay[g] < P.reqDay[g] : this.cntNight[g] < P.reqNight[g];
            if (stillNeed && this.fillOne(g, other)) continue;
          }
          break;
        }
        this.beginMove();
        this.set(bestW, g, k);
        this.evaluate();
        this.commit();
      }
    }
    // Repair slots the greedy pass could not fill
    for (let attempt = 0; attempt < 40 * P.G && this.missing > 0; attempt++) {
      if (!this.moveFill()) this.moveEjectFill();
    }
    this.snapshotBest();
  }

  private fillOne(g: number, k: Kind): boolean {
    const P = this.P;
    let bestW = -1;
    let bestScore = Infinity;
    for (let w = 0; w < P.W; w++) {
      if (this.asg[w][g] || !this.eligible(w, g, k)) continue;
      this.beginMove();
      this.set(w, g, k);
      const d = this.evaluate();
      if (Number.isNaN(d)) continue;
      this.reject(d);
      const score = this.greedyScore(w, g, k);
      if (score < bestScore) {
        bestScore = score;
        bestW = w;
      }
    }
    if (bestW < 0) return false;
    this.beginMove();
    this.set(bestW, g, k);
    this.evaluate();
    this.commit();
    return true;
  }

  // ---------- Local search ----------

  private snapshotBest(): void {
    this.bestCost = this.cost;
    for (let w = 0; w < this.P.W; w++) this.best[w].set(this.asg[w]);
  }

  // Extend [g, g] to the maximal run where `test(d)` holds, then pick a
  // random sub-run that still contains g.
  private pickRun(g: number, test: (d: number) => boolean, wantRun: boolean): [number, number] {
    if (!wantRun) return [g, g];
    let s = g, e = g;
    while (s - 1 >= 0 && test(s - 1)) s--;
    while (e + 1 < this.P.G && test(e + 1)) e++;
    const s2 = s + randInt(this.rng, g - s + 1);
    const e2 = g + randInt(this.rng, e - g + 1);
    return [s2, e2];
  }

  // Fill an empty slot with someone who can legally take it
  private moveFill(): boolean {
    const P = this.P;
    const slot = this.emptySlot();
    if (!slot) return false;
    const [g, k] = slot;
    const ws = randInt(this.rng, P.W);
    for (let j = 0; j < P.W; j++) {
      const w = (ws + j) % P.W;
      if (this.asg[w][g] || !this.eligible(w, g, k)) continue;
      this.beginMove();
      this.set(w, g, k);
      const d = this.evaluate();
      if (Number.isNaN(d)) continue;
      // Filling a slot is always worth it
      this.commit();
      return true;
    }
    return false;
  }

  private emptySlot(): [number, Kind] | null {
    const P = this.P;
    const start = randInt(this.rng, P.G);
    for (let i = 0; i < P.G; i++) {
      const g = (start + i) % P.G;
      if (this.missingAt(g) <= 0) continue;
      if (P.solo[g]) return [g, P.solo[g] as Kind];
      const needD = this.canAdd(g, DAY);
      const needN = this.canAdd(g, NIGHT);
      if (!needD && !needN) continue;
      return [g, needD && needN ? (this.rng() < 0.5 ? DAY : NIGHT) : needD ? DAY : NIGHT];
    }
    return null;
  }

  // Fill an empty slot with a worker who is blocked only by one of their own
  // nearby shifts (or their monthly cap): that shift is handed to someone
  // else first. Bounded effort, since some slots are genuinely unfillable.
  moveEjectFill(): boolean {
    const P = this.P;
    const slot = this.emptySlot();
    if (!slot) return false;
    const [g, k] = slot;
    const reach = P.maxConsecutive + P.minRest + 1;
    const ws = randInt(this.rng, P.W);
    let triedWorkers = 0;
    for (let j = 0; j < P.W && triedWorkers < 3; j++) {
      const w = (ws + j) % P.W;
      if (this.asg[w][g] || !this.eligible(w, g, k)) continue;
      triedWorkers++;
      const a = this.asg[w];
      const atCap = this.shifts[w] >= P.workers[w].cap;
      const cands: number[] = [];
      const lo = atCap ? 0 : Math.max(0, g - reach);
      const hi = atCap ? P.G - 1 : Math.min(P.G - 1, g + reach);
      for (let d = lo; d <= hi; d++) if (a[d] && P.workers[w].fixed[d] < 0) cands.push(d);
      for (let c = 0; c < 3 && cands.length > 0; c++) {
        const d = cands.splice(randInt(this.rng, cands.length), 1)[0];
        const kd = a[d] as Kind;
        const rs = randInt(this.rng, P.W);
        let triedReceivers = 0;
        for (let i = 0; i < P.W && triedReceivers < 4; i++) {
          const r = (rs + i) % P.W;
          if (r === w || this.asg[r][d] || !this.eligible(r, d, kd)) continue;
          triedReceivers++;
          this.beginMove();
          this.set(w, d, OFF);
          this.set(r, d, kd);
          this.set(w, g, k);
          const delta = this.evaluate();
          if (Number.isNaN(delta)) continue;
          this.commit();
          return true;
        }
      }
    }
    return false;
  }

  // Move a worker from one of their shifts into an empty slot. Coverage
  // stays the same but the gap moves, which lets other moves close it.
  private proposeRelocate(): boolean {
    const P = this.P;
    const slot = this.emptySlot();
    if (!slot) return false;
    const [g, k] = slot;
    const ws = randInt(this.rng, P.W);
    for (let j = 0; j < P.W; j++) {
      const w = (ws + j) % P.W;
      if (this.asg[w][g] || !this.eligible(w, g, k)) continue;
      const a = this.asg[w];
      // pick one of w's movable shifts, preferring nearby days
      let d = -1;
      for (let t = 0; t < 8; t++) {
        const c = this.rng() < 0.6 ? g + randInt(this.rng, 15) - 7 : randInt(this.rng, P.G);
        if (c >= 0 && c < P.G && c !== g && a[c] && P.workers[w].fixed[c] < 0) { d = c; break; }
      }
      if (d < 0) continue;
      this.beginMove();
      this.set(w, d, OFF);
      this.set(w, g, k);
      return true;
    }
    return false;
  }

  // Remove an isolated single day: give it to a neighbour who works the
  // same shift type the day before/after, or trade it for a day that
  // extends one of this worker's own runs.
  private proposeConsolidate(): boolean {
    const P = this.P;
    const w1 = randInt(this.rng, P.W);
    const a1 = this.asg[w1];
    // find a single day of w1, scanning from a random start
    const start = randInt(this.rng, P.G);
    let g = -1;
    for (let i = 0; i < P.G; i++) {
      const d = (start + i) % P.G;
      if (!a1[d] || P.workers[w1].fixed[d] >= 0) continue;
      const prev = d > 0 ? a1[d - 1] : P.workers[w1].histKind;
      const next = d + 1 < P.G ? a1[d + 1] : 1;
      if (!prev && !next) { g = d; break; }
    }
    if (g < 0) return false;
    const k = a1[g] as Kind;
    if (this.rng() < 0.5) {
      // (a) hand it to someone whose run touches this day
      const rs = randInt(this.rng, P.W);
      for (let i = 0; i < P.W; i++) {
        const w2 = (rs + i) % P.W;
        if (w2 === w1) continue;
        const a2 = this.asg[w2];
        if (a2[g] || !this.eligible(w2, g, k)) continue;
        if ((g > 0 && a2[g - 1] === k) || (g + 1 < P.G && a2[g + 1] === k)) {
          this.beginMove();
          this.set(w1, g, OFF);
          this.set(w2, g, k);
          return true;
        }
      }
      return false;
    }
    // (b) trade it for a day next to one of w1's runs
    const edges: number[] = [];
    for (let d = 0; d < P.G; d++) {
      if (a1[d] || d === g) continue;
      const touches = (d > 0 && a1[d - 1] && d - 1 !== g) || (d + 1 < P.G && a1[d + 1] && d + 1 !== g);
      if (touches) edges.push(d);
    }
    if (edges.length === 0) return false;
    const g2 = edges[randInt(this.rng, edges.length)];
    const rs = randInt(this.rng, P.W);
    for (let i = 0; i < P.W; i++) {
      const w2 = (rs + i) % P.W;
      if (w2 === w1) continue;
      const a2 = this.asg[w2];
      const k2 = a2[g2] as Kind;
      if (!k2 || P.workers[w2].fixed[g2] >= 0) continue;
      if (a2[g] || !this.eligible(w2, g, k) || !this.eligible(w1, g2, k2)) continue;
      this.beginMove();
      this.set(w1, g, OFF);
      this.set(w2, g2, OFF);
      this.set(w1, g2, k2);
      this.set(w2, g, k);
      return true;
    }
    return false;
  }

  // Hand one shift, or a run of shifts, from one worker to another
  private proposeTransfer(): boolean {
    const P = this.P;
    const w1 = randInt(this.rng, P.W);
    const g = randInt(this.rng, P.G);
    const a1 = this.asg[w1];
    const k = a1[g] as Kind;
    if (!k || P.workers[w1].fixed[g] >= 0) return false;
    const [s, e] = this.pickRun(g, d => a1[d] === k && P.workers[w1].fixed[d] < 0, this.rng() < 0.5);
    const w2 = randInt(this.rng, P.W);
    if (w2 === w1) return false;
    const a2 = this.asg[w2];
    for (let d = s; d <= e; d++) if (a2[d] || !this.eligible(w2, d, k)) return false;
    this.beginMove();
    for (let d = s; d <= e; d++) {
      this.set(w1, d, OFF);
      this.set(w2, d, k);
    }
    return true;
  }

  // Two workers exchange days (or runs of days)
  private proposeSwap(): boolean {
    const P = this.P;
    const w1 = randInt(this.rng, P.W);
    const g1 = randInt(this.rng, P.G);
    const a1 = this.asg[w1];
    const k1 = a1[g1] as Kind;
    if (!k1 || P.workers[w1].fixed[g1] >= 0) return false;
    const w2 = randInt(this.rng, P.W);
    if (w2 === w1) return false;
    const a2 = this.asg[w2];
    // Prefer nearby days half of the time
    let g2: number;
    if (this.rng() < 0.5) {
      g2 = g1 + randInt(this.rng, 15) - 7;
      if (g2 < 0 || g2 >= P.G) return false;
    } else {
      g2 = randInt(this.rng, P.G);
    }
    const k2 = a2[g2] as Kind;
    if (!k2 || g2 === g1 || P.workers[w2].fixed[g2] >= 0) return false;
    const wantRun = this.rng() < 0.4;
    const [s1, e1] = this.pickRun(g1, d => a1[d] === k1 && P.workers[w1].fixed[d] < 0, wantRun);
    const [s2, e2] = this.pickRun(g2, d => a2[d] === k2 && P.workers[w2].fixed[d] < 0, wantRun);
    if (!(e1 < s2 || e2 < s1)) return false; // runs overlap
    for (let d = s1; d <= e1; d++) if (a2[d] || !this.eligible(w2, d, k1)) return false;
    for (let d = s2; d <= e2; d++) if (a1[d] || !this.eligible(w1, d, k2)) return false;
    this.beginMove();
    for (let d = s1; d <= e1; d++) { this.set(w1, d, OFF); this.set(w2, d, k1); }
    for (let d = s2; d <= e2; d++) { this.set(w2, d, OFF); this.set(w1, d, k2); }
    return true;
  }

  // A day worker and a night worker trade shift types (for a day or a run)
  private proposeKindSwap(): boolean {
    const P = this.P;
    const g = randInt(this.rng, P.G);
    if (P.solo[g] || P.locked[g]) return false;
    let w1 = -1, w2 = -1;
    const start = randInt(this.rng, P.W);
    for (let j = 0; j < P.W; j++) {
      const w = (start + j) % P.W;
      if (P.workers[w].fixed[g] >= 0) continue;
      if (w1 < 0 && this.asg[w][g] === DAY) w1 = w;
      else if (w2 < 0 && this.asg[w][g] === NIGHT) w2 = w;
    }
    if (w1 < 0 || w2 < 0) return false;
    const a1 = this.asg[w1], a2 = this.asg[w2];
    const [s, e] = this.pickRun(
      g,
      d => !P.solo[d] && a1[d] === DAY && a2[d] === NIGHT && P.workers[w1].fixed[d] < 0 && P.workers[w2].fixed[d] < 0,
      this.rng() < 0.6
    );
    for (let d = s; d <= e; d++) if (!P.workers[w1].canNight || !P.workers[w2].canDay) return false;
    this.beginMove();
    for (let d = s; d <= e; d++) { this.set(w1, d, NIGHT); this.set(w2, d, DAY); }
    return true;
  }

  anneal(opts: SolveOptions): void {
    const { iterations, startTemp, endTemp } = opts;
    const ratio = endTemp / startTemp;
    // Move mix (relative weights)
    const pFill = 0.1;
    const pEject = 0.02;
    const pTransfer = 0.3;
    const pSwap = 0.3;
    const pKind = 0.15;
    const pConsolidate = 0.25;
    const pRelocate = 0.1;
    for (let it = 0; it < iterations; it++) {
      if (this.missing > 0) {
        const r0 = this.rng();
        if (r0 < pFill + pEject) {
          const filled = r0 < pFill ? this.moveFill() : this.moveEjectFill();
          if (filled && this.cost < this.bestCost - 1e-9) this.snapshotBest();
          continue;
        }
      }
      const temp = startTemp * Math.pow(ratio, it / iterations);
      const moveTotal = pTransfer + pSwap + pKind + pConsolidate + (this.missing > 0 ? pRelocate : 0);
      const r = this.rng() * moveTotal;
      const proposed = r < pTransfer ? this.proposeTransfer()
        : r < pTransfer + pSwap ? this.proposeSwap()
        : r < pTransfer + pSwap + pKind ? this.proposeKindSwap()
        : r < pTransfer + pSwap + pKind + pConsolidate ? this.proposeConsolidate()
        : this.proposeRelocate();
      if (!proposed) continue;
      const delta = this.evaluate();
      if (Number.isNaN(delta)) continue;
      if (delta <= 0 || this.rng() < Math.exp(-delta / temp)) {
        this.commit();
        if (this.cost < this.bestCost - 1e-9) this.snapshotBest();
      } else {
        this.reject(delta);
      }
    }
  }

  // Load the best schedule found back into the working state
  restoreBest(): void {
    const P = this.P;
    for (let w = 0; w < P.W; w++) this.asg[w].set(this.best[w]);
    this.cntDay.set(P.ghostDay);
    this.cntNight.set(P.ghostNight);
    for (let g = 0; g < P.G; g++) {
      for (let w = 0; w < P.W; w++) {
        if (this.asg[w][g] === DAY) this.cntDay[g]++;
        else if (this.asg[w][g] === NIGHT) this.cntNight[g]++;
      }
    }
    this.recomputeAll();
  }
}
