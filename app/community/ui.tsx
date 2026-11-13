// Small shared bits for community pages.

const FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function when(iso: string | null | undefined) {
  return iso ? FMT.format(new Date(iso)) : "";
}

export type ProposalStatus = "open" | "approved" | "rejected" | "withdrawn";

const PILL: Record<string, [string, string]> = {
  open: ["Open", "bg-sky-400/20 text-sky-200"],
  stale: ["Out of date", "bg-amber-400/20 text-amber-200"],
  approved: ["Merged", "bg-emerald-400/20 text-emerald-200"],
  rejected: ["Closed", "bg-red-400/20 text-red-200"],
  withdrawn: ["Withdrawn", "bg-panel text-muted"],
};

export function StatusPill({ status, stale }: { status: string; stale?: boolean }) {
  const [label, cls] = PILL[status === "open" && stale ? "stale" : status] ?? PILL.open;
  return <span className={`inline-block rounded px-2 py-0.5 text-sm font-semibold uppercase tracking-wide ${cls}`}>{label}</span>;
}

export const SOURCE_LABEL: Record<string, string> = {
  import: "Imported",
  ai: "Imported", // players never see how an import was read
  human: "Edited",
  community: "Community",
};

export const btn = {
  primary: "inline-flex min-h-12 items-center justify-center rounded-xl bg-accent px-5 text-lg font-bold text-black active:opacity-80 disabled:opacity-40",
  ghost: "inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-panel px-4 text-lg active:bg-line disabled:opacity-40",
  danger: "inline-flex min-h-12 items-center justify-center rounded-xl border border-red-500/60 px-4 text-lg text-red-300 active:bg-red-500/20 disabled:opacity-40",
  link: "inline-flex min-h-11 items-center text-lg text-accent",
};

/** Shown next to trusted reviewers' names on community pages. */
export function ReviewerBadge({ on }: { on: boolean | null | undefined }) {
  if (!on) return null;
  return (
    <span className="ml-1 inline-block rounded bg-sky-400/20 px-1.5 py-0.5 align-middle text-xs font-semibold uppercase tracking-wide text-sky-200">
      Reviewer
    </span>
  );
}
