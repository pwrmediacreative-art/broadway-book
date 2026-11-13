"use server";

// Server actions for community edits and personal versions. They run as the signed-in user
// (session client), so RLS and the database functions decide what is allowed; these only
// validate chart text with the parser first and turn database errors into plain words.
import { updateTag } from "next/cache";
import { checkChart, MAX_CUE_WORDS } from "@/lib/chart";
import { sessionClient } from "@/lib/supabase/session";
import { SONGS_TAG } from "@/lib/supabase/server";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; stale?: boolean };

interface DbError {
  message: string;
  code?: string;
  hint?: string | null;
}

function fail(e: DbError, dup = "That was already done."): { ok: false; error: string; stale?: boolean } {
  if (e.code === "23505") return { ok: false, error: dup };
  if (/permission denied|row-level security/i.test(e.message)) return { ok: false, error: "You can't do that." };
  return { ok: false, error: e.message, stale: e.hint === "stale" };
}

async function signedIn() {
  const db = await sessionClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  return { db, user };
}

const NOT_SIGNED_IN = { ok: false as const, error: "Sign in first." };

function validated(chartText: string): { ok: true; text: string } | { ok: false; error: string } {
  const c = checkChart(chartText);
  if (c.error) return { ok: false, error: `Chart format error: ${c.error}` };
  if (c.longCues.length) return { ok: false, error: `Cues must be ${MAX_CUE_WORDS} words or fewer (no lyrics): "${c.longCues[0]}"` };
  return { ok: true, text: c.canonical! };
}

const cleanNote = (n: string | null | undefined) => (n ?? "").trim().slice(0, 500);

// ── personal versions ───────────────────────────────────────────────────────

export async function savePersonal(input: { songId: string; chartText: string; note?: string; basedOn: string | null }): Promise<Result> {
  const v = validated(input.chartText);
  if (!v.ok) return v;
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { error } = await db.from("personal_chart_versions").upsert(
    {
      user_id: user.id,
      song_id: input.songId,
      chart_text: v.text,
      note: cleanNote(input.note) || null,
      based_on_revision_id: input.basedOn,
    },
    { onConflict: "user_id,song_id" },
  );
  return error ? fail(error) : { ok: true };
}

/** "Keep mine": acknowledge the newer public chart without changing your version. */
export async function keepPersonal(songId: string, revisionId: string): Promise<Result> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { error } = await db
    .from("personal_chart_versions")
    .update({ based_on_revision_id: revisionId })
    .eq("user_id", user.id)
    .eq("song_id", songId);
  return error ? fail(error) : { ok: true };
}

export async function deletePersonal(songId: string): Promise<Result> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { error } = await db.from("personal_chart_versions").delete().eq("user_id", user.id).eq("song_id", songId);
  return error ? fail(error) : { ok: true };
}

// ── suggestions ─────────────────────────────────────────────────────────────

export async function propose(input: {
  songId: string;
  chartText: string;
  note: string;
  baseRevisionId: string | null;
}): Promise<Result<{ id: string }>> {
  const v = validated(input.chartText);
  if (!v.ok) return v;
  const note = cleanNote(input.note);
  if (note.length < 3) return { ok: false, error: "Add a short note saying what you changed." };
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { data, error } = await db
    .from("proposals")
    .insert({ song_id: input.songId, chart_text: v.text, note, author_id: user.id, base_revision_id: input.baseRevisionId })
    .select("id")
    .single();
  return error ? fail(error) : { ok: true, id: data.id };
}

export async function updateProposal(input: { id: string; chartText: string; note: string }): Promise<Result> {
  const v = validated(input.chartText);
  if (!v.ok) return v;
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { error } = await db.rpc("update_proposal", { p_id: input.id, p_chart: v.text, p_note: cleanNote(input.note) });
  return error ? fail(error) : { ok: true };
}

export async function withdrawProposal(id: string): Promise<Result> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { error } = await db.rpc("withdraw_proposal", { p_id: id });
  return error ? fail(error) : { ok: true };
}

export async function vote(input: { id: string; approve: boolean; comment?: string }): Promise<Result<{ status: string }>> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { error } = await db.from("votes").insert({
    proposal_id: input.id,
    voter_id: user.id,
    value: input.approve ? "approve" : "reject",
    comment: (input.comment ?? "").trim().slice(0, 300) || null,
  });
  if (error) return fail(error, "You already voted on this suggestion.");
  const { data } = await db.from("proposals").select("status").eq("id", input.id).single();
  if (data?.status === "approved") updateTag(SONGS_TAG);
  return { ok: true, status: data?.status ?? "open" };
}

export async function report(input: { proposalId: string; voterId?: string | null; reason: string; details?: string }): Promise<Result> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { error } = await db.from("reports").insert({
    reporter_id: user.id,
    proposal_id: input.proposalId,
    voter_id: input.voterId ?? null,
    reason: input.reason,
    details: (input.details ?? "").trim().slice(0, 300) || null,
  });
  return error ? fail(error, "You already reported this. An admin will look at it.") : { ok: true };
}

export async function markNotificationsRead(): Promise<Result> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { error } = await db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);
  return error ? fail(error) : { ok: true };
}

// ── admins (the database checks is_admin(); these just pass through) ─────────

export async function adminDecide(id: string, approve: boolean): Promise<Result> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { error } = await db.rpc("admin_decide", { p_id: id, p_approve: approve });
  if (error) return fail(error);
  if (approve) updateTag(SONGS_TAG);
  return { ok: true };
}

export async function revertSong(songId: string, revisionId: string): Promise<Result> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { error } = await db.rpc("revert_song", { p_song_id: songId, p_revision_id: revisionId });
  if (error) return fail(error);
  updateTag(SONGS_TAG);
  return { ok: true };
}

export async function setBlocked(userId: string, blocked: boolean): Promise<Result> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { error } = await db.rpc("set_blocked", { p_user: userId, p_blocked: blocked });
  return error ? fail(error) : { ok: true };
}

/** Admins: make a player a trusted reviewer (or stop). The database refuses non-admins. */
export async function setReviewer(userId: string, on: boolean): Promise<Result> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { error } = await db.rpc("set_reviewer", { p_user_id: userId, p_on: on });
  return error ? fail(error) : { ok: true };
}

export async function resolveReport(id: string): Promise<Result> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { data, error } = await db
    .from("reports")
    .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: user.id })
    .eq("id", id)
    .select("id");
  if (error) return fail(error);
  return data.length ? { ok: true } : { ok: false, error: "You can't do that." };
}

export async function setSetting(key: string, value: number): Promise<Result> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { error } = await db.rpc("set_setting", { p_key: key, p_value: Math.round(value) });
  return error ? fail(error) : { ok: true };
}
