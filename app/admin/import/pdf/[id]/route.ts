import { temporaryLink } from "@/lib/dropbox/client";
import { getCurrentUser, sessionClient } from "@/lib/supabase/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admins only: send the browser to a fresh Dropbox temporary link for one PDF.
 * `?inline=1` streams it from here instead (same origin, inline), so the pilot
 * results can show it in an iframe. Nothing is stored.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user || user.role !== "admin" || !UUID.test(id)) return new Response("Not found", { status: 404 });

  // RLS: only admins can read import_files.
  const db = await sessionClient();
  const { data } = await db
    .from("import_files")
    .select("dropbox_file_id, dropbox_path")
    .eq("id", id)
    .maybeSingle();
  if (!data) return new Response("Not found", { status: 404 });

  try {
    const link = await temporaryLink(data.dropbox_file_id ?? data.dropbox_path);
    if (new URL(req.url).searchParams.get("inline") !== "1") {
      return new Response(null, { status: 302, headers: { Location: link, "Cache-Control": "no-store" } });
    }
    const res = await fetch(link, { cache: "no-store" });
    if (!res.ok || !res.body) return new Response(`Couldn't open this PDF (${res.status}).`, { status: 502 });
    return new Response(res.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Dropbox error";
    return new Response(`Couldn't open this PDF: ${msg}`, { status: 502 });
  }
}
