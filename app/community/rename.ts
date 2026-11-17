// Shared by the /community name-suggestion list (server) and its buttons (client).

export interface RenameRow {
  id: string;
  author_id: string;
  base_title: string;
  base_artist: string | null;
  new_title: string;
  new_artist: string | null;
  note: string | null;
  created_at: string;
  author: { display_name: string | null; reviewer: boolean } | null;
  song: { slug: string; title: string; artist: string | null };
  votes: { voter_id: string; value: "approve" | "reject" }[];
}

/** "Title — Artist", or just the title. */
export const songName = (title: string, artist: string | null | undefined) => (artist ? `${title} — ${artist}` : title);

/** The song's name changed after this was suggested, so the database refuses votes on it. */
export const renameStale = (r: Pick<RenameRow, "song" | "base_title" | "base_artist">) =>
  r.song.title !== r.base_title || (r.song.artist ?? null) !== (r.base_artist ?? null);
