import en from "./messages/en.json";
import ar from "./messages/ar.json";
import ku from "./messages/ku.json";
import tr from "./messages/tr.json";

export const locales = ["en", "ar", "ku", "tr"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "ar";

export const localeDirection: Record<Locale, "rtl" | "ltr"> = {
  en: "ltr",
  ar: "rtl",
  ku: "rtl",
  tr: "ltr",
};

export const localeNames: Record<Locale, string> = {
  en: "English",
  ar: "العربية",
  ku: "کوردی",
  tr: "Türkçe",
};

const dictionaries = { en, ar, ku, tr };

export type Dictionary = typeof en;

export function getDictionary(locale: string): Dictionary {
  const key = (locales.includes(locale as Locale) ? locale : defaultLocale) as Locale;
  return dictionaries[key];
}

export function isValidLocale(locale: string): locale is Locale {
  return locales.includes(locale as Locale);
}
