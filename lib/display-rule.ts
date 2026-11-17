// The Numbers/Chords sync rule, kept free of browser imports so tests can load it.

export type Display = "numbers" | "chords";
export const isDisplay = (v: unknown): v is Display => v === "numbers" || v === "chords";

/** Which side wins: the newer timestamp; a side with no choice never wins. */
export function newer(device: { v: Display | null; at: string | null }, account: { v: Display | null; at: string | null }): "device" | "account" | "same" {
  if (device.v === account.v) return "same";
  if (!account.v) return "device";
  if (!device.v) return "account";
  const d = Date.parse(device.at ?? "") || 0;
  const a = Date.parse(account.at ?? "") || 0;
  return a > d ? "account" : "device";
}
