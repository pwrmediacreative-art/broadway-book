"use client";

// Who is signed in, as the app's navigation loaded it (app/AuthBar.tsx), shared with the
// Settings page and the tabs without a second round of requests.
import { useSyncExternalStore } from "react";

export interface NavMe {
  id: string;
  name: string;
  instrument: string | null;
  admin: boolean;
  reviewer: boolean;
  upload: boolean; // may upload charts (upload_access)
  unread: number; // notifications
  invites: number; // setlist copies waiting for an answer
  votes: number; // open suggestions waiting for this player's vote
}

/** undefined = still loading, null = signed out. */
let me: NavMe | null | undefined = undefined;
const listeners = new Set<() => void>();

export function setNavMe(next: NavMe | null | undefined) {
  me = next;
  listeners.forEach((l) => l());
}

export function patchNavMe(p: Partial<NavMe>) {
  if (me) setNavMe({ ...me, ...p });
}

export function useNavMe(): NavMe | null | undefined {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => me,
    () => undefined,
  );
}
