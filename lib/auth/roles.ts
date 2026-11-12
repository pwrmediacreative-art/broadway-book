// Pure helpers for sign-in and roles (no Supabase calls, so they're easy to test).

export const INSTRUMENTS = ["guitar", "bass", "keys", "drums", "fiddle", "steel", "vocals", "other"] as const;
export type Instrument = (typeof INSTRUMENTS)[number];
export const DISPLAY_NAME_MAX = 40;

/**
 * Parse ADMIN_EMAILS ("a@x.com, b@y.com"). Returns null when the variable is unset,
 * meaning "don't touch roles" (so a missing env var never demotes anyone).
 */
export function parseAdminEmails(raw: string | undefined): Set<string> | null {
  if (raw === undefined) return null;
  return new Set(
    raw
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** The role a user should have, or null if roles shouldn't be synced. */
export function roleFor(email: string | undefined, admins: Set<string> | null): "admin" | "contributor" | null {
  if (!admins) return null;
  return email && admins.has(email.trim().toLowerCase()) ? "admin" : "contributor";
}

/** Validate the profile form. Returns cleaned values or an error message. */
export function cleanProfile(name: unknown, instrument: unknown):
  | { ok: true; display_name: string; instrument: Instrument | null }
  | { ok: false; error: string } {
  const n = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!n) return { ok: false, error: "Display name is required." };
  if (n.length > DISPLAY_NAME_MAX) return { ok: false, error: `Display name must be ${DISPLAY_NAME_MAX} characters or fewer.` };
  const i = typeof instrument === "string" ? instrument : "";
  if (i && !(INSTRUMENTS as readonly string[]).includes(i)) return { ok: false, error: "Pick an instrument from the list." };
  return { ok: true, display_name: n, instrument: (i || null) as Instrument | null };
}

/** Only allow same-site relative paths as a post-login destination. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
