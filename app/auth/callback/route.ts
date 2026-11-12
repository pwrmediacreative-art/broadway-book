import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { sessionClient, syncRole, type Role } from "@/lib/supabase/session";
import { safeNext } from "@/lib/auth/roles";

// Magic-link landing. Handles the token_hash link (our email template, works in any browser)
// and the PKCE ?code= link (Supabase's default template, same browser only).
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const tokenHash = q.get("token_hash");
  const type = q.get("type") as EmailOtpType | null;
  const code = q.get("code");
  const fail = () => NextResponse.redirect(new URL("/login?error=link", request.url));

  const db = await sessionClient();
  if (tokenHash && type) {
    const { error } = await db.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return fail();
  } else if (code) {
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (error) return fail();
  } else {
    return fail();
  }

  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return fail();

  const { data: profile } = await db.from("profiles").select("display_name, role").eq("id", user.id).maybeSingle();
  await syncRole(user.id, user.email, (profile?.role as Role) ?? "contributor");

  let next = "/";
  try {
    next = safeNext(q.get("next") ?? decodeURIComponent(request.cookies.get("bb_next")?.value ?? "/"));
  } catch {}
  const dest = profile?.display_name ? next : `/profile?next=${encodeURIComponent(next)}`;
  const res = NextResponse.redirect(new URL(dest, request.url));
  res.cookies.delete("bb_next");
  return res;
}
