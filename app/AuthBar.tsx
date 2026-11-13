"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { browserClient } from "@/lib/supabase/browser";

type Me = { name: string; admin: boolean; unread: number } | null;
const READ_EVENT = "bb:notifications-read"; // fired by /notifications once it marks all read

/** Small top-right sign-in link / account links. Never blocks the chart. */
export default function AuthBar() {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | undefined>(undefined);

  // /auth/* pages handle sign-in tokens themselves; don't let a second client touch them.
  const authPage = pathname.startsWith("/auth/");

  useEffect(() => {
    if (authPage) return;
    const db = browserClient();
    let alive = true;
    async function load() {
      const {
        data: { session },
      } = await db.auth.getSession();
      if (!session) return alive && setMe(null);
      const [{ data }, { count }] = await Promise.all([
        db.from("profiles").select("display_name, role").eq("id", session.user.id).maybeSingle(),
        db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", session.user.id).is("read_at", null),
      ]);
      if (alive) setMe({ name: data?.display_name || "Profile", admin: data?.role === "admin", unread: count ?? 0 });
    }
    load();
    const onRead = () => setMe((m) => (m ? { ...m, unread: 0 } : m));
    window.addEventListener(READ_EVENT, onRead);
    const { data: sub } = db.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(load, 0);
    });
    return () => {
      alive = false;
      window.removeEventListener(READ_EVENT, onRead);
      sub.subscription.unsubscribe();
    };
  }, [pathname, authPage]);

  const link = "inline-flex h-11 items-center px-2 text-base text-muted active:text-foreground";
  if (pathname === "/login" || authPage) return <Bar />;
  if (me === undefined) return <Bar />;
  const community = (
    <>
      <Link href="/setlists" className={link}>
        Setlists
      </Link>
      <Link href="/community" className={`${link} mr-auto`}>
        Community
      </Link>
    </>
  );
  if (me === null) {
    const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return (
      <Bar>
        {community}
        <Link href={`/login${next}`} className={link}>
          Sign in
        </Link>
      </Bar>
    );
  }
  return (
    <Bar>
      {community}
      <Link
        href="/notifications"
        aria-label={me.unread ? `Notifications, ${me.unread} unread` : "Notifications"}
        className={`${link} relative`}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {me.unread > 0 && (
          <span className="absolute right-0 top-1 min-w-5 rounded-full bg-accent px-1 text-center text-xs font-bold leading-5 text-black">
            {me.unread > 9 ? "9+" : me.unread}
          </span>
        )}
      </Link>
      {me.admin && (
        <Link href="/admin" className={`${link} text-accent`}>
          Admin
        </Link>
      )}
      <Link href="/profile" className={`${link} max-w-[8rem] truncate`}>
        {me.name}
      </Link>
      <form action="/auth/signout" method="post">
        <button type="submit" className={link}>
          Sign out
        </button>
      </form>
    </Bar>
  );
}

function Bar({ children }: { children?: React.ReactNode }) {
  return (
    <nav aria-label="Account" className="mx-auto flex h-11 w-full max-w-3xl items-center justify-end gap-1 px-2">
      {children}
    </nav>
  );
}
