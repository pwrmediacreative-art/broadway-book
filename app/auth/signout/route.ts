import { NextResponse, type NextRequest } from "next/server";
import { sessionClient } from "@/lib/supabase/session";

export async function POST(request: NextRequest) {
  const db = await sessionClient();
  await db.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
