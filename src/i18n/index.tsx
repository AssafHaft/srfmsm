// Language support (English / Hebrew). Strings live in en.ts / he.ts; the
// Hebrew dictionary must define every English key (enforced by its type).
import React, { createContext, useContext, useEffect } from 'react';
import { en } from './en';
import { he } from './he';

export type Lang = 'en' | 'he';
export type MessageKey = keyof typeof en;
export type Vars = Record<string, string | number>;

const DICTS: Record<Lang, Record<string, string>> = { en, he };

let current: Lang = 'en';

export const setCurrentLang = (lang: Lang) => { current = lang; };
export const getLang = (): Lang => current;
export const localeFor = (lang: Lang = current) => (lang === 'he' ? 'he-IL' : 'en-US');

// `count` picks a `<key>_one` variant when count is 1
export function translate(key: MessageKey, vars?: Vars, lang: Lang = current): string {
  const dict = DICTS[lang];
  const oneKey = `${key}_one`;
  let s = (vars?.count === 1 && (dict[oneKey] ?? DICTS.en[oneKey])) || dict[key] || DICTS.en[key] || key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, name) => (vars[name] !== undefined ? String(vars[name]) : m));
  return s;
}

export type T = (key: MessageKey, vars?: Vars) => string;

interface I18n {
  lang: Lang;
  t: T;
  setLang: (l: Lang) => void;
}

const I18nContext = createContext<I18n>({ lang: 'en', t: (k, v) => translate(k, v), setLang: () => {} });

export const I18nProvider: React.FC<{ lang: Lang; setLang: (l: Lang) => void; children: React.ReactNode }> = ({ lang, setLang, children }) => {
  // Keep the module-level language in sync before children render
  setCurrentLang(lang);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  }, [lang]);
  const t: T = (key, vars) => translate(key, vars, lang);
  return <I18nContext.Provider value={{ lang, t, setLang }}>{children}</I18nContext.Provider>;
};

export const useI18n = () => useContext(I18nContext);
