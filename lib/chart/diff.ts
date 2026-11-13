// Bar-by-bar diff of two charts, for suggestion pages, the editor and personal versions.
// Rows are what players read as one chart line (a section's rows split on |); cells are the
// bars and inline items in a row, written in canonical chart text ("1", "(4 5)", "\"stop\"").
import { parseChart } from "./parse";
import { itemText } from "./serialize";
import type { ChartDoc } from "./types";

export type DiffState = "same" | "added" | "removed" | "changed";
export interface DiffCell {
  text: string; // new text (old text for removed cells)
  old: string | null; // old text for changed cells
  state: DiffState;
}
export interface DiffRow {
  label: string; // "Header", "V2", "C x2", "C x2 ·" (2nd row of a section), "" (plain rows), "Note"
  state: DiffState;
  cells: DiffCell[];
}
export interface ChartDiff {
  rows: DiffRow[];
  changedBars: number; // cells that differ
  changedRows: number;
}

interface FlatRow {
  label: string;
  cells: string[];
}

export function flattenChart(doc: ChartDoc): FlatRow[] {
  const out: FlatRow[] = [];
  for (const line of doc.lines) {
    switch (line.kind) {
      case "blank":
        break;
      case "comment":
        out.push({ label: "Note", cells: [line.text] });
        break;
      case "tags":
        out.push({ label: "Header", cells: line.tags.map((t) => (t.value ? `{${t.name}: ${t.value}}` : `{${t.name}:}`)) });
        break;
      case "rows":
        line.rows.forEach((r) => out.push({ label: "", cells: r.map(itemText) }));
        break;
      case "section": {
        const { name, number, repeat } = line.section;
        const label = `${name}${number ?? ""}${repeat ? ` x${repeat}` : ""}`;
        if (!line.rows.length) out.push({ label, cells: [] });
        line.rows.forEach((r, i) => out.push({ label: i === 0 ? label : `${label} ·`, cells: r.map(itemText) }));
        break;
      }
    }
  }
  return out;
}

type Op<T> = { op: "same"; a: T; b: T } | { op: "del"; a: T } | { op: "ins"; b: T };

/** Longest-common-subsequence edit script. Charts are small (≤ a few hundred rows). */
function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): Op<T>[] {
  const n = a.length;
  const m = b.length;
  const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) t[i][j] = eq(a[i], b[j]) ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const ops: Op<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) ops.push({ op: "same", a: a[i++], b: b[j++] });
    else if (t[i + 1][j] >= t[i][j + 1]) ops.push({ op: "del", a: a[i++] });
    else ops.push({ op: "ins", b: b[j++] });
  }
  while (i < n) ops.push({ op: "del", a: a[i++] });
  while (j < m) ops.push({ op: "ins", b: b[j++] });
  return ops;
}

/** Walk an edit script; runs of deletions + insertions are paired up as "changed". */
function pairRuns<T, R>(
  ops: Op<T>[],
  emit: { same: (a: T, b: T) => R; changed: (a: T, b: T) => R; removed: (a: T) => R; added: (b: T) => R },
): R[] {
  const out: R[] = [];
  let dels: T[] = [];
  let ins: T[] = [];
  const flush = () => {
    const k = Math.min(dels.length, ins.length);
    for (let i = 0; i < k; i++) out.push(emit.changed(dels[i], ins[i]));
    dels.slice(k).forEach((d) => out.push(emit.removed(d)));
    ins.slice(k).forEach((x) => out.push(emit.added(x)));
    dels = [];
    ins = [];
  };
  for (const o of ops) {
    if (o.op === "del") dels.push(o.a);
    else if (o.op === "ins") ins.push(o.b);
    else {
      flush();
      out.push(emit.same(o.a, o.b));
    }
  }
  flush();
  return out;
}

function diffCells(a: string[], b: string[]): DiffCell[] {
  return pairRuns<string, DiffCell>(lcs(a, b, (x, y) => x === y), {
    same: (_, y) => ({ text: y, old: null, state: "same" }),
    changed: (x, y) => ({ text: y, old: x, state: "changed" }),
    removed: (x) => ({ text: x, old: null, state: "removed" }),
    added: (y) => ({ text: y, old: null, state: "added" }),
  });
}

const rowKey = (r: FlatRow) => r.label + "\u0000" + r.cells.join(" ");

export function diffDocs(oldDoc: ChartDoc, newDoc: ChartDoc): ChartDiff {
  const rows = pairRuns<FlatRow, DiffRow>(
    lcs(flattenChart(oldDoc), flattenChart(newDoc), (x, y) => rowKey(x) === rowKey(y)),
    {
      same: (_, y) => ({ label: y.label, state: "same", cells: y.cells.map((text) => ({ text, old: null, state: "same" })) }),
      changed: (x, y) => ({ label: y.label, state: "changed", cells: diffCells(x.cells, y.cells) }),
      removed: (x) => ({ label: x.label, state: "removed", cells: x.cells.map((text) => ({ text, old: null, state: "removed" })) }),
      added: (y) => ({ label: y.label, state: "added", cells: y.cells.map((text) => ({ text, old: null, state: "added" })) }),
    },
  );
  let changedBars = 0;
  let changedRows = 0;
  for (const r of rows) {
    if (r.state === "same") continue;
    changedRows++;
    changedBars += r.cells.filter((c) => c.state !== "same").length;
  }
  return { rows, changedBars, changedRows };
}

/** Diff two chart texts. Throws ChartParseError if either doesn't parse. */
export function diffCharts(oldText: string, newText: string): ChartDiff {
  return diffDocs(parseChart(oldText).doc, parseChart(newText).doc);
}
