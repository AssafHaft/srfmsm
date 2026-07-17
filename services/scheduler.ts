
import { 
  Employee, 
  ShiftConfig, 
  DailySchedule, 
  ShiftType, 
  WorkerPreference, 
  EmployeeStats,
  ScheduleVersion,
  HistoricalContext,
  ManualHistoryInput
} from '../types';

// Helper to format date as YYYY-MM-DD
export const formatDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Parse YYYY-MM-DD as a LOCAL date. new Date('YYYY-MM-DD') parses as UTC,
// which can shift the day-of-week in negative-offset timezones.
export const parseDateKey = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const parseTime = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h + m / 60;
};

// Total operational hours for a given weekday under this config
export const getOperationalWindow = (config: ShiftConfig, dayOfWeek: number): number => {
  const timing = config.dailyTimings[dayOfWeek] || { startTime: '07:00', endTime: '22:00' };
  const start = parseTime(timing.startTime);
  let end = parseTime(timing.endTime);
  if (end < start) end += 24; // Handle overnight wrapping
  return end - start;
};

// Get the full grid range: Sunday before 1st to Saturday after last
export const getFullWeeksRange = (year: number, month: number): Date[] => {
  const days: Date[] = [];
  
  // 1. Find the 1st of the month
  const startOfMonth = new Date(year, month, 1);
  const startDayOfWeek = startOfMonth.getDay(); // 0 (Sun) - 6 (Sat)
  
  // 2. Backtrack to previous Sunday
  const startDate = new Date(startOfMonth);
  startDate.setDate(startDate.getDate() - startDayOfWeek);

  // 3. Find the last day of the month
  const endOfMonth = new Date(year, month + 1, 0);
  const endDayOfWeek = endOfMonth.getDay();

  // 4. Forward to next Saturday
  const endDate = new Date(endOfMonth);
  endDate.setDate(endDate.getDate() + (6 - endDayOfWeek));

  // 5. Generate loop
  const current = new Date(startDate);
  while (current <= endDate) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  return days;
};

// Helper for generic month days
export const getDaysInMonth = (year: number, month: number): Date[] => {
  const date = new Date(year, month, 1);
  const days: Date[] = [];
  while (date.getMonth() === month) {
    days.push(new Date(date));
    date.setDate(date.getDate() + 1);
  }
  return days;
};

// --- Payroll Calculation ---
export interface PayrollData {
  regularHours: number;
  overtime125: number;
  overtime150: number;
  totalHours: number;
  estimatedPay: number;
}

export const calculatePayroll = (
  version: ScheduleVersion, 
  employees: Employee[], 
  currentConfig: ShiftConfig // Fallback if snapshot missing
): Record<string, PayrollData> => {
  const result: Record<string, PayrollData> = {};
  const rateById = new Map(employees.map(e => [e.id, e.hourlyRate || 0]));

  // Initialize
  employees.forEach(e => {
    result[e.id] = { regularHours: 0, overtime125: 0, overtime150: 0, totalHours: 0, estimatedPay: 0 };
  });

  const configToUse = version.configSnapshot || currentConfig;

  version.schedule.forEach(day => {
    if (day.isPadding) return; // Don't pay for padding days (belong to other months)

    const dateObj = parseDateKey(day.date);
    const dayOfWeek = dateObj.getDay();
    const operationWindow = getOperationalWindow(configToUse, dayOfWeek);
    
    // Determine Shift Length Logic
    let shiftDuration = 0;

    if (day.dayShift.length > 0 && day.nightShift.length > 0) {
      // Both shifts have workers: Split Shift: (TotalWindow + 1hr Overlap) / 2
      shiftDuration = (operationWindow + 1) / 2;
    } else {
      // Only one shift has workers (or none): Workers work the WHOLE day
      shiftDuration = operationWindow;
    }

    // Calculate Tiers for this specific day
    const reg = Math.min(shiftDuration, 8);
    const remAfterReg = Math.max(0, shiftDuration - 8);
    const ot125 = Math.min(remAfterReg, 2); // Hours 8 to 10
    const ot150 = Math.max(0, remAfterReg - 2); // Hours 10+

    // Apply to workers working today
    const workersToday = new Set([...day.dayShift, ...day.nightShift]);
    workersToday.forEach(empId => {
      if (result[empId]) {
        result[empId].regularHours += reg;
        result[empId].overtime125 += ot125;
        result[empId].overtime150 += ot150;
        result[empId].totalHours += shiftDuration;
        
        const rate = rateById.get(empId) || 0;
        result[empId].estimatedPay += (reg * rate) + (ot125 * rate * 1.25) + (ot150 * rate * 1.5);
      }
    });
  });

  return result;
};


// --- Parsing History CSV ---
export const parsePastScheduleCSV = async (file: File, employees: Employee[]): Promise<HistoricalContext> => {
  const text = await file.text();
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  
  if (lines.length < 2) throw new Error("Invalid CSV format");

  const headerLine = lines[0].replace(/^\uFEFF/, '');
  const headers = headerLine.split(',');
  
  const dayCols: number[] = [];
  const nightCols: number[] = [];

  headers.forEach((h, idx) => {
    const lower = h.toLowerCase().replace(/"/g, '');
    if (lower.includes('day shift worker') || lower.includes('day worker')) dayCols.push(idx);
    if (lower.includes('night shift worker') || lower.includes('night worker')) nightCols.push(idx);
  });

  const accumulatedStats: Record<string, { day: number, night: number, total: number }> = {};
  const consecutiveDays: Record<string, number> = {};
  let lastDayNightShiftIds: string[] = [];

  employees.forEach(e => {
    accumulatedStats[e.id] = { day: 0, night: 0, total: 0 };
    consecutiveDays[e.id] = 0;
  });

  const findId = (nameRaw: string): string | undefined => {
    const name = nameRaw.replace(/"/g, '').trim();
    if (!name) return undefined;
    return employees.find(e => e.name.toLowerCase() === name.toLowerCase())?.id;
  };

  for (let i = 1; i < lines.length; i++) {
    // Robust CSV split ignoring commas inside quotes
    const cells = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    const cleanCells = cells.map(c => c.replace(/^"|"$/g, '').trim());

    const workedTodayIds: string[] = [];
    const nightTodayIds: string[] = [];

    dayCols.forEach(colIdx => {
      if (colIdx < cleanCells.length) {
        const id = findId(cleanCells[colIdx]);
        if (id) {
          accumulatedStats[id].day++;
          accumulatedStats[id].total++;
          workedTodayIds.push(id);
        }
      }
    });

    nightCols.forEach(colIdx => {
      if (colIdx < cleanCells.length) {
        const id = findId(cleanCells[colIdx]);
        if (id) {
          accumulatedStats[id].night++;
          accumulatedStats[id].total++;
          workedTodayIds.push(id);
          nightTodayIds.push(id);
        }
      }
    });

    employees.forEach(e => {
      if (workedTodayIds.includes(e.id)) {
        consecutiveDays[e.id] = (consecutiveDays[e.id] || 0) + 1;
      } else {
        consecutiveDays[e.id] = 0;
      }
    });

    if (i === lines.length - 1) {
      lastDayNightShiftIds = nightTodayIds;
    }
  }

  return {
    sourceName: file.name,
    accumulatedStats,
    consecutiveDaysEnding: consecutiveDays,
    lastDayNightShiftIds
  };
};

// --- Core Generation Function ---
export const generateSchedule = (
  employees: Employee[],
  year: number,
  month: number,
  config: ShiftConfig,
  history?: HistoricalContext,
  manualHistory?: ManualHistoryInput,
  lockedEntries?: ManualHistoryInput // Days pinned by the user; kept verbatim and marked locked
): ScheduleVersion => {
  const days = getFullWeeksRange(year, month);
  const monthDays = getDaysInMonth(year, month);
  const schedule: DailySchedule[] = [];

  // Premium (weekend) days: more desirable shifts that must be spread evenly
  const premiumDays = new Set(config.premiumDays ?? [5, 6]);

  // Management-configurable work-pattern rules. Health/rest limits are HARD
  // constraints (enforced in candidate filtering); block consistency shapes
  // the soft preference order.
  const rules: WorkPatternRules = {
    maxConsecutive: Math.max(1, config.maxConsecutiveDays ?? 5),
    minRest: Math.max(1, config.minRestDays ?? 1),
    shiftCap: config.maxShiftsPerMonth || 0,
    blockMode: config.blockScheduling ?? true,
  };

  const workHistory = new Map<string, Set<string>>();
  const lastShiftType = new Map<string, ShiftType | null>();
  const consecutiveDays = new Map<string, number>();
  const stats = new Map<string, EmpRunningStats>();

  // availability tracking for fair pacing
  const totalWorkableDaysInMonth = new Map<string, number>();
  const workableDaysPassed = new Map<string, number>();

  // Shift type of each worker's most recent block (persists through rest days)
  // — used to rotate people to the opposite type when they start a new block.
  const prevBlockType = new Map<string, ShiftType | null>();
  // Grid index of the last day each worker worked — used to enforce the
  // minimum rest between blocks. Seeded far in the past.
  const lastWorkedDayIndex = new Map<string, number>();

  // Carry-over day/night imbalance from imported history: someone who worked
  // mostly nights last month should lean toward days this month (clamped so
  // one month can't dominate the next forever).
  const historyBias = new Map<string, number>();

  // Initialize
  employees.forEach(e => {
    workHistory.set(e.id, new Set());
    stats.set(e.id, { day: 0, night: 0, total: 0, hours: 0, premium: 0 });
    consecutiveDays.set(e.id, history ? (history.consecutiveDaysEnding[e.id] || 0) : 0);
    lastShiftType.set(e.id, null);
    workableDaysPassed.set(e.id, 0);
    prevBlockType.set(e.id, null);
    lastWorkedDayIndex.set(e.id, -999);

    const hist = history?.accumulatedStats[e.id];
    historyBias.set(e.id, hist ? Math.max(-2, Math.min(2, hist.day - hist.night)) : 0);

    // Imported CSV history: a worker mid-streak at the boundary is treated as
    // continuing (grid day 0 sees them as having worked "yesterday").
    if (history && (history.consecutiveDaysEnding[e.id] || 0) > 0) {
      const boundaryType = history.lastDayNightShiftIds.includes(e.id) ? ShiftType.NIGHT : ShiftType.DAY;
      lastShiftType.set(e.id, boundaryType);
      prevBlockType.set(e.id, boundaryType);
      lastWorkedDayIndex.set(e.id, -1);
    }

    // Pre-calculate total workable days for this employee in the target month
    let count = 0;
    monthDays.forEach(d => {
       const dateKey = formatDateKey(d);
       const isDayOff = e.availability.daysOff.includes(d.getDay());
       const isUnavailable = e.availability.unavailableDates?.includes(dateKey);
       if (!isDayOff && !isUnavailable) count++;
    });
    totalWorkableDaysInMonth.set(e.id, count);
  });

  // --- WARMUP PHASE ---
  if (manualHistory && days.length > 0) {
    const gridStart = days[0];
    for (let i = 7; i > 0; i--) {
        const d = new Date(gridStart);
        d.setDate(d.getDate() - i);
        const dateKey = formatDateKey(d);
        const entry = manualHistory[dateKey];
        
        if (entry) {
            const todayWorkers = [...entry.dayShift, ...entry.nightShift];
            employees.forEach(e => {
                if (todayWorkers.includes(e.id)) {
                    consecutiveDays.set(e.id, (consecutiveDays.get(e.id) || 0) + 1);
                    workHistory.get(e.id)?.add(dateKey);
                    const t = entry.dayShift.includes(e.id) ? ShiftType.DAY : ShiftType.NIGHT;
                    lastShiftType.set(e.id, t);
                    prevBlockType.set(e.id, t);
                    lastWorkedDayIndex.set(e.id, -i);
                } else {
                    consecutiveDays.set(e.id, 0);
                    lastShiftType.set(e.id, null);
                }
            });
        }
    }
  }

  // --- MAIN GRID GENERATION ---
  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    const dayDate = days[dayIndex];
    const dateKey = formatDateKey(dayDate);
    const dayOfWeek = dayDate.getDay();
    const isTargetMonth = dayDate.getMonth() === month && dayDate.getFullYear() === year;
    const isPadding = !isTargetMonth;

    // Track how many workable days have passed for each employee
    if (isTargetMonth) {
        employees.forEach(e => {
            const isDayOff = e.availability.daysOff.includes(dayOfWeek);
            const isUnavailable = e.availability.unavailableDates?.includes(dateKey);
            if (!isDayOff && !isUnavailable) {
                workableDaysPassed.set(e.id, (workableDaysPassed.get(e.id) || 0) + 1);
            }
        });
    }

    const reqs = config.requirements[dayOfWeek] || { day: 1, night: 1 };
    // Locked days take precedence: kept exactly as the user pinned them,
    // but still feed constraint/fairness tracking below.
    const lockedEntry = lockedEntries?.[dateKey];
    const manualEntry = lockedEntry || (manualHistory ? manualHistory[dateKey] : undefined);

    let dayWorkers: string[] = [];
    let nightWorkers: string[] = [];

    if (manualEntry) {
      dayWorkers = manualEntry.dayShift;
      nightWorkers = manualEntry.nightShift;
    } else {
      const env: SelectionEnv = {
        workableDaysPassed, totalWorkableDaysInMonth, workHistory, lastShiftType,
        prevBlockType, consecutiveDays, lastWorkedDayIndex, stats, historyBias,
        premiumDays, rules
      };

      // Special Case: Total Req = 1 (Smart Single-Resource)
      // The solo worker covers the whole operational window; the Payroll
      // calculator knows this. Keep the slot's original day/night identity so
      // Night-Only workers stay eligible for solo night requirements and the
      // calendar doesn't show a false "Empty" slot.

      const totalReq = reqs.day + reqs.night;

      if (totalReq === 1) {
          const soloType = reqs.night === 1 ? ShiftType.NIGHT : ShiftType.DAY;
          // wholeDay: a solo shift spans the full window incl. morning hours,
          // so the no-day-after-night rest rule applies whatever its type.
          const picked = pickWorkers(
            employees, 1, dayDate, dayIndex, soloType, [],
            soloType === ShiftType.DAY && !!config.distributeDayShiftsToEither,
            true, env
          );
          dayWorkers = soloType === ShiftType.DAY ? picked : [];
          nightWorkers = soloType === ShiftType.NIGHT ? picked : [];
      } else {
          dayWorkers = pickWorkers(
            employees, reqs.day, dayDate, dayIndex, ShiftType.DAY, [],
            !!config.distributeDayShiftsToEither, false, env
          );
          nightWorkers = pickWorkers(
            employees, reqs.night, dayDate, dayIndex, ShiftType.NIGHT, dayWorkers,
            false, false, env
          );
      }
    }

    // Hours actually worked today: split shifts share the window (+1h overlap),
    // a solo shift covers the whole window. Mirrors the payroll calculation.
    const operationWindow = getOperationalWindow(config, dayOfWeek);
    const shiftDuration = (dayWorkers.length > 0 && nightWorkers.length > 0)
      ? (operationWindow + 1) / 2
      : operationWindow;

    const todayWorkers = [...dayWorkers, ...nightWorkers];
    employees.forEach(e => {
      const workedToday = todayWorkers.includes(e.id);
      if (workedToday) {
        workHistory.get(e.id)?.add(dateKey);
        consecutiveDays.set(e.id, (consecutiveDays.get(e.id) || 0) + 1);
        lastWorkedDayIndex.set(e.id, dayIndex);
        const t = dayWorkers.includes(e.id) ? ShiftType.DAY : ShiftType.NIGHT;
        lastShiftType.set(e.id, t);
        prevBlockType.set(e.id, t);

        if (isTargetMonth) {
          const s = stats.get(e.id)!;
          s.total += 1;
          s.hours += shiftDuration;
          if (premiumDays.has(dayOfWeek)) s.premium += 1;
          if (dayWorkers.includes(e.id)) s.day += 1;
          else s.night += 1;
        }
      } else {
        consecutiveDays.set(e.id, 0);
        lastShiftType.set(e.id, null); 
      }
    });

    schedule.push({ date: dateKey, dayShift: dayWorkers, nightShift: nightWorkers, isPadding, locked: !!lockedEntry });
  }

  const finalStats: Record<string, EmployeeStats> = {};
  employees.forEach(e => {
    let monthDay = 0, monthNight = 0, monthTotal = 0, maxStreak = 0, currentStreak = 0;
    schedule.forEach(daySch => {
      const worked = daySch.dayShift.includes(e.id) || daySch.nightShift.includes(e.id);
      if (worked) {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
      if (!daySch.isPadding && worked) {
        monthTotal++;
        if (daySch.dayShift.includes(e.id)) monthDay++;
        else monthNight++;
      }
    });
    finalStats[e.id] = { totalShifts: monthTotal, dayShifts: monthDay, nightShifts: monthNight, longestStreak: maxStreak };
  });

  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    name: `Schedule ${new Date(year, month).toLocaleString('default', { month: 'short' })} ${year}`,
    month,
    year,
    configSnapshot: config,
    schedule,
    stats: finalStats
  };
};

// --- Selection Logic ---

type EmpRunningStats = { day: number, night: number, total: number, hours: number, premium: number };

interface WorkPatternRules {
  maxConsecutive: number; // hard cap on consecutive work days
  minRest: number;        // minimum full rest days between two work blocks
  shiftCap: number;       // hard cap on shifts per person per month (0 = off)
  blockMode: boolean;     // build & rotate continuous same-shift blocks
}

interface SelectionEnv {
  workableDaysPassed: Map<string, number>;
  totalWorkableDaysInMonth: Map<string, number>;
  workHistory: Map<string, Set<string>>;
  lastShiftType: Map<string, ShiftType | null>;
  prevBlockType: Map<string, ShiftType | null>;
  consecutiveDays: Map<string, number>;
  lastWorkedDayIndex: Map<string, number>;
  stats: Map<string, EmpRunningStats>;
  historyBias: Map<string, number>;
  premiumDays: Set<number>;
  rules: WorkPatternRules;
}

// Priority order (hard constraints filter first, then soft ranking):
//   HARD — health & limits, never traded away: availability, vacations,
//     monthly shift cap, max consecutive days, no day shift after a night
//     shift, minimum rest between blocks, and (in block mode) no shift-type
//     change inside a block.
//   SOFT — 1. personal target not yet met  2. continue an active block
//     (predictable routine)  3. target pacing  4. premium-day rotation
//     5. hours load vs own availability  6. total shifts  7. rotate fresh
//     starters to the opposite type of their previous block  8. day/night
//     mix  9. random among true ties.
function pickWorkers(
  pool: Employee[],
  count: number,
  date: Date,
  dayIndex: number,
  shiftType: ShiftType,
  excludeIds: string[],
  prioritizeEitherForDay: boolean,
  wholeDay: boolean, // solo shift covering the entire operational window
  env: SelectionEnv
): string[] {
  if (count <= 0) return [];
  const dateKey = formatDateKey(date);
  const { rules, stats, prevBlockType, historyBias, premiumDays } = env;

  const yesterday = new Date(date);
  yesterday.setDate(date.getDate() - 1);
  const yKey = formatDateKey(yesterday);

  // Workers currently mid-block (worked yesterday, compatible shift type)
  const continuing = new Set<string>();

  const candidates = pool.filter(e => {
    if (excludeIds.includes(e.id)) return false;

    // Preference
    if (shiftType === ShiftType.DAY && e.preference === WorkerPreference.NIGHT_ONLY) return false;
    if (shiftType === ShiftType.NIGHT && e.preference === WorkerPreference.DAY_ONLY) return false;

    // Weekly Availability (Days of Week)
    if (e.availability.daysOff.includes(date.getDay())) return false;

    // Specific Unavailability (Vacations/Dates)
    if (e.availability.unavailableDates?.includes(dateKey)) return false;

    // HARD (health): max consecutive work days
    if ((env.consecutiveDays.get(e.id) || 0) >= rules.maxConsecutive) return false;

    // HARD (limit): monthly shift cap
    if (rules.shiftCap > 0 && (stats.get(e.id)?.total || 0) >= rules.shiftCap) return false;

    const gap = dayIndex - (env.lastWorkedDayIndex.get(e.id) ?? -999);
    const workedYesterday = gap === 1 || !!env.workHistory.get(e.id)?.has(yKey);
    const last = env.lastShiftType.get(e.id);

    if (workedYesterday) {
      // HARD (health): never a day shift (or whole-day solo) right after a night shift
      if (last === ShiftType.NIGHT && (shiftType === ShiftType.DAY || wholeDay)) return false;
      // HARD (consistency): in block mode, no shift-type change inside a block
      if (rules.blockMode && last !== null && last !== shiftType) return false;
      continuing.add(e.id);
    } else {
      // HARD (health): finish the minimum rest before starting a new block
      if (gap > 1 && gap - 1 < rules.minRest) return false;
    }

    return true;
  });

  // Shuffle BEFORE sorting so that genuine ties are broken randomly.
  // (Array.prototype.sort is stable, so without this every tie resolves to
  // employee-list order and Generate produces the identical schedule each
  // click. Randomness must NOT live inside the comparator — an inconsistent
  // comparator yields undefined, barely-varying orderings.)
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  candidates.sort((a, b) => {
    const statsA = stats.get(a.id)!;
    const statsB = stats.get(b.id)!;
    const targetA = a.targetShifts || 0;
    const targetB = b.targetShifts || 0;

    // 1. Workers who already met their personal target go last
    const metTargetA = targetA > 0 && statsA.total >= targetA;
    const metTargetB = targetB > 0 && statsB.total >= targetB;
    if (metTargetA !== metTargetB) return metTargetA ? 1 : -1;

    // 2. Block continuation: keep an active block going rather than starting
    // someone new — an uninterrupted same-shift run is the most predictable
    // routine for the worker.
    if (rules.blockMode) {
        const contA = continuing.has(a.id) ? 0 : 1;
        const contB = continuing.has(b.id) ? 0 : 1;
        if (contA !== contB) return contA - contB;
    }

    // 3. Prorated Pacing: Compare shifts worked to available shifts opportunity
    const getPacingDiff = (empId: string, empTarget: number, currentTotal: number) => {
        const totalWorkable = env.totalWorkableDaysInMonth.get(empId) || 0;
        const passedWorkable = env.workableDaysPassed.get(empId) || 0;
        if (empTarget <= 0 || totalWorkable === 0) return 0;

        // Key logic: Expected shifts are proportional to MY actual availability
        const expected = empTarget * (passedWorkable / totalWorkable);
        return currentTotal - expected;
    };

    const diffA = getPacingDiff(a.id, targetA, statsA.total);
    const diffB = getPacingDiff(b.id, targetB, statsB.total);

    const getCategory = (diff: number, hasTarget: boolean) => {
        if (!hasTarget) return 2;
        if (diff < -0.8) return 1; // Behind
        if (diff > 0.8) return 3;  // Ahead
        return 2; // On track
    };

    const catA = getCategory(diffA, targetA > 0);
    const catB = getCategory(diffB, targetB > 0);
    if (catA !== catB) return catA - catB;

    // 4. Premium (weekend) fairness: on a premium day, prefer whoever has
    // had fewer premium shifts. These better-paid slots are scarce, so their
    // rotation outranks hour pacing here — hours re-balance on regular days.
    if (premiumDays.has(date.getDay()) && statsA.premium !== statsB.premium) {
        return statsA.premium - statsB.premium;
    }

    // 5. Hours fairness: hours worked relative to each worker's own
    // availability so far. Shift counts alone hide the fact that solo days
    // are much longer than split days.
    const loadA = statsA.hours / Math.max(1, env.workableDaysPassed.get(a.id) || 1);
    const loadB = statsB.hours / Math.max(1, env.workableDaysPassed.get(b.id) || 1);
    if (Math.abs(loadA - loadB) > 0.05) return loadA - loadB;

    // 6. Total shift count
    let scoreA = statsA.total;
    let scoreB = statsB.total;
    if (prioritizeEitherForDay && shiftType === ShiftType.DAY) {
        if (a.preference === WorkerPreference.EITHER) scoreA -= 2;
        if (b.preference === WorkerPreference.EITHER) scoreB -= 2;
    }
    if (scoreA !== scoreB) return scoreA - scoreB;

    // 7. Block rotation: a fresh starter whose previous block was the OTHER
    // shift type is due this one — whole blocks of days alternate with whole
    // blocks of nights.
    if (rules.blockMode) {
        const rotA = prevBlockType.get(a.id) === shiftType ? 1 : 0;
        const rotB = prevBlockType.get(b.id) === shiftType ? 1 : 0;
        if (rotA !== rotB) return rotA - rotB;
    }

    // 8. Day/night mix balance (including carry-over from imported history):
    // for a day shift, prefer whoever has worked relatively more nights, and
    // vice versa, so each person's day/night split stays even.
    const biasA = historyBias.get(a.id) || 0;
    const biasB = historyBias.get(b.id) || 0;
    const mixA = shiftType === ShiftType.DAY ? (statsA.day - statsA.night + biasA) : (statsA.night - statsA.day - biasA);
    const mixB = shiftType === ShiftType.DAY ? (statsB.day - statsB.night + biasB) : (statsB.night - statsB.day - biasB);
    if (mixA !== mixB) return mixA - mixB;

    // True tie: keep shuffled order (= random tie-break, consistent comparator)
    return 0;
  });

  return candidates.slice(0, count).map(e => e.id);
}

export const exportToCSV = (version: ScheduleVersion, employees: Employee[]) => {
    let maxDay = 0, maxNight = 0;
    version.schedule.forEach(s => {
        maxDay = Math.max(maxDay, s.dayShift.length);
        maxNight = Math.max(maxNight, s.nightShift.length);
    });

    const nameById = new Map(employees.map(e => [e.id, e.name]));

    const headers = ['Date', 'Is Padding'];
    for(let i=0; i<maxDay; i++) headers.push(`Day Shift Worker ${i+1}`);
    for(let i=0; i<maxNight; i++) headers.push(`Night Shift Worker ${i+1}`);

    let csvContent = "\uFEFF" + headers.join(",") + "\n";
    version.schedule.forEach(row => {
        const line = [row.date, row.isPadding ? 'Yes' : 'No'];
        for(let i=0; i<maxDay; i++) {
            const id = row.dayShift[i];
            const name = id ? nameById.get(id) || 'Unknown' : '';
            line.push(`"${name.replace(/"/g, '""')}"`);
        }
        for(let i=0; i<maxNight; i++) {
            const id = row.nightShift[i];
            const name = id ? nameById.get(id) || 'Unknown' : '';
            line.push(`"${name.replace(/"/g, '""')}"`);
        }
        csvContent += line.join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `schedule_${version.month + 1}_${version.year}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

export const exportToExcel = (version: ScheduleVersion, employees: Employee[]) => {
    let maxDay = 0, maxNight = 0;
    version.schedule.forEach(s => {
        maxDay = Math.max(maxDay, s.dayShift.length);
        maxNight = Math.max(maxNight, s.nightShift.length);
    });

    const nameById = new Map(employees.map(e => [e.id, e.name]));
    const getName = (id: string | undefined) => id ? nameById.get(id) || 'Unknown' : '';
    let headerCells = `<th style="background-color:#e2e8f0; border:1px solid #94a3b8;">Date</th>`;
    for(let i=0; i<maxDay; i++) headerCells += `<th style="background-color:#fef3c7; border:1px solid #94a3b8;">Day Worker ${i+1}</th>`;
    for(let i=0; i<maxNight; i++) headerCells += `<th style="background-color:#e0e7ff; border:1px solid #94a3b8;">Night Worker ${i+1}</th>`;

    let tableRows = '';
    version.schedule.forEach(row => {
        const bg = row.isPadding ? '#f1f5f9' : '#ffffff';
        let rowCells = `<td style="border:1px solid #cbd5e1; background-color:${bg};">${row.date}${row.isPadding ? ' (Pad)' : ''}</td>`;
        for(let i=0; i<maxDay; i++) rowCells += `<td style="border:1px solid #cbd5e1; background-color:${bg};">${getName(row.dayShift[i])}</td>`;
        for(let i=0; i<maxNight; i++) rowCells += `<td style="border:1px solid #cbd5e1; background-color:${bg};">${getName(row.nightShift[i])}</td>`;
        tableRows += `<tr>${rowCells}</tr>`;
    });

    const tableHtml = `
      <table style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; color: #000;">
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    `;

    const template = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
        <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Schedule</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
      </head>
      <body>${tableHtml}</body>
      </html>
    `;

    const blob = new Blob([template], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `schedule_${version.month + 1}_${version.year}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};
