// Review queue order + filter: labels, parsing from the URL / the device cookie. Pure.

export const ORDERS = {
  conf_desc: "Highest confidence first",
  conf_asc: "Lowest confidence first",
  title: "A–Z by title",
  artist: "By artist",
} as const;
export type Order = keyof typeof ORDERS;

export const FILTERS = {
  needs_review: "Needs review",
  needs_manual: "Can't read (type it in)",
  duplicates: "Duplicates",
} as const;
export type Filter = keyof typeof FILTERS;

export interface Prefs {
  filter: Filter;
  order: Order;
}
export const DEFAULT_PREFS: Prefs = { filter: "needs_review", order: "conf_desc" };

/** Remembered on this device (read by the server to pick the next song). */
export const PREFS_COOKIE = "bb_review";

const isOrder = (v: unknown): v is Order => typeof v === "string" && Object.hasOwn(ORDERS, v);
const isFilter = (v: unknown): v is Filter => typeof v === "string" && Object.hasOwn(FILTERS, v);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** URL (?f=&o=) wins, then the cookie ("filter.order"), then the defaults. */
export function readPrefs(sp: { f?: string | string[]; o?: string | string[] }, cookie?: string | null): Prefs {
  const [cf, co] = (cookie ?? "").split(".");
  const f = one(sp.f);
  const o = one(sp.o);
  return {
    filter: isFilter(f) ? f : isFilter(cf) ? cf : DEFAULT_PREFS.filter,
    order: isOrder(o) ? o : isOrder(co) ? co : DEFAULT_PREFS.order,
  };
}

export const prefsCookie = (p: Prefs) => `${p.filter}.${p.order}`;
export const prefsQuery = (p: Prefs) => `f=${p.filter}&o=${p.order}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Songs skipped this sitting (sessionStorage), kept short and valid. */
export function cleanSkip(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(isUuid))].slice(-500);
}
