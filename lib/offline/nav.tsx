"use client";

// Moving between songs. Normally that is the router. On the saved-chart page (offline) the
// song changes in place instead: no page load, so it is instant and fullscreen stays on.
import { createContext, useCallback, useContext } from "react";
import { useRouter } from "next/navigation";

/** Returns true when it handled the address itself. */
type LocalNav = (href: string) => boolean;
const Ctx = createContext<LocalNav | null>(null);
export const LocalNavProvider = Ctx.Provider;

/** `go(href)`: like router.push, but the saved-chart page can take over song links. */
export function useGo(): (href: string) => void {
  const router = useRouter();
  const local = useContext(Ctx);
  return useCallback(
    (href: string) => {
      if (!local?.(href)) router.push(href);
    },
    [router, local],
  );
}

/** True on the saved-chart page (used to skip warming up pages that can't be fetched). */
export const useLocalNav = () => useContext(Ctx) !== null;
