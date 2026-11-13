import type { ChartDiff, DiffCell } from "@/lib/chart";

// Inline bar-by-bar diff. Changed bars show the new value with the old one struck out
// above it; added bars are green, removed bars red and struck out. Unchanged rows are dimmed.

const CELL: Record<DiffCell["state"], string> = {
  same: "border-transparent",
  changed: "border-amber-400 bg-amber-400/15 text-amber-200",
  added: "border-emerald-400 bg-emerald-400/15 text-emerald-200",
  removed: "border-red-400 bg-red-400/10 text-red-300 line-through",
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
    <div className={`flex flex-col gap-1 font-mono text-lg ${className}`}>
      <p className="mb-1 flex flex-wrap gap-x-4 gap-y-1 font-sans text-sm text-muted">
        <span>
          <i className="mr-1 inline-block size-3 rounded-sm bg-amber-400 align-middle" />
          changed
        </span>
        <span>
          <i className="mr-1 inline-block size-3 rounded-sm bg-emerald-400 align-middle" />
          added
        </span>
        <span>
          <i className="mr-1 inline-block size-3 rounded-sm bg-red-400 align-middle" />
          removed
        </span>
      </p>
      {diff.rows.map((r, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 rounded-lg px-1 py-1 ${r.state === "same" ? "opacity-45" : "bg-panel"} ${
            r.state === "removed" ? "opacity-80" : ""
          }`}
        >
          <span className="w-16 shrink-0 pt-1 font-sans text-sm font-semibold text-muted">
            {r.label}
            {r.state === "added" && <span className="block text-emerald-300">new</span>}
            {r.state === "removed" && <span className="block text-red-300">gone</span>}
          </span>
          <span className="flex min-w-0 flex-wrap gap-1">
            {r.cells.length === 0 && <span className="text-muted">—</span>}
            {r.cells.map((c, j) => (
              <span key={j} className={`flex min-w-11 flex-col items-center rounded-md border-2 px-1.5 leading-tight ${CELL[c.state]}`}>
                {c.state === "changed" && c.old !== null && <s className="text-sm text-red-300/90">{c.old}</s>}
                <span className={c.state === "same" ? "py-0.5" : "py-0.5 font-bold"}>{c.text}</span>
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
