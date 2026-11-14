import type { ChartDiff, DiffCell } from "@/lib/chart";

// Inline bar-by-bar diff, words first. Each changed bar says "new", "changed" or "removed":
// added = solid Chart White border, changed = dashed Chart White border (old value struck out
// above), removed = Cue Gray struck out with a Rule Gray border. Unchanged rows are dimmed.

const WORD: Partial<Record<DiffCell["state"], string>> = { added: "new", changed: "changed", removed: "removed" };

const CELL: Record<DiffCell["state"], string> = {
  same: "border-transparent",
  changed: "border-dashed border-bb-chart-white",
  added: "border-solid border-bb-chart-white",
  removed: "border-bb-rule-gray text-bb-cue-gray",
};

export function DiffSummary({ diff }: { diff: ChartDiff }) {
  if (!diff.changedRows) return <span>No changes</span>;
  const bars = diff.changedBars;
  return (
    <span>
      {bars} bar{bars === 1 ? "" : "s"} changed in {diff.changedRows} line{diff.changedRows === 1 ? "" : "s"}
    </span>
  );
}

export default function BarDiff({ diff, className = "" }: { diff: ChartDiff; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 text-lg ${className}`}>
      <p className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-bb-cue-gray">
        <span>
          <i className="mr-1 inline-block size-3 border border-solid border-bb-chart-white align-middle" />
          new
        </span>
        <span>
          <i className="mr-1 inline-block size-3 border border-dashed border-bb-chart-white align-middle" />
          changed
        </span>
        <span>
          <i className="mr-1 inline-block size-3 border border-bb-rule-gray align-middle" />
          <s>removed</s>
        </span>
      </p>
      {diff.rows.map((r, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 px-1 py-1 ${r.state === "same" ? "opacity-45" : "bg-bb-case-charcoal"} ${
            r.state === "removed" ? "opacity-80" : ""
          }`}
        >
          <span className="w-16 shrink-0 pt-1 text-sm font-semibold text-bb-cue-gray">
            {r.label}
            {r.state === "added" && <span className="block text-bb-chart-white">new</span>}
            {r.state === "removed" && <span className="block text-bb-cue-gray">removed</span>}
          </span>
          <span className="flex min-w-0 flex-wrap gap-1">
            {r.cells.length === 0 && <span className="text-bb-cue-gray">—</span>}
            {r.cells.map((c, j) => (
              <span key={j} className={`flex min-w-11 flex-col items-center border px-1.5 leading-tight ${CELL[c.state]}`}>
                {r.state === "changed" && WORD[c.state] && <span className="text-sm font-normal text-bb-cue-gray">{WORD[c.state]}</span>}
                {c.state === "changed" && c.old !== null && <s className="text-sm text-bb-cue-gray">{c.old}</s>}
                <span className={c.state === "same" ? "py-0.5" : c.state === "removed" ? "py-0.5 font-bold line-through" : "py-0.5 font-bold"}>{c.text}</span>
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
