// Review screen keyboard shortcuts (⌘ on Mac, Ctrl elsewhere). They work while typing. Pure.

export type ReviewKey = "publish" | "unverified" | "save" | "cant_read" | "skip";

export const SHORTCUTS: { action: ReviewKey; keys: string; label: string }[] = [
  { action: "publish", keys: "⌘ ↵", label: "Publish (verified)" },
  { action: "unverified", keys: "⌘ ⇧ ↵", label: "Publish unverified" },
  { action: "save", keys: "⌘ S", label: "Save draft" },
  { action: "cant_read", keys: "⌘ ⇧ U", label: "Can't read" },
  { action: "skip", keys: "⌘ ⇧ K", label: "Skip" },
];

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function reviewKey(e: KeyLike): ReviewKey | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === "enter") return e.shiftKey ? "unverified" : "publish";
  if (k === "s" && !e.shiftKey) return "save";
  if (k === "u" && e.shiftKey) return "cant_read";
  if (k === "k" && e.shiftKey) return "skip";
  return null;
}

/** Shows ⌘ on Apple devices and Ctrl elsewhere. */
export const modLabel = (keys: string, apple: boolean) => (apple ? keys : keys.replace("⌘", "Ctrl"));
