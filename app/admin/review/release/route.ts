import { sessionClient } from "@/lib/supabase/session";
import { isUuid } from "@/lib/review/queue";

/**
 * Release the caller's claim on a song. Called with navigator.sendBeacon when the review
 * tab closes or the reviewer leaves the song, so the other reviewer can pick it up.
 */
export async function POST(req: Request) {
  let id: unknown = null;
  try {
    id = (JSON.parse(await req.text()) as { id?: unknown }).id;
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!isUuid(id)) return new Response(null, { status: 400 });
  const db = await sessionClient();
  const { error } = await db.rpc("review_release", { p_song_id: id });
  return new Response(null, { status: error ? 403 : 204 });
}
