"use client";

import { useEffect } from "react";

/** Sets <html lang/dir> for the active locale without inline scripts. */
export function HtmlAttrs({ locale, dir }: { locale: string; dir: "ltr" | "rtl" }) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  return null;
}
