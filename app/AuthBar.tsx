"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { browserClient } from "@/lib/supabase/browser";

type Me = { name: string; admin: boolean } | null;

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
      const { data } = await db.from("profiles").select("display_name, role").eq("id", session.user.id).maybeSingle();
      if (alive) setMe({ name: data?.display_name || "Profile", admin: data?.role === "admin" });
    }
    load();
    const { data: sub } = db.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(load, 0);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [pathname, authPage]);

  const link = "inline-flex h-11 items-center px-2 text-base text-muted active:text-foreground";
  if (pathname === "/login" || authPage) return <Bar />;
  if (me === undefined) return <Bar />;
  if (me === null) {
    const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return (
      <Bar>
        <Link href={`/login${next}`} className={link}>
          Sign in to suggest changes
        </Link>
      </Bar>
    );
  }
  return (
    <Bar>
      {me.admin && (
        <Link href="/admin" className={`${link} text-accent`}>
          Admin
        </Link>
      )}
      <Link href="/profile" className={`${link} max-w-[12rem] truncate`}>
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
