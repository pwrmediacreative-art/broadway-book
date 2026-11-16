// Publish every waiting AI draft as Unverified (rules: 20261116100000_publish_unverified.sql).
//
//   npm run publish:unverified                       dry run: counts only, changes nothing
//   npm run publish:unverified -- --apply            publish (run id bulk-YYYY-MM-DD)
//   npm run publish:unverified -- --undo             dry run of the undo
//   npm run publish:unverified -- --undo --apply     send that run's songs back to review
//   options: --run <id>  pick the run id   --song <uuid>  undo one song only
//
// Re-runnable: songs already live are no longer in needs_review, so a second run only picks
// up new drafts. The log is auto_approvals (approved_by 'bulk', run_id) in the database.
// Needs SUPABASE_SERVICE_ROLE_KEY in .env.local (server only, never in the browser).
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
const run = opt("--run") ?? `bulk-${new Date().toISOString().slice(0, 10)}`;
const song = opt("--song");

interface PlanRow {
  song_id: string;
  title: string;
  artist: string | null;
  confidence: number | null;
  chart_text: string | null;
  reason: string | null;
}

async function rpc<T>(fn: string, body: unknown): Promise<T> {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY!, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${text}`);
  return JSON.parse(text) as T;
}

async function plan() {
  const rows: PlanRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await rpc<PlanRow[]>("publish_unverified_plan", { p_offset: offset, p_limit: 500 });
    rows.push(...page);
    if (page.length < 500) break;
  }
  const publish: PlanRow[] = [];
  const skipped: Record<string, PlanRow[]> = {};
  for (const row of rows) {
    let reason = row.reason;
    if (!reason) {
      const check = checkChart(row.chart_text ?? "");
      if (check.error) reason = "parse_error";
      else if (!check.ok) reason = "long_cue";
    }
    if (reason) (skipped[reason] ??= []).push(row);
    else publish.push(row);
  }
  return { total: rows.length, publish, skipped };
}

function report({ total, publish, skipped }: Awaited<ReturnType<typeof plan>>) {
  console.log(`needs_review drafts: ${total}`);
  console.log(`will publish as Unverified: ${publish.length}`);
  const conf = publish.map((r) => Number(r.confidence ?? 0)).sort((a, b) => a - b);
  if (conf.length) {
    const q = (p: number) => Math.round(conf[Math.floor(p * (conf.length - 1))] * 100);
    console.log(`  confidence: lowest ${q(0)}%, median ${q(0.5)}%, highest ${q(1)}%; at 50% or under: ${conf.filter((c) => c <= 0.5).length}`);
  }
  const skippedTotal = Object.values(skipped).reduce((n, l) => n + l.length, 0);
  console.log(`skipped: ${skippedTotal}`);
  for (const [reason, list] of Object.entries(skipped).sort((a, b) => b[1].length - a[1].length)) {
    const sample = list.slice(0, 3).map((r) => `${r.title} (${r.artist ?? "?"})`).join("; ");
    console.log(`  ${reason}: ${list.length}   e.g. ${sample}`);
  }
}

async function main() {
  if (!URL_ || !KEY) throw new Error("Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  if (undo) {
    const r = await rpc<Record<string, unknown>>("publish_unverified_undo", { p_run: run, p_dry_run: !apply, p_song_id: song ?? null });
    console.log(JSON.stringify(r, null, 2));
    if (!apply) console.log("Dry run. Add --apply to send these songs back to review.");
    return;
  }
  const p = await plan();
  console.log(`run id: ${run}${apply ? "" : " (dry run, nothing changed)"}`);
  report(p);
  if (!apply) return;
  let live = 0;
  for (let i = 0; i < p.publish.length; i += 200) {
    const ids = p.publish.slice(i, i + 200).map((r) => r.song_id);
    live += await rpc<number>("publish_unverified_apply", { p_run: run, p_ids: ids });
    console.log(`  published ${live} / ${p.publish.length}`);
  }
  console.log(`Done: ${live} songs live as Unverified under run ${run}.`);
  console.log(`Undo: npm run publish:unverified -- --undo --apply --run ${run}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
