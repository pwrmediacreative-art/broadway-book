"use server";

import { revalidatePath } from "next/cache";
import { dropboxConfigured, listPdfs } from "@/lib/dropbox/client";
import { parseFilename } from "@/lib/import/filename";
import { getCurrentUser, sessionClient } from "@/lib/supabase/session";

export interface ScanState {
  ok?: boolean;
  error?: string;
  summary?: string;
}
export interface FixState {
  ok?: boolean;
  error?: string;
}

const BATCH = 500;

async function isAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  return user?.role === "admin";
}

/** List every PDF in the Dropbox folder and store it. Safe to re-run. */
export async function scanDropbox(prev: ScanState): Promise<ScanState> {
  void prev;
  // The database functions also refuse non-admins; this check stops the Dropbox call first.
  if (!(await isAdmin())) return { error: "Admins only." };
  if (!dropboxConfigured()) return { error: "Dropbox isn't connected yet. Add the DROPBOX_* env vars." };
  try {
    const files = await listPdfs();
    const scanAt = new Date().toISOString();
    const db = await sessionClient();
    const t = { new: 0, changed: 0, unchanged: 0, moved: 0, songs_created: 0 };
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH).map((f) => ({ ...f, ...parseFilename(f.name) }));
      const { data, error } = await db.rpc("import_scan_apply", { p_files: batch, p_scan_at: scanAt });
      if (error) throw new Error(error.message);
      for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += Number(data?.[k] ?? 0);
    }
    // Only after the whole listing went through: anything not seen is missing.
    const { data: missing, error } = await db.rpc("import_scan_finish", { p_scan_at: scanAt });
    if (error) throw new Error(error.message);
    revalidatePath("/admin/import");
    return {
      ok: true,
      summary:
        `Found ${files.length} PDFs: ${t.new} new, ${t.changed} changed, ${t.unchanged} unchanged, ` +
        `${t.moved} renamed or moved, ${missing ?? 0} newly missing. ${t.songs_created} draft songs created.`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Scan failed." };
  }
}

/** Set a file's title and artist by hand; creates its draft song. */
export async function fixName(prev: FixState, form: FormData): Promise<FixState> {
  void prev;
  const id = String(form.get("id") ?? "");
  const title = String(form.get("title") ?? "").trim();
  const artist = String(form.get("artist") ?? "").trim();
  if (!title || !artist) return { error: "Title and artist are both needed." };
  if (title.length > 200 || artist.length > 200) return { error: "Keep each under 200 characters." };
  const db = await sessionClient();
  const { error } = await db.rpc("import_fix_name", { p_id: id, p_title: title, p_artist: artist });
  if (error) return { error: error.message };
  revalidatePath("/admin/import");
  return { ok: true };
}
