import { temporaryLink } from "@/lib/dropbox/client";
import { getCurrentUser, sessionClient } from "@/lib/supabase/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Admins only: send the browser to a fresh Dropbox temporary link for one PDF. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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
    return new Response(null, { status: 302, headers: { Location: link, "Cache-Control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Dropbox error";
    return new Response(`Couldn't open this PDF: ${msg}`, { status: 502 });
  }
}
