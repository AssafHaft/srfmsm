// Browser persistence. Data lives in localStorage under the same keys as
// earlier builds, so existing workers, rules and schedules load unchanged.
import { useEffect, useRef, useState } from 'react';

export const STORAGE_KEYS = {
  employees: 'shiftmaster_employees',
  config: 'shiftmaster_config',
  versions: 'shiftmaster_versions',
  selectedVersion: 'shiftmaster_selected_version',
  months: 'shiftmaster_months',
  ui: 'shiftmaster_ui',
  sheet: 'shiftmaster_sheet', // events, notes and extra-row text of the team sheet
  github: 'shiftmaster_github', // sync settings incl. token: this browser only
  syncMeta: 'shiftmaster_sync',
} as const;

export function readStored<T>(key: string, normalize: (raw: unknown) => T, fallback: () => T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return normalize(JSON.parse(raw));
  } catch {
    /* unreadable or blocked storage: fall back to defaults */
  }
  return fallback();
}

export function usePersistentState<T>(
  key: string,
  fallback: () => T,
  normalize: (raw: unknown) => T = raw => raw as T
) {
  const [state, setState] = useState<T>(() => readStored(key, normalize, fallback));
  const first = useRef(true);
  const [saveError, setSaveError] = useState(false);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    try {
      localStorage.setItem(key, JSON.stringify(state));
      setSaveError(false);
    } catch {
      setSaveError(true); // storage full or blocked
    }
  }, [key, state]);
  return [state, setState, saveError] as const;
}
