// Pilot results: each AI reading next to the PDF it came from. Server component.
export interface PilotItem {
  id: string;
  status: string;
  cost_usd: number;
  confidence: number | null;
  unclear: { section: string; bar: string; saw: string }[] | null;
  error: string | null;
  import_file_id: string;
  file_name: string | null;
  title: string | null;
  artist: string | null;
  slug: string | null;
  chart_text: string | null;
  notes: string | null;
  handwriting: string | null;
}

const STATUS: Record<string, [string, string]> = {
  ok: ["Parsed", "text-green-400"],
  ok_after_retry: ["Parsed after retry", "text-amber-300"],
  needs_manual: ["Needs manual", "text-red-400"],
  refused: ["Refused", "text-red-400"],
  error: ["Error", "text-red-400"],
  reserved: ["Reading…", "text-bb-cue-gray"],
  submitted: ["Reading…", "text-bb-cue-gray"],
};

function ChartText({ text }: { text: string }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-bb-house-black p-3 font-mono text-base leading-relaxed">
      {text.split("\n").map((line, i) => (
        <span
          key={i}
          className={line.startsWith("# UNCLEAR") ? "block rounded bg-amber-400/20 px-1 text-amber-200" : "block"}
        >
          {line || " "}
        </span>
      ))}
    </pre>
  );
}

export function PilotResults({ items, avgCost }: { items: PilotItem[]; avgCost: number | null }) {
  if (!items.length) return null;
  const parsed = items.filter((i) => i.status === "ok" || i.status === "ok_after_retry").length;
  const unclear = items.reduce((n, i) => n + (i.unclear?.length ?? 0), 0);
  return (
    <section id="pilot" aria-labelledby="pilot-h" className="mb-8 scroll-mt-4">
      <h2 id="pilot-h" className="text-2xl font-bold">Pilot results</h2>
      <p className="mb-4 text-lg text-bb-cue-gray">
        {items.length} charts · {parsed} parsed · {unclear} spots flagged unclear · average{" "}
        <span className="text-bb-chart-white">${(avgCost ?? 0).toFixed(4)}</span> per song (about half that on the full
        batch). Highlighted lines are spots to check against the PDF.
      </p>
      <ol className="flex flex-col gap-6">
        {items.map((it) => {
          const [label, cls] = STATUS[it.status] ?? [it.status, "text-bb-cue-gray"];
          return (
            <li key={it.id} className="rounded-xl border border-bb-rule-gray bg-bb-case-charcoal p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-xl font-semibold">
                  {it.title ?? "—"} <span className="text-bb-cue-gray">· {it.artist ?? "no artist"}</span>
                </h3>
                <p className="text-base">
                  <span className={`font-semibold ${cls}`}>{label}</span>
                  <span className="text-bb-cue-gray">
                    {it.confidence != null && ` · confidence ${Number(it.confidence).toFixed(2)}`} · $
                    {Number(it.cost_usd).toFixed(4)}
                    {it.handwriting && ` · ${it.handwriting}`}
                  </span>
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <iframe
                  src={`/admin/import/pdf/${it.import_file_id}?inline=1`}
                  title={`PDF: ${it.file_name ?? "chart"}`}
                  loading="lazy"
                  className="hidden h-[80vh] w-full rounded-lg bg-white lg:block"
                />
                <div className="min-w-0">
                  <a
                    href={`/admin/import/pdf/${it.import_file_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mb-3 inline-flex min-h-11 items-center rounded-lg border border-bb-rule-gray px-3 text-base text-bb-downbeat-amber lg:hidden"
                  >
                    View PDF
                  </a>
                  <p className="mb-2 break-words text-sm text-bb-cue-gray">{it.file_name}</p>
                  {it.error && <p className="mb-2 text-amber-300">{it.error}</p>}
                  {it.chart_text ? <ChartText text={it.chart_text} /> : <p className="text-bb-cue-gray">No chart text.</p>}
                  {!!it.unclear?.length && (
                    <ul className="mt-3 list-disc pl-5 text-base">
                      {it.unclear.map((u, i) => (
                        <li key={i}>
                          {u.section} bar {u.bar}: {u.saw}
                        </li>
                      ))}
                    </ul>
                  )}
                  {it.notes && <p className="mt-3 text-bb-cue-gray">{it.notes}</p>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
