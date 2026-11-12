import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/session";
import { safeNext } from "@/lib/auth/roles";
import ProfileForm from "./ProfileForm";

export const metadata = { title: "Your profile · Broadway Book", robots: { index: false } };

export default function ProfilePage({ searchParams }: PageProps<"/profile">) {
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-2">
      <Suspense fallback={<p className="text-lg text-muted">Loading…</p>}>
        <Profile searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Profile({ searchParams }: { searchParams: PageProps<"/profile">["searchParams"] }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/profile");
  const { next } = await searchParams;
  const first = !user.display_name;
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">{first ? "Welcome!" : "Your profile"}</h1>
      <p className="mb-6 mt-1 text-lg text-muted">
        {first ? "One quick step: what should other players call you?" : user.email}
      </p>
      <ProfileForm
        displayName={user.display_name ?? ""}
        instrument={user.instrument ?? ""}
        next={safeNext(typeof next === "string" ? next : "/")}
        first={first}
      />
    </>
  );
}
