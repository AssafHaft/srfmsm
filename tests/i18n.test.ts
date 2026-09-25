import { afterEach, describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { he } from '../src/i18n/he';
import { setCurrentLang, translate } from '../src/i18n';
import { validateSchedule } from '../src/lib/validate';
import { generateVersion } from '../src/lib/generate';
import { resolveContinuity } from '../src/lib/continuity';
import { monthLabel, weekdayShort } from '../src/lib/dates';
import { config, team } from './helpers';

afterEach(() => setCurrentLang('en'));

describe('translations', () => {
  it('Hebrew defines every English key with the same placeholders', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) || []).sort().join(',');
    Object.keys(en).forEach(k => {
      const key = k as keyof typeof en;
      expect(he[key], k).toBeTruthy();
      // Hebrew may drop {count} where the number is spelled out in words
      expect(vars(he[key]).replace('{count}', ''), k).toBe(vars(en[key]).replace('{count}', ''));
    });
  });

  it('fills placeholders and picks singular forms', () => {
    expect(translate('q.issues', { count: 3 })).toBe('3 rule issues');
    expect(translate('q.issues', { count: 1 })).toBe('1 rule issue');
    expect(translate('q.issues', { count: 1 }, 'he')).toBe('הפרת כלל אחת');
  });

  it('localizes dates, rule messages and version names', () => {
    setCurrentLang('he');
    expect(weekdayShort(0)).toBe('א׳');
    expect(monthLabel(2026, 9)).toContain('אוקטובר');
    const employees = team();
    const r = validateSchedule([{ date: '2026-10-04', dayShift: [], nightShift: [] }], employees, config());
    expect(r.issues[0].message).toContain('משבצת בוקר');
    const v = generateVersion({ employees, config: config(), year: 2026, month: 9, continuity: resolveContinuity([], 2026, 9, undefined), variation: 2, seed: 1 });
    expect(v.name).toContain('גרסה 2');
  });
});
