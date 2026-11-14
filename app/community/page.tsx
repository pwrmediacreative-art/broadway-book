import { Suspense } from "react";
import Link from "next/link";
import { getCurrentUser, sessionClient } from "@/lib/supabase/session";
import { StatusPill, when, ReviewerBadge } from "./ui";

export const metadata = { title: "Community · Broadway Book" };

const FILTERS = [
  ["open", "All open"],
  ["needs", "Needs my vote"],
  ["stale", "Out of date"],
  ["mine", "Mine"],
] as const;
type Filter = (typeof FILTERS)[number][0];

export default function CommunityPage({ searchParams }: PageProps<"/community">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2">
      <Link href="/" className="inline-flex h-12 items-center text-lg text-bb-cue-gray active:text-bb-chart-white">
        ← All songs
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">Community</h1>
      <p className="mb-4 mt-1 text-lg text-bb-cue-gray">
        Suggested chart fixes waiting for votes. A suggestion goes live after enough players approve it.
      </p>
      <Suspense fallback={<p className="text-lg text-bb-cue-gray">Loading…</p>}>
        <List searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

interface Row {
  id: string;
  note: string | null;
  created_at: string;
  author_id: string;
  out_of_date: boolean;
  author: { display_name: string | null; reviewer: boolean } | null;
  song: { slug: string; title: string; artist: string | null };
  votes: { voter_id: string; value: "approve" | "reject" }[];
}

async function List({ searchParams }: { searchParams: PageProps<"/community">["searchParams"] }) {
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const f: Filter = (FILTERS.find(([k]) => k === str(sp.f))?.[0] ?? "open") as Filter;
  const q = str(sp.q).trim().slice(0, 80);
  const song = str(sp.song).trim();

  const user = await getCurrentUser(); // calls connection() first, so the Supabase client below runs at request time
  const db = await sessionClient();
  let query = db
    .from("proposals")
    .select(
      "id, note, created_at, author_id, out_of_date, author:profiles!proposals_author_id_fkey(display_name, reviewer), song:songs!inner(slug, title, artist), votes(voter_id, value)",
    )
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(200);
  if (song) query = query.eq("song.slug", song);
  const { data, error } = await query;
  if (error) return <p className="bb-error text-lg">Couldn&apos;t load suggestions: {error.message}</p>;

  const needle = q.toLowerCase();
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => {
    if (needle && !`${r.song.title} ${r.song.artist ?? ""} ${r.note ?? ""}`.toLowerCase().includes(needle)) return false;
    const mine = r.author_id === user?.id;
    if (f === "mine") return mine;
    if (f === "stale") return r.out_of_date;
    if (f === "needs") return !!user && !mine && !r.out_of_date && !r.votes.some((v) => v.voter_id === user.id);
    return true;
  });

  const href = (next: Partial<Record<"f" | "q" | "song", string>>) => {
    const p = new URLSearchParams();
    const merged = { f, q, song, ...next };
    if (merged.f && merged.f !== "open") p.set("f", merged.f);
    if (merged.q) p.set("q", merged.q);
    if (merged.song) p.set("song", merged.song);
    const s = p.toString();
    return s ? `/community?${s}` : "/community";
  };

  return (
    <>
      <nav aria-label="Filter" className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map(([k, label]) => (
          <Link
            key={k}
            href={href({ f: k })}
            aria-current={f === k ? "page" : undefined}
            className={`bb-btn bb-btn-secondary shrink-0 px-4 text-lg ${f === k ? "bb-on" : ""}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <form action="/community" className="mb-4 flex gap-2">
        {f !== "open" && <input type="hidden" name="f" value={f} />}
        {song && <input type="hidden" name="song" value={song} />}
        <input
          name="q"
          defaultValue={q}
          type="search"
          placeholder="Filter by song or artist"
          className="bb-input min-h-12 min-w-0 flex-1 px-4 text-lg"
        />
        <button className="bb-btn bb-btn-secondary min-h-12 px-4 text-lg">Go</button>
      </form>
      {song && (
        <p className="mb-3 text-lg">
          Showing one song.{" "}
          <Link href={href({ song: "" })} className="text-bb-chart-white underline underline-offset-4">
            Show all songs
          </Link>
        </p>
      )}
      {(f === "needs" || f === "mine") && !user && (
        <p className="mb-3 text-lg">
          <Link href={`/login?next=${encodeURIComponent(href({}))}`} className="text-bb-chart-white underline underline-offset-4">
            Sign in
          </Link>{" "}
          to see this list.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="bb-panel p-4 text-lg text-bb-cue-gray">
          {f === "needs" ? "Nothing needs your vote right now. Thanks!" : "No open suggestions here."}
        </p>
      ) : (
        <ul className="divide-y divide-bb-rule-gray border-y border-bb-rule-gray">
          {rows.map((r) => {
            const counted = r.votes.filter((v) => v.voter_id !== r.author_id);
            const yes = counted.filter((v) => v.value === "approve").length;
            const no = counted.length - yes;
            return (
              <li key={r.id}>
                <Link href={`/community/${r.id}`} className="block px-1 py-4 active:bg-bb-case-charcoal">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xl font-semibold">{r.song.title}</p>
                      {r.song.artist && <p className="truncate text-bb-cue-gray">{r.song.artist}</p>}
                    </div>
                    <StatusPill status="open" stale={r.out_of_date} />
                  </div>
                  <p className="mt-2 text-lg">“{r.note}”</p>
                  <p className="mt-1 text-sm text-bb-cue-gray">
                    {r.author?.display_name || "A player"}
                    <ReviewerBadge on={r.author?.reviewer} /> · {when(r.created_at)} · <span className="text-bb-chart-white">✓ {yes}</span>{" "}
                    <span className="text-bb-cue-gray">✕ {no}</span>
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
