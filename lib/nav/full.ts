"use client";

import { useEffect } from "react";

/**
 * A full-screen page (stage mode, setlist play) is showing: hide the tab bar / side rail and
 * give the page the whole screen. Counted, so a stage view inside play mode works too.
 * CSS: `html[data-full]` in app/globals.css.
 */
export function useFullScreenPage() {
  useEffect(() => {
    const h = document.documentElement;
    h.dataset.full = String(Number(h.dataset.full || 0) + 1);
    return () => {
      const n = Number(h.dataset.full || 1) - 1;
      if (n > 0) h.dataset.full = String(n);
      else delete h.dataset.full;
    };
  }, []);
}
