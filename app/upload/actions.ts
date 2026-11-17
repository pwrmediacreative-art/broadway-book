"use server";

// Server actions for private charts made from uploads. They run as the signed-in user
// (session client), so RLS and the database functions decide what's allowed: only people
// the upload setting lets in can create, and only the owner can see or change a chart.
// The chart is always built and checked on the server with our parser.
import { checkChart, MAX_CUE_WORDS } from "@/lib/chart";
import { getMeta } from "@/lib/chart/parse";
import { sessionClient } from "@/lib/supabase/session";
import { readMusicXml, MusicXmlError, MAX_MUSICXML_BYTES } from "@/lib/upload/musicxml";
import { buildChart, BuildError } from "@/lib/upload/build";
import type { Timeline } from "@/lib/upload/timeline";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const NOT_SIGNED_IN = { ok: false as const, error: "Sign in first." };
const plain = (m: string) =>
  /permission denied|row-level security|42501/i.test(m) ? "You can't do that." : m.replace(/^.*?ERROR:\s*/, "");

async function signedIn() {
  const db = await sessionClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  return { db, user };
}

function metaOf(text: string) {
  const c = checkChart(text);
  if (c.error || !c.doc) return { error: `Chart format error: ${c.error}` } as const;
  if (c.longCues.length) return { error: `Cues must be ${MAX_CUE_WORDS} words or fewer (no lyrics): "${c.longCues[0]}"` } as const;
  const m = getMeta(c.doc);
  return { text: c.canonical!, meta: { key: m.key, bpm: m.bpm, time: m.time }, title: m.title, artist: m.artist } as const;
}

const AUDIO_PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/;

/** Read a MusicXML file, build the chart and save it as a private chart. */
export async function createFromMusicXml(input: {
  xml: string;
  title: string;
  artist: string;
  audioPath: string | null;
  audioSeconds: number | null;
}): Promise<Result<{ id: string }>> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { data: allowed } = await db.rpc("upload_access");
  if (!allowed) return { ok: false, error: "Uploading isn't open to your account." };
  if (input.xml.length > MAX_MUSICXML_BYTES) return { ok: false, error: "That file is over 2 MB." };
  if (input.audioPath && (!AUDIO_PATH.test(input.audioPath) || !input.audioPath.startsWith(`${user.id}/`)))
    return { ok: false, error: "That audio file isn't yours." };
  if (input.audioSeconds !== null && !(input.audioSeconds > 0 && input.audioSeconds <= 600))
    return { ok: false, error: "Audio must be 10 minutes or shorter." };

  let tl: Timeline;
  try {
    tl = readMusicXml(input.xml);
  } catch (e) {
    return { ok: false, error: e instanceof MusicXmlError ? e.message : "We couldn't read that file." };
  }
  const title = input.title.trim() || tl.title || "";
  if (!title) return { ok: false, error: "Give the song a title." };
  let built;
  try {
    built = buildChart(tl, { title, artist: input.artist.trim() || null });
  } catch (e) {
    return { ok: false, error: e instanceof BuildError ? e.message : "We couldn't turn this file into a chart." };
  }
  const { data, error } = await db.rpc("upload_create", {
    p_title: title,
    p_artist: input.artist.trim() || null,
    p_source: "musicxml",
    p_chart: built.text,
    p_meta: { key: built.key, bpm: built.bpm, time: built.time },
    p_analysis: tl,
    p_confidence: built.confidence,
    p_estimated: built.estimated,
    p_audio_path: input.audioPath,
    p_audio_seconds: input.audioSeconds,
  });
  if (error) {
    // the chart wasn't saved: don't leave the audio file behind
    if (input.audioPath) await db.storage.from("audio").remove([input.audioPath]);
    return { ok: false, error: plain(error.message) };
  }
  return { ok: true, id: (data as { id: string }).id };
}

/** Save the owner's edits (chart text is the one source of truth, card edits included). */
export async function savePrivateChart(songId: string, chartText: string): Promise<Result<{ text: string }>> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const m = metaOf(chartText);
  if ("error" in m) return { ok: false, error: m.error! };
  if (!m.title) return { ok: false, error: "The chart needs a {title:} line." };
  const { error } = await db.rpc("private_save", {
    p_song: songId,
    p_chart: m.text,
    p_meta: m.meta,
    p_title: m.title,
    p_artist: m.artist ?? "",
    p_note: "Edited",
  });
  if (error) return { ok: false, error: plain(error.message) };
  return { ok: true, text: m.text };
}

/** Build the chart again from the stored analysis (free: no file, no outside service). */
export async function rebuildPrivateChart(songId: string): Promise<Result<{ text: string }>> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { data: row } = await db.from("uploads").select("analysis").eq("song_id", songId).maybeSingle();
  const { data: song } = await db.from("songs").select("title, artist").eq("id", songId).maybeSingle();
  if (!row?.analysis || !song) return { ok: false, error: "There's no analysis to rebuild from." };
  let built;
  try {
    built = buildChart(row.analysis as Timeline, { title: song.title, artist: song.artist });
  } catch (e) {
    return { ok: false, error: e instanceof BuildError ? e.message : "We couldn't rebuild the chart." };
  }
  const { error } = await db.rpc("private_save", {
    p_song: songId,
    p_chart: built.text,
    p_meta: { key: built.key, bpm: built.bpm, time: built.time },
    p_note: "Rebuilt from analysis",
    p_rebuilt: true,
    p_confidence: built.confidence,
  });
  if (error) return { ok: false, error: plain(error.message) };
  return { ok: true, text: built.text };
}

/** Tap sync: where the first bar starts in the audio, and how many bars the chart had then. */
export async function setPlaySync(songId: string, sync: { start: number; bars: number } | null): Promise<Result> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  if (sync && !(sync.start >= 0 && sync.start < 3600 && Number.isInteger(sync.bars) && sync.bars >= 0 && sync.bars < 5000))
    return { ok: false, error: "That sync point is off the end of the song." };
  const { error } = await db.rpc("upload_set_sync", { p_song: songId, p_sync: sync });
  return error ? { ok: false, error: plain(error.message) } : { ok: true };
}

export async function attachAudio(songId: string, audioPath: string, audioSeconds: number): Promise<Result> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  if (!AUDIO_PATH.test(audioPath) || !audioPath.startsWith(`${user.id}/`)) return { ok: false, error: "That audio file isn't yours." };
  if (!(audioSeconds > 0 && audioSeconds <= 600)) return { ok: false, error: "Audio must be 10 minutes or shorter." };
  const { error } = await db.rpc("upload_set_audio", { p_song: songId, p_audio_path: audioPath, p_audio_seconds: audioSeconds });
  if (error) {
    await db.storage.from("audio").remove([audioPath]);
    return { ok: false, error: plain(error.message) };
  }
  return { ok: true };
}

/** "Delete audio": the file and its analysis go, the chart stays. */
export async function deleteAudio(songId: string): Promise<Result> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { data: path, error } = await db.rpc("upload_delete_audio", { p_song: songId });
  if (error) return { ok: false, error: plain(error.message) };
  if (path) {
    const { error: e2 } = await db.storage.from("audio").remove([path as string]);
    if (e2) return { ok: false, error: `The chart no longer uses the file, but removing it failed: ${e2.message}` };
  }
  return { ok: true };
}

/** "Delete chart": everything (chart, history, analysis, audio, share link). */
export async function deletePrivateChart(songId: string): Promise<Result> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { data: path, error } = await db.rpc("upload_delete", { p_song: songId });
  if (error) return { ok: false, error: plain(error.message) };
  if (path) await db.storage.from("audio").remove([path as string]);
  return { ok: true };
}

export async function setSharing(songId: string, on: boolean): Promise<Result<{ code: string | null }>> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { data, error } = await db.rpc("upload_share", { p_song: songId, p_on: on });
  if (error) return { ok: false, error: plain(error.message) };
  return { ok: true, code: (data as string | null) ?? null };
}

/** /admin: who may upload (0 off, 1 admins only, 2 admins + Pro). */
export async function setUploadAccess(value: 0 | 1 | 2): Promise<Result> {
  const { db, user } = await signedIn();
  if (!user) return NOT_SIGNED_IN;
  const { error } = await db.rpc("set_upload_access", { p_value: value });
  return error ? { ok: false, error: plain(error.message) } : { ok: true };
}
