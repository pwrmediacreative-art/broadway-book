import { packIndex } from "@/lib/search/pack";
import { listSongIndex } from "@/lib/supabase/server";

/** The compact search index. Cached; rebuilt within a few minutes of a publish. */
export async function GET() {
  return Response.json(packIndex(await listSongIndex()));
}
