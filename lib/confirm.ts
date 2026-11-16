// "Played it, it's right" and the confidence line on Unverified song pages. Pure.
// Database side: chart_confirmations + chart_confirm_state/toggle (20261116100000).

/** The "Confirmed by N players" line shows from this many confirmations. */
export const CONFIRMED_LINE_MIN = 3;

/** "75% sure" from a stored 0–1 score; null when there's no score. */
export function sureLabel(confidence: number | string | null | undefined): string | null {
  if (confidence === null || confidence === undefined || confidence === "") return null;
  const n = Number(confidence);
  if (!Number.isFinite(n)) return null;
  const pct = Math.round(Math.min(Math.max(n, 0), 1) * 100);
  return `${pct}% sure`;
}

/** "Confirmed by 3 players", or null below CONFIRMED_LINE_MIN. */
export function confirmedLine(count: number | null | undefined): string | null {
  if (!count || count < CONFIRMED_LINE_MIN) return null;
  return `Confirmed by ${count} players`;
}

export interface ConfirmState {
  count: number;
  mine: boolean;
}

/** Reads the database reply, or null when it doesn't look right. */
export function readConfirmState(v: unknown): ConfirmState | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const count = Number(o.count);
  if (!Number.isInteger(count) || count < 0) return null;
  return { count, mine: o.mine === true };
}
