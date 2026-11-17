"use client";

// The app's navigation: four tabs (Home · Setlists · Community · Settings) as a bottom bar on
// phones and tablets and a slim left rail on desktop (lg), plus a small top line with the
// notifications bell (signed in) or "Sign in". Hidden on full-screen pages (stage mode,
// setlist play, print): those have their own ✕. Account links live on /settings.
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { browserClient } from "@/lib/supabase/browser";
import { OFFLINE_MSG, useOffline } from "@/lib/offline/status";
import { rememberedUser, rememberUser } from "@/lib/offline/user";
import { syncDisplay } from "@/lib/display";
import { INVITES_EVENT } from "@/lib/setlists/invites";
import { patchNavMe, setNavMe, useNavMe } from "@/lib/nav/me";
import { badge, hidesTabs, tabFor, TABS, VOTES_EVENT, type TabId } from "@/lib/nav/tabs";

const READ_EVENT = "bb:notifications-read"; // fired by /notifications once it marks all read
const COUNTS_EVERY_MS = 30_000;

/** Loads who is signed in (once, and on sign-in/out) and the badge counts (on page changes). */
function useLoadMe(pathname: string) {
  const offline = useOffline();
  const authPage = pathname.startsWith("/auth/");
  const lastCounts = useRef(0);
  const uid = useRef<string | null>(null);
  const offlineRef = useRef(offline);

  const counts = useRef(async () => {
    const id = uid.current;
    if (!id || offlineRef.current) return;
    lastCounts.current = Date.now();
    const db = browserClient();
    const [{ count: unread }, { data: inv }, { data: open }] = await Promise.all([
      db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", id).is("read_at", null),
      db.rpc("setlist_invites_waiting"),
      // Open suggestions by someone else, still current, that this player hasn't voted on.
      db.from("proposals").select("id, out_of_date, votes(voter_id)").eq("status", "open").neq("author_id", id).limit(200),
    ]);
    const votes = ((open ?? []) as { out_of_date: boolean; votes: { voter_id: string }[] }[]).filter(
      (p) => !p.out_of_date && !p.votes.some((v) => v.voter_id === id),
    ).length;
    if (uid.current === id) patchNavMe({ unread: unread ?? 0, invites: Array.isArray(inv) ? inv.length : 0, votes });
  });

  useEffect(() => {
    offlineRef.current = offline;
    if (authPage) return;
    const db = browserClient();
    let alive = true;
    async function load() {
      // Offline: keep showing whoever is signed in on this phone (nothing can be checked).
      if (offline) {
        const saved = rememberedUser();
        uid.current = saved?.id ?? null;
        if (alive)
          setNavMe(
            saved
              ? { id: saved.id, name: saved.name || "Profile", instrument: null, admin: !!saved.admin, reviewer: !!saved.reviewer, upload: false, unread: 0, invites: 0, votes: 0 }
              : null,
          );
        return;
      }
      const {
        data: { session },
        error: sessionError,
      } = await db.auth.getSession();
      if (!session) {
        uid.current = null;
        if (!sessionError) rememberUser(null);
        if (alive) setNavMe(null);
        return;
      }
      const id = session.user.id;
      const [{ data }, { data: upload }] = await Promise.all([
        db.from("profiles").select("display_name, instrument, role, reviewer").eq("id", id).maybeSingle(),
        db.rpc("upload_access"),
      ]);
      if (data) rememberUser({ id, name: data.display_name || "Profile", admin: data.role === "admin", reviewer: data.reviewer === true });
      void syncDisplay(db, id); // Numbers/Chords: newest of device and account wins
      if (!alive) return;
      uid.current = id;
      setNavMe({
        id,
        name: data?.display_name || "Profile",
        instrument: data?.instrument ?? null,
        admin: data?.role === "admin",
        reviewer: data?.reviewer === true,
        upload: upload === true,
        unread: 0,
        invites: 0,
        votes: 0,
      });
      void counts.current();
    }
    load();
    const onRead = () => patchNavMe({ unread: 0 });
    const onCounts = () => void counts.current();
    window.addEventListener(READ_EVENT, onRead);
    window.addEventListener(INVITES_EVENT, onCounts);
    window.addEventListener(VOTES_EVENT, onCounts);
    const { data: sub } = db.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(load, 0);
    });
    return () => {
      alive = false;
      window.removeEventListener(READ_EVENT, onRead);
      window.removeEventListener(INVITES_EVENT, onCounts);
      window.removeEventListener(VOTES_EVENT, onCounts);
      sub.subscription.unsubscribe();
    };
  }, [authPage, offline]);

  // Badge counts: fresh on the pages they're about, otherwise at most every 30 seconds.
  useEffect(() => {
    const t = tabFor(pathname);
    if (t === "community" || t === "setlists" || Date.now() - lastCounts.current > COUNTS_EVERY_MS) void counts.current();
  }, [pathname]);
}

export default function AuthBar() {
  const pathname = usePathname();
  useLoadMe(pathname);
  return (
    <>
      <TopLine pathname={pathname} />
      {!hidesTabs(pathname) && <Tabs pathname={pathname} />}
    </>
  );
}

/** Small top line: the bell when signed in, "Sign in" when not. Never blocks the chart. */
function TopLine({ pathname }: { pathname: string }) {
  const me = useNavMe();
  const offline = useOffline();
  const link = "inline-flex h-11 items-center px-2 text-base text-bb-cue-gray active:text-bb-chart-white";
  const hide = pathname === "/login" || pathname.startsWith("/auth/") || me === undefined;
  return (
    <nav aria-label="Account" className="mx-auto flex h-11 w-full max-w-3xl items-center justify-end gap-1 px-2 print:hidden lg:max-w-7xl lg:px-8">
      {hide ? null : me === null ? (
        offline ? (
          <span className={link} title={OFFLINE_MSG} aria-disabled>
            Sign in
          </span>
        ) : (
          <Link href={`/login${pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`}`} className={link}>
            Sign in
          </Link>
        )
      ) : (
        <Link
          href="/notifications"
          aria-label={me.unread ? `Notifications, ${me.unread} unread` : "Notifications"}
          className={`${link} relative`}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {me.unread > 0 && <Count n={me.unread} className="absolute right-0 top-0.5" />}
        </Link>
      )}
    </nav>
  );
}

function Count({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`min-w-5 rounded-bb-control bg-bb-downbeat-amber px-1 text-center font-bb-data text-sm font-bold leading-5 text-bb-stage-black ${className}`}
    >
      {badge(n)}
    </span>
  );
}

function Tabs({ pathname }: { pathname: string }) {
  const me = useNavMe();
  const active = tabFor(pathname);
  const count: Partial<Record<TabId, number>> = me ? { setlists: me.invites, community: me.votes } : {};
  return (
    <nav
      id="bb-tabs"
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-bb-rule-gray bg-bb-house-black pb-[env(safe-area-inset-bottom)] print:hidden lg:inset-x-auto lg:left-0 lg:top-0 lg:w-24 lg:border-r lg:border-t-0 lg:pb-0"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-4 lg:mt-2 lg:grid-cols-1 lg:gap-1">
        {TABS.map((t) => {
          const on = active === t.id;
          const n = count[t.id] ?? 0;
          const label = n ? `${t.label}, ${n} ${t.id === "community" ? "waiting for your vote" : "waiting"}` : undefined;
          return (
            <li key={t.id}>
              <Link
                href={t.href}
                transitionTypes={["bb-tab"]}
                aria-current={on ? "page" : undefined}
                aria-label={label}
                onClick={(e) => {
                  // Home while on Home: back to the top of the song list instead of reloading it.
                  if (t.id === "home" && pathname === "/") {
                    e.preventDefault();
                    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
                  }
                }}
                className={`relative flex h-16 flex-col items-center justify-center gap-1 text-sm font-semibold active:bg-bb-case-charcoal ${
                  on ? "text-bb-downbeat-amber" : "text-bb-cue-gray active:text-bb-chart-white"
                }`}
              >
                <TabIcon id={t.id} on={on} />
                <span>{t.label}</span>
                {n > 0 && <Count n={n} className="absolute left-1/2 top-1.5 ml-2" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Simple line icons in one stroke weight (the same family as the bell); a touch heavier when lit. */
function TabIcon({ id, on }: { id: TabId; on: boolean }) {
  const p = { strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth={on ? 2.4 : 2} aria-hidden>
      {id === "home" && <path d="M3.5 10.5 12 3.5l8.5 7V20a.5.5 0 0 1-.5.5h-5v-6h-6v6H4a.5.5 0 0 1-.5-.5z" {...p} />}
      {id === "setlists" && (
        <>
          <path d="M9.5 6h10.5M9.5 12h10.5M9.5 18h10.5" {...p} />
          <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" {...p} strokeWidth={3.2} />
        </>
      )}
      {id === "community" && (
        <>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8" {...p} />
        </>
      )}
      {id === "settings" && (
        <>
          <path d="M4 7h9.5M18.5 7H20M4 17h1.5M10.5 17H20" {...p} />
          <circle cx="16" cy="7" r="2.5" />
          <circle cx="8" cy="17" r="2.5" />
        </>
      )}
    </svg>
  );
}
