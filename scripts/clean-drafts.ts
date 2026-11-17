// Clean AI drafts: approve as is (rules: 20261118120000_clean_drafts.sql).
// Clean = the AI reading, zero "# UNCLEAR" notes, AI confidence 75% or higher.
//
//   npm run clean:drafts                         dry run: counts only, changes nothing
//   npm run clean:drafts -- --apply              mark live clean charts approved-as-is and
//                                                publish waiting clean drafts as Unverified
//   npm run clean:drafts -- --undo               dry run of the undo
//   npm run clean:drafts -- --undo --apply       clear that run's marks and send the drafts it
//                                                published back to review
//   options: --run <id>  pick the run id (default clean-YYYY-MM-DD)
//
// Re-runnable: charts already marked show as "already", published drafts are no longer
// waiting. Nothing here touches Verified status. Needs SUPABASE_SERVICE_ROLE_KEY.
import { checkChart } from "../lib/chart/validate";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const apply = flag("--apply");
const undo = flag("--undo");
const run = opt("--run") ?? `clean-${new Date().toISOString().slice(0, 10)}`;

interface Row {
  song_id: string;
  title: string;
  artist: string | null;
  status: string;
  unclear: number;
  confidence: number | null;
  bucket: string;
  chart_text: string | null;
}

async function rpc<T>(fn: string, body: unknown, query = ""): Promise<T> {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}${query}`, {
    method: "POST",
    headers: { apikey: KEY!, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${text}`);
  return JSON.parse(text) as T;
}

/** Every never-verified AI chart, paged past the API's 1,000-row cap. */
async function plan() {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await rpc<Row[]>("clean_plan", {}, `?order=song_id&limit=1000&offset=${offset}`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  const groups: Record<string, Row[]> = {};
  for (const row of rows) {
    let b = row.bucket;
    // Waiting drafts also go through our parser, like the bulk publish.
    if (b === "publish_draft") {
      const c = checkChart(row.chart_text ?? "");
      if (c.error) b = "skip_parse_error";
      else if (!c.ok) b = "skip_long_cue";
    }
    (groups[b] ??= []).push(row);
  }
  return { rows, groups };
}

const LABEL: Record<string, string> = {
  mark_live: "clean, live Unverified: will be marked approved-as-is",
  publish_draft: "clean, waiting draft: will publish as Unverified + marked",
  already: "clean, already marked",
  not_clean: "not clean (unclear bars or under 75%): needs checking, unchanged",
};

function report({ rows, groups }: Awaited<ReturnType<typeof plan>>) {
  const clean = rows.length - (groups.not_clean?.length ?? 0);
  console.log(`never-verified AI charts: ${rows.length} (live ${rows.filter((r) => r.status === "published").length}, waiting ${rows.filter((r) => r.status === "needs_review").length})`);
  console.log(`clean: ${clean}   needs checking: ${groups.not_clean?.length ?? 0}`);
  for (const [b, list] of Object.entries(groups).sort((x, y) => y[1].length - x[1].length)) {
    const sample = list.slice(0, 3).map((r) => `${r.title} (${r.artist ?? "?"}, ${Math.round(Number(r.confidence ?? 0) * 100)}%, ${r.unclear} unclear)`).join("; ");
    console.log(`  ${b}: ${list.length}  ${LABEL[b] ?? "clean but skipped for this reason: stays waiting"}\n      e.g. ${sample}`);
  }
}

async function main() {
  if (!URL_ || !KEY) throw new Error("Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  console.log(`run id: ${run}${apply ? "" : " (dry run, nothing changed)"}`);
  if (undo) {
    const marks = await rpc<number>("clean_undo", { p_run: run, p_dry_run: !apply });
    const back = await rpc<Record<string, unknown>>("publish_unverified_undo", { p_run: run, p_dry_run: !apply, p_song_id: null });
    console.log(`approved-as-is marks ${apply ? "cleared" : "to clear"}: ${marks}`);
    console.log(`drafts this run published: ${JSON.stringify(back)}`);
    if (!apply) console.log("Dry run. Add --apply to undo.");
    return;
  }
  const p = await plan();
  report(p);
  if (!apply) return;
  const live = p.groups.mark_live ?? [];
  const drafts = p.groups.publish_draft ?? [];
  let marked = 0;
  for (let i = 0; i < live.length; i += 400) {
    marked += await rpc<number>("clean_mark", { p_run: run, p_ids: live.slice(i, i + 400).map((r) => r.song_id) });
  }
  let published = 0;
  for (let i = 0; i < drafts.length; i += 200) {
    published += await rpc<number>("publish_unverified_apply", { p_run: run, p_ids: drafts.slice(i, i + 200).map((r) => r.song_id) });
  }
  console.log(`Done: marked ${marked} live charts, published ${published} waiting drafts (marked by the trigger), run ${run}.`);
  console.log(`Undo: npm run clean:drafts -- --undo --apply --run ${run}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
