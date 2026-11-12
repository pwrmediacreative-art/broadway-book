import { NextResponse, type NextRequest } from "next/server";
import { sessionClient, syncRole, type Role } from "@/lib/supabase/session";
import { safeNext } from "@/lib/auth/roles";

// Called by /auth/confirm with the tokens from the magic link. Supabase verifies them in
// setSession (getUser round-trip); then we set the cookie, sync the role and pick a landing page.
export async function POST(request: NextRequest) {
  let body: { access_token?: unknown; refresh_token?: unknown; next?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const { access_token, refresh_token } = body;
  if (typeof access_token !== "string" || typeof refresh_token !== "string") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const db = await sessionClient();
  const { error } = await db.auth.setSession({ access_token, refresh_token });
  if (error) return NextResponse.json({ error: "invalid link" }, { status: 401 });
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "invalid link" }, { status: 401 });

  const { data: profile } = await db.from("profiles").select("display_name, role").eq("id", user.id).maybeSingle();
  await syncRole(user.id, user.email, (profile?.role as Role) ?? "contributor");

  const next = safeNext(typeof body.next === "string" ? body.next : "/");
  const dest = profile?.display_name ? next : `/profile?next=${encodeURIComponent(next)}`;
  return NextResponse.json({ dest });
}
