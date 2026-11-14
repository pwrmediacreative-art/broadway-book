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
  open: ["Open", ""],
  stale: ["Out of date", ""],
  approved: ["Merged", ""],
  rejected: ["Closed", "bb-chip-error"],
  withdrawn: ["Withdrawn", "bb-chip-muted"],
};

export function StatusPill({ status, stale }: { status: string; stale?: boolean }) {
  const [label, cls] = PILL[status === "open" && stale ? "stale" : status] ?? PILL.open;
  return <span className={`bb-chip ${cls}`}>{label}</span>;
}

export const SOURCE_LABEL: Record<string, string> = {
  import: "Imported",
  ai: "Imported", // players never see how an import was read
  human: "Edited",
  community: "Community",
};

export const btn = {
  primary: "bb-btn bb-btn-primary px-5 text-lg",
  ghost: "bb-btn bb-btn-secondary px-4 text-lg",
  danger: "bb-btn bb-btn-danger px-4 text-lg",
  link: "inline-flex min-h-11 items-center text-lg text-bb-chart-white underline underline-offset-4",
};

/** Shown next to trusted reviewers' names on community pages. */
export function ReviewerBadge({ on }: { on: boolean | null | undefined }) {
  if (!on) return null;
  return (
    <span className="bb-chip ml-1 align-middle">
      Reviewer
    </span>
  );
}
