// GET /api/lyrics?slug=…            lyrics for one song, live from the lyrics provider
// GET /api/lyrics?slug=…&candidates=1  admins: other matches to pick from
// The database decides who may see lyrics (lyrics_song / lyrics_allowed, from the /admin
// audience setting). Nothing is stored or cached here: responses are private + no-store,
// and never indexed.
import { NextResponse } from "next/server";
import { findLyrics, lyricsCandidates } from "@/lib/lyrics/provider";
import { sessionClient } from "@/lib/supabase/session";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") ?? "";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return reply({ status: "none" }, 400);

  const db = await sessionClient();
  const { data, error } = await db.rpc("lyrics_song", { p_slug: slug });
  if (error) return reply({ status: "error" }, 500);
  const song = (data as { song_id: string; title: string; artist: string | null; hidden: boolean; lrclib_id: number | null; admin: boolean }[] | null)?.[0];
  if (!song) {
    const { data: allowed } = await db.rpc("lyrics_allowed");
    return reply(allowed ? { status: "none", admin: false } : { status: "off" });
  }
  // Song id and pick are for the admin tools only. A song an admin hid reads as "no lyrics"
  // for everyone else, the same answer as a song LRCLIB doesn't have (lyrics_song already
  // leaves it out for them; this keeps it so if that ever changes).
  const base = song.admin ? { admin: true, songId: song.song_id, pinned: song.lrclib_id } : { admin: false };
  if (song.hidden && !song.admin) return reply({ status: "none", ...base });
  if (url.searchParams.get("candidates") === "1") {
    if (!song.admin) return reply({ status: "off" }, 403);
    try {
      return reply({ status: "candidates", ...base, candidates: await lyricsCandidates(song.title, song.artist) });
    } catch {
      return reply({ status: "error", ...base }, 502);
    }
  }
  if (song.hidden) return reply({ status: "hidden", ...base });
  try {
    const found = await findLyrics(song.title, song.artist, song.lrclib_id);
    return reply(found ? { status: "ok", ...base, ...found } : { status: "none", ...base });
  } catch {
    return reply({ status: "error", ...base }, 502);
  }
}
