"use client";

// "Add to Home Screen". Android/Chrome hands us an install prompt we can open from a button;
// iPhone has no prompt, so players get three short steps instead.
import { useSyncExternalStore } from "react";
import { readPref, setPref, usePref } from "@/lib/prefs";
import { installKind, type InstallKind } from "./plan";

const KEY = "bb.install"; // "dismissed" | "installed": never show the card again

interface PromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let promptEvent: PromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  // Fires early, once, on browsers that can install: keep it for the button.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    promptEvent = e as PromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    promptEvent = null;
    setPref(KEY, "installed");
    notify();
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function kindNow(): InstallKind {
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  return installKind(navigator.userAgent, navigator.maxTouchPoints ?? 0, standalone);
}

export function useInstall() {
  // null on the server and the first render (we don't know the phone yet).
  const kind = useSyncExternalStore<InstallKind | null>(subscribe, kindNow, () => null);
  const canPrompt = useSyncExternalStore(subscribe, () => promptEvent !== null, () => false);
  const hidden = usePref(KEY) !== null;
  return {
    kind,
    canPrompt,
    /** The home-page card: phones that can install, until dismissed or installed. */
    showCard: kind !== null && kind !== "installed" && !hidden && (canPrompt || kind === "ios" || kind === "android"),
    dismiss: () => setPref(KEY, readPref(KEY) ?? "dismissed"),
    /** Open the browser's install prompt. Resolves true when the player installed. */
    prompt: async () => {
      const e = promptEvent;
      if (!e) return false;
      await e.prompt();
      const { outcome } = await e.userChoice;
      promptEvent = null;
      if (outcome === "accepted") setPref(KEY, "installed");
      notify();
      return outcome === "accepted";
    },
  };
}
