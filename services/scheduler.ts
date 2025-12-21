
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
  manualHistory?: ManualHistoryInput
): ScheduleVersion => {
  const days = getFullWeeksRange(year, month);
  const monthDays = getDaysInMonth(year, month);
  const schedule: DailySchedule[] = [];
  
  const workHistory = new Map<string, Set<string>>();
  const lastShiftType = new Map<string, ShiftType | null>();
  const consecutiveDays = new Map<string, number>();
  const stats = new Map<string, { day: number, night: number, total: number }>();
  
  // availability tracking for fair pacing
  const totalWorkableDaysInMonth = new Map<string, number>();
  const workableDaysPassed = new Map<string, number>();

  // Initialize
  employees.forEach(e => {
    workHistory.set(e.id, new Set());
    stats.set(e.id, { day: 0, night: 0, total: 0 });
    consecutiveDays.set(e.id, history ? (history.consecutiveDaysEnding[e.id] || 0) : 0);
    lastShiftType.set(e.id, null);
    workableDaysPassed.set(e.id, 0);

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
                    if (entry.dayShift.includes(e.id)) lastShiftType.set(e.id, ShiftType.DAY);
                    else lastShiftType.set(e.id, ShiftType.NIGHT);
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
    const manualEntry = manualHistory ? manualHistory[dateKey] : undefined;

    let dayWorkers: string[] = [];
    let nightWorkers: string[] = [];

    if (manualEntry) {
      dayWorkers = manualEntry.dayShift;
      nightWorkers = manualEntry.nightShift;
    } else {
      const forbiddenDayWorkers: string[] = [];
      employees.forEach(e => {
         const yesterdayDate = new Date(dayDate);
         yesterdayDate.setDate(yesterdayDate.getDate() - 1);
         const yKey = formatDateKey(yesterdayDate);

         if (lastShiftType.get(e.id) === ShiftType.NIGHT) {
             if (workHistory.get(e.id)?.has(yKey)) {
                 forbiddenDayWorkers.push(e.id);
             } else if (dayIndex === 0 && history && history.lastDayNightShiftIds.includes(e.id)) {
                 forbiddenDayWorkers.push(e.id);
             }
         }
      });

      // Day Shift
      dayWorkers = pickWorkers(
        employees,
        reqs.day,
        dayDate,
        workableDaysPassed,
        totalWorkableDaysInMonth,
        ShiftType.DAY,
        workHistory,
        lastShiftType,
        consecutiveDays,
        stats,
        forbiddenDayWorkers, 
        !!config.distributeDayShiftsToEither 
      );
      
      // Night Shift
      nightWorkers = pickWorkers(
        employees,
        reqs.night,
        dayDate,
        workableDaysPassed,
        totalWorkableDaysInMonth,
        ShiftType.NIGHT,
        workHistory,
        lastShiftType,
        consecutiveDays,
        stats,
        dayWorkers, 
        false 
      );
    }

    const todayWorkers = [...dayWorkers, ...nightWorkers];
    employees.forEach(e => {
      const workedToday = todayWorkers.includes(e.id);
      if (workedToday) {
        workHistory.get(e.id)?.add(dateKey);
        consecutiveDays.set(e.id, (consecutiveDays.get(e.id) || 0) + 1);
        if (dayWorkers.includes(e.id)) lastShiftType.set(e.id, ShiftType.DAY);
        else lastShiftType.set(e.id, ShiftType.NIGHT);

        if (isTargetMonth) {
          const s = stats.get(e.id)!;
          s.total += 1;
          if (dayWorkers.includes(e.id)) s.day += 1;
          else s.night += 1;
        }
      } else {
        consecutiveDays.set(e.id, 0);
        lastShiftType.set(e.id, null); 
      }
    });

    schedule.push({ date: dateKey, dayShift: dayWorkers, nightShift: nightWorkers, isPadding });
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
    schedule,
    stats: finalStats
  };
};

// Selection Logic
function pickWorkers(
  pool: Employee[],
  count: number,
  date: Date,
  workableDaysPassed: Map<string, number>,
  totalWorkableDaysInMonth: Map<string, number>,
  shiftType: ShiftType,
  workHistory: Map<string, Set<string>>,
  lastShiftType: Map<string, ShiftType | null>,
  consecutiveDays: Map<string, number>,
  stats: Map<string, { day: number, night: number, total: number }>,
  excludeIds: string[],
  prioritizeEitherForDay: boolean = false
): string[] {
  const dateKey = formatDateKey(date);
  
  const candidates = pool.filter(e => {
    if (excludeIds.includes(e.id)) return false;

    // Preference
    if (shiftType === ShiftType.DAY && e.preference === WorkerPreference.NIGHT_ONLY) return false;
    if (shiftType === ShiftType.NIGHT && e.preference === WorkerPreference.DAY_ONLY) return false;

    // Weekly Availability (Days of Week)
    if (e.availability.daysOff.includes(date.getDay())) return false;

    // Specific Unavailability (Vacations/Dates)
    if (e.availability.unavailableDates?.includes(dateKey)) return false;

    // HARD CONSTRAINT: Max 5 consecutive
    if ((consecutiveDays.get(e.id) || 0) >= 5) return false;

    // HARD CONSTRAINT: No Day after Night
    if (shiftType === ShiftType.DAY) {
        const yesterday = new Date(date);
        yesterday.setDate(date.getDate() - 1);
        const yKey = formatDateKey(yesterday);
        const workedYesterday = workHistory.get(e.id)?.has(yKey);
        if (workedYesterday && lastShiftType.get(e.id) === ShiftType.NIGHT) return false;
    }

    return true;
  });

  candidates.sort((a, b) => {
    const statsA = stats.get(a.id)!;
    const statsB = stats.get(b.id)!;
    const targetA = a.targetShifts || 0;
    const targetB = b.targetShifts || 0;
    
    const metTargetA = targetA > 0 && statsA.total >= targetA;
    const metTargetB = targetB > 0 && statsB.total >= targetB;
    if (metTargetA !== metTargetB) return metTargetA ? 1 : -1; 
    
    // Prorated Pacing: Compare shifts worked to available shifts opportunity
    const getPacingDiff = (empId: string, empTarget: number, currentTotal: number) => {
        const totalWorkable = totalWorkableDaysInMonth.get(empId) || 0;
        const passedWorkable = workableDaysPassed.get(empId) || 0;
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

    let scoreA = statsA.total;
    let scoreB = statsB.total;

    // Tie-break: if no specific target, balance based on utilization rate
    if (targetA === 0 && targetB === 0) {
        const utilA = statsA.total / Math.max(1, workableDaysPassed.get(a.id) || 1);
        const utilB = statsB.total / Math.max(1, workableDaysPassed.get(b.id) || 1);
        if (Math.abs(utilA - utilB) > 0.01) return utilA - utilB;
    }

    if (prioritizeEitherForDay && shiftType === ShiftType.DAY) {
        if (a.preference === WorkerPreference.EITHER) scoreA -= 2;
        if (b.preference === WorkerPreference.EITHER) scoreB -= 2;
    }

    if (scoreA !== scoreB) return scoreA - scoreB;
    
    if (a.preference === WorkerPreference.EITHER && b.preference === WorkerPreference.EITHER) {
        const aRatio = shiftType === ShiftType.DAY ? statsA.day : statsA.night;
        const bRatio = shiftType === ShiftType.DAY ? statsB.day : statsB.night;
        return aRatio - bRatio;
    }

    return Math.random() - 0.5;
  });

  return candidates.slice(0, count).map(e => e.id);
}

export const exportToCSV = (version: ScheduleVersion, employees: Employee[]) => {
    let maxDay = 0, maxNight = 0;
    version.schedule.forEach(s => {
        maxDay = Math.max(maxDay, s.dayShift.length);
        maxNight = Math.max(maxNight, s.nightShift.length);
    });

    const headers = ['Date', 'Is Padding'];
    for(let i=0; i<maxDay; i++) headers.push(`Day Shift Worker ${i+1}`);
    for(let i=0; i<maxNight; i++) headers.push(`Night Shift Worker ${i+1}`);
    
    let csvContent = "\uFEFF" + headers.join(",") + "\n";
    version.schedule.forEach(row => {
        const line = [row.date, row.isPadding ? 'Yes' : 'No'];
        for(let i=0; i<maxDay; i++) {
            const id = row.dayShift[i];
            const name = id ? employees.find(e => e.id === id)?.name || 'Unknown' : '';
            line.push(`"${name.replace(/"/g, '""')}"`);
        }
        for(let i=0; i<maxNight; i++) {
            const id = row.nightShift[i];
            const name = id ? employees.find(e => e.id === id)?.name || 'Unknown' : '';
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

    const getName = (id: string | undefined) => id ? employees.find(e => e.id === id)?.name || 'Unknown' : '';
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
