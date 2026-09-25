// All persistent app state and the actions that change it.
import { useCallback, useMemo } from 'react';
import {
  DailySchedule, Employee, MonthSetup, ScheduleVersion, ShiftConfig, ShiftType
} from '../types';
import { STORAGE_KEYS, usePersistentState } from '../lib/storage';
import { defaultConfig, defaultEmployees, normalizeConfig } from '../lib/config';
import { normalizeEmployees, normalizeMonthSetups, normalizeVersions } from '../lib/io';
import { monthKey } from '../lib/dates';
import { legacyStats } from '../lib/stats';
import { resolveContinuity } from '../lib/continuity';
import { setCurrentLang, type Lang } from '../i18n';

export type Tab = 'schedule' | 'workers' | 'rules';

export interface UiState {
  tab: Tab;
  year: number;
  month: number;
  calendarMode: 'grid' | 'list';
  lang: Lang;
}

const browserLang = (): Lang => {
  try { return navigator.language?.toLowerCase().startsWith('he') ? 'he' : 'en'; } catch { return 'en'; }
};

const defaultUi = (): UiState => {
  const now = new Date();
  return { tab: 'schedule', year: now.getFullYear(), month: now.getMonth(), calendarMode: 'grid', lang: browserLang() };
};

const normalizeUi = (raw: unknown): UiState => {
  const d = defaultUi();
  const r = (raw || {}) as Partial<UiState>;
  return {
    tab: r.tab === 'schedule' || r.tab === 'workers' || r.tab === 'rules' ? r.tab : d.tab,
    year: Number.isInteger(r.year) && r.year! > 2000 && r.year! < 2200 ? r.year! : d.year,
    month: Number.isInteger(r.month) && r.month! >= 0 && r.month! <= 11 ? r.month! : d.month,
    calendarMode: r.calendarMode === 'list' ? 'list' : 'grid',
    lang: r.lang === 'he' || r.lang === 'en' ? r.lang : d.lang,
  };
};

// A hand-edited carried-over day is no longer last month's copy: it becomes
// the manager's own day, so regenerating keeps the edit.
const ownDay = (d: DailySchedule): DailySchedule => (d.carried ? { ...d, carried: undefined } : d);

const withStats = (v: ScheduleVersion, schedule: DailySchedule[]): ScheduleVersion => {
  const ids = new Set(Object.keys(v.stats || {}));
  schedule.forEach(d => [...d.dayShift, ...d.nightShift].forEach(id => ids.add(id)));
  return { ...v, schedule, stats: legacyStats(schedule, [...ids]) };
};

export function useAppState() {
  const [employees, setEmployees, e1] = usePersistentState<Employee[]>(STORAGE_KEYS.employees, defaultEmployees, normalizeEmployees);
  const [config, setConfig, e2] = usePersistentState<ShiftConfig>(STORAGE_KEYS.config, defaultConfig, normalizeConfig);
  const [versions, setVersions, e3] = usePersistentState<ScheduleVersion[]>(STORAGE_KEYS.versions, () => [], normalizeVersions);
  const [selectedVersionId, setSelectedVersionId] = usePersistentState<string | null>(
    STORAGE_KEYS.selectedVersion, () => null, v => (typeof v === 'string' ? v : null));
  const [monthSetups, setMonthSetups] = usePersistentState<Record<string, MonthSetup>>(STORAGE_KEYS.months, () => ({}), normalizeMonthSetups);
  const [ui, setUi] = usePersistentState<UiState>(STORAGE_KEYS.ui, () => {
    // First run of this build: open the month of the schedule that was open
    const d = defaultUi();
    try {
      const sel = JSON.parse(localStorage.getItem(STORAGE_KEYS.selectedVersion) || 'null');
      const vs = normalizeVersions(JSON.parse(localStorage.getItem(STORAGE_KEYS.versions) || '[]'));
      const v = vs.find(x => x.id === sel) || vs[0];
      if (v) return { ...d, year: v.year, month: v.month };
    } catch { /* ignore */ }
    return d;
  }, normalizeUi);

  const storageError = e1 || e2 || e3;
  const { year, month, lang } = ui;
  // Library code (labels, rule messages) reads the language from here
  setCurrentLang(lang);
  const key = monthKey(year, month);

  const monthVersions = useMemo(
    () => versions.filter(v => v.year === year && v.month === month).sort((a, b) => b.timestamp - a.timestamp),
    [versions, year, month]
  );

  const currentVersion = useMemo(
    () => monthVersions.find(v => v.id === selectedVersionId) || monthVersions.find(v => v.final) || monthVersions[0] || null,
    [monthVersions, selectedVersionId]
  );

  const monthSetup = monthSetups[key];
  const continuity = useMemo(
    () => resolveContinuity(versions, year, month, monthSetup, employees, config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [versions, year, month, monthSetup, employees, config, lang]
  );

  const setMonthSetup = useCallback((update: (s: MonthSetup) => MonthSetup) => {
    setMonthSetups(p => ({ ...p, [key]: update(p[key] || {}) }));
  }, [key, setMonthSetups]);

  const goToMonth = useCallback((y: number, m: number) => setUi(u => ({ ...u, year: y, month: m })), [setUi]);
  const setTab = useCallback((tab: Tab) => setUi(u => ({ ...u, tab })), [setUi]);
  const setLang = useCallback((lang: Lang) => setUi(u => ({ ...u, lang })), [setUi]);

  // ----- Version edits -----

  const updateVersion = useCallback((id: string, fn: (v: ScheduleVersion) => ScheduleVersion) => {
    setVersions(p => p.map(v => (v.id === id ? fn(v) : v)));
  }, [setVersions]);

  const editDay = useCallback((versionId: string, date: string, fn: (d: DailySchedule) => DailySchedule) => {
    updateVersion(versionId, v => withStats(v, v.schedule.map(d => (d.date === date ? fn(d) : d))));
  }, [updateVersion]);


  // Put a worker on a shift (moving them if they already work that day).
  // Manual choices are pinned so regenerating keeps them.
  const assign = useCallback((versionId: string, date: string, shift: ShiftType, empId: string, replaceId?: string) => {
    editDay(versionId, date, d => {
      let dayShift = d.dayShift.filter(id => id !== empId);
      let nightShift = d.nightShift.filter(id => id !== empId);
      if (replaceId) {
        dayShift = dayShift.filter(id => id !== replaceId);
        nightShift = nightShift.filter(id => id !== replaceId);
      }
      if (shift === ShiftType.DAY) dayShift = [...dayShift, empId]; else nightShift = [...nightShift, empId];
      const pinned = [...new Set([...(d.pinned || []).filter(id => id !== replaceId), empId])];
      return ownDay({ ...d, dayShift, nightShift, pinned });
    });
  }, [editDay]);

  const unassign = useCallback((versionId: string, date: string, empId: string) => {
    editDay(versionId, date, d => {
      const pinned = (d.pinned || []).filter(id => id !== empId);
      return ownDay({ ...d, dayShift: d.dayShift.filter(id => id !== empId), nightShift: d.nightShift.filter(id => id !== empId), pinned: pinned.length ? pinned : undefined });
    });
  }, [editDay]);

  const togglePin = useCallback((versionId: string, date: string, empId: string) => {
    editDay(versionId, date, d => {
      const has = d.pinned?.includes(empId);
      const pinned = has ? d.pinned!.filter(id => id !== empId) : [...(d.pinned || []), empId];
      return { ...d, pinned: pinned.length ? pinned : undefined };
    });
  }, [editDay]);

  const toggleLock = useCallback((versionId: string, date: string) => {
    const v = versions.find(x => x.id === versionId);
    const day = v?.schedule.find(d => d.date === date);
    if (!v || !day) return;
    const locking = !day.locked;
    if (day.carried) {
      // Remember that the manager released (or re-locked) a carried-over day
      setMonthSetups(p => {
        const k = monthKey(v.year, v.month);
        const s = p[k] || {};
        const released = new Set(s.released || []);
        if (locking) released.delete(date); else released.add(date);
        return { ...p, [k]: { ...s, released: released.size ? [...released] : undefined } };
      });
    }
    editDay(versionId, date, d => ({ ...d, locked: locking || undefined }));
  }, [versions, editDay, setMonthSetups]);

  const markFinal = useCallback((versionId: string) => {
    const target = versions.find(v => v.id === versionId);
    if (!target) return;
    const makeFinal = !target.final;
    setVersions(p => p.map(v => {
      if (v.year !== target.year || v.month !== target.month) return v;
      if (v.id === versionId) return { ...v, final: makeFinal || undefined };
      return makeFinal && v.final ? { ...v, final: undefined } : v;
    }));
  }, [versions, setVersions]);

  const renameVersion = useCallback((versionId: string, name: string) => {
    updateVersion(versionId, v => ({ ...v, name: name.trim() || v.name }));
  }, [updateVersion]);

  const deleteVersion = useCallback((versionId: string) => {
    setVersions(p => p.filter(v => v.id !== versionId));
  }, [setVersions]);

  const addVersion = useCallback((v: ScheduleVersion) => {
    setVersions(p => [v, ...p]);
    setSelectedVersionId(v.id);
  }, [setVersions, setSelectedVersionId]);

  return {
    employees, setEmployees,
    config, setConfig,
    versions, setVersions,
    selectedVersionId, setSelectedVersionId,
    monthSetups, setMonthSetups, monthSetup, setMonthSetup,
    ui, setUi, setTab, setLang, goToMonth,
    monthVersions, currentVersion, continuity,
    assign, unassign, togglePin, toggleLock, markFinal, renameVersion, deleteVersion, addVersion,
    storageError,
  };
}

export type AppState = ReturnType<typeof useAppState>;
