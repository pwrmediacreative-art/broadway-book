"use client";

import { useEffect } from "react";
import { markNotificationsRead } from "@/app/community/actions";

export const READ_EVENT = "bb:notifications-read";

/** Opening the list marks everything read (the bell listens for READ_EVENT). */
export default function MarkRead() {
  useEffect(() => {
    markNotificationsRead().then(() => window.dispatchEvent(new Event(READ_EVENT)));
  }, []);
  return null;
}
