"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Dictionary } from "@/i18n/config";
import en from "@/i18n/messages/en.json";

const I18nContext = createContext<Dictionary>(en);

export function I18nProvider({ dict, children }: { dict: Dictionary; children: ReactNode }) {
  return <I18nContext.Provider value={dict}>{children}</I18nContext.Provider>;
}

/** Access the active locale dictionary from client components. */
export function useT(): Dictionary {
  return useContext(I18nContext);
}
