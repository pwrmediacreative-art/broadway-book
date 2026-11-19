// Saving from the Full song editor (Q17): keep the chart's own layout. The tap-to-build
// editor writes every chart its own way (header lines, rows of 4 bars); for a library chart
// that would make a suggestion's bar diff show rows the player never touched. `keepLayout`
// patches only what changed into the original text: unchanged sections stay byte for byte,
// a changed section keeps its row breaks (only the edited bars move), header values change in
// place. A new section, or one whose comments changed, is written the editor's way. If the
// result would read differently from what the editor holds, the editor's text is used.
import { parseChart } from "../chart/parse";
import { itemText, serializeChart } from "../chart/serialize";
import type { Line, Row, RowItem, Tag } from "../chart/types";
import { chunkRows, fromText, headerLines, type Header, type Part } from "./model";

type Op<T> = { kind: "keep"; a: T; ai: number; bi: number } | { kind: "del"; a: T; ai: number } | { kind: "ins"; b: T; bi: number };

/** Longest-common-subsequence edit script of a -> b (keys compared as strings). */
function script<T>(a: T[], b: T[], key: (x: T) => string): Op<T>[] {
  const ka = a.map(key);
  const kb = b.map(key);
  // Same start and end first, so one changed bar among many alike ("NC NC NC") pairs with
  // the bar it replaced instead of somewhere else in the run.
  let head = 0;
  while (head < a.length && head < b.length && ka[head] === kb[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && ka[a.length - 1 - tail] === kb[b.length - 1 - tail]) tail++;
  const n = a.length - tail;
  const m = b.length - tail;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= head; i--) for (let j = m - 1; j >= head; j--) L[i][j] = ka[i] === kb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: Op<T>[] = [];
  for (let k = 0; k < head; k++) out.push({ kind: "keep", a: a[k], ai: k, bi: k });
  let i = head;
  let j = head;
  while (i < n || j < m) {
    if (i < n && j < m && ka[i] === kb[j]) {
      out.push({ kind: "keep", a: a[i], ai: i++, bi: j++ });
    } else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) {
      out.push({ kind: "ins", b: b[j], bi: j++ });
    } else {
      out.push({ kind: "del", a: a[i], ai: i++ });
    }
  }
  for (let k = 0; k < tail; k++) out.push({ kind: "keep", a: a[n + k], ai: n + k, bi: m + k });
  return out;
}

const partKey = (p: Part) => JSON.stringify([p.label, p.items.map(itemText), p.comments]);
const tagKey = (t: Tag) => `${t.name}\u0000${t.value}`;

/** What a chart holds for players, as the editor reads it: header, sections in order with
 *  their bars and notes, and its "#" comments (where a comment sits between sections may differ). */
const model = (text: string) => {
  const m = fromText(text);
  const parts = m.parts.map((p) => [p.label, p.items.map(itemText)]);
  return JSON.stringify([m.header, parts, m.parts.flatMap((p) => p.comments).sort()]);
};

/** The editor's way of writing one section (used for new sections). */
const written = (p: Part): Line[] => [...p.comments.map((text) => ({ kind: "comment" as const, text })), { kind: "section", section: p.label, rows: chunkRows(p.items) }];

/** Header lines with changed values patched in place; other lines (blank, comments) kept. */
function patchHead(lines: Line[], before: Header, after: Header): Line[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return lines;
  const next = new Map<string, Tag>();
  for (const l of parseChart(headerLines(after).join("\n")).doc.lines) if (l.kind === "tags") for (const t of l.tags) next.set(t.name, t);
  const hadTime = lines.some((l) => l.kind === "tags" && l.tags.some((t) => t.name === "time"));
  if (!hadTime && next.get("time")?.value === "4/4") next.delete("time"); // the default, as before
  const used = new Set<string>();
  const out: Line[] = lines.map((l) => {
    if (l.kind !== "tags") return l;
    const tags = l.tags.flatMap((t) => {
      const n = next.get(t.name);
      if (!n || used.has(t.name)) return [];
      used.add(t.name);
      return [tagKey(n) === tagKey(t) ? t : n];
    });
    return { kind: "tags", tags };
  });
  const added = [...next.values()].filter((t) => !used.has(t.name));
  if (added.length) {
    const last = out.findLastIndex((l) => l.kind === "tags");
    if (last >= 0) out[last] = { kind: "tags", tags: [...(out[last] as Extract<Line, { kind: "tags" }>).tags, ...added] };
    else out.unshift({ kind: "tags", tags: added });
  }
  return out.filter((l) => l.kind !== "tags" || l.tags.length);
}

/** One changed section, its row breaks kept: kept bars stay where they were, a replaced bar
 *  takes its old place, new bars join the row of the bar before them. Null = write it anew. */
function patchSection(unit: Line[], before: Part, after: Part, prefix: number, trailing: number): Line[] | null {
  if (JSON.stringify(before.comments) !== JSON.stringify(after.comments)) return null;
  const same = (a: RowItem[], b: RowItem[]) => a.length === b.length && a.every((x, i) => itemText(x) === itemText(b[i]));
  // Where each bar or note of this section sits: [line in the unit, row in that line].
  const slots: [number, number][] = [];
  unit.forEach((l, li) => {
    if (l.kind === "section" || l.kind === "rows") l.rows.forEach((r, ri) => r.forEach(() => slots.push([li, ri])));
  });
  if (before.items.length !== prefix + slots.length + trailing) return null;
  const end = (items: RowItem[]) => items.slice(items.length - trailing);
  if (after.items.length < prefix + trailing) return null;
  if (!same(before.items.slice(0, prefix), after.items.slice(0, prefix)) || !same(end(before.items), end(after.items))) return null;
  const mid = (items: RowItem[]) => items.slice(prefix, items.length - trailing);
  const ops = script(mid(before.items), mid(after.items), itemText);
  if (!ops.some((o) => o.kind === "keep" || o.kind === "del")) return null; // nothing to anchor to
  const rows = new Map<string, RowItem[]>(); // "line.row" -> its new items
  const put = ([li, ri]: [number, number], it: RowItem) => {
    const k = `${li}.${ri}`;
    rows.set(k, [...(rows.get(k) ?? []), it]);
  };
  let prev: [number, number] | null = null; // slot of the last kept bar
  for (let i = 0; i < ops.length; ) {
    const o = ops[i];
    if (o.kind === "keep") {
      put((prev = slots[o.ai]), o.a);
      i++;
      continue;
    }
    // A run of changes between kept bars.
    const dels: number[] = [];
    const ins: RowItem[] = [];
    for (; i < ops.length && ops[i].kind !== "keep"; i++) {
      const x = ops[i];
      if (x.kind === "del") dels.push(x.ai);
      else if (x.kind === "ins") ins.push(x.b);
    }
    const nextKeep = ops.slice(i).find((x) => x.kind === "keep");
    ins.forEach((it, k) => {
      const at = dels.length ? slots[dels[Math.min(k, dels.length - 1)]] : (prev ?? (nextKeep?.kind === "keep" ? slots[nextKeep.ai] : null));
      if (at) put(at, it);
    });
  }
  return unit.flatMap((l, li): Line[] => {
    if (l.kind !== "section" && l.kind !== "rows") return [l];
    const kept: Row[] = l.rows.map((_, ri) => rows.get(`${li}.${ri}`) ?? []).filter((r) => r.length);
    if (l.kind === "section") return [{ kind: "section", section: after.label, rows: kept }];
    return kept.length ? [{ kind: "rows", rows: kept }] : [];
  });
}

/** The edited chart written in the original's layout (see the top of this file). */
export function keepLayout(original: string, edited: string): string {
  try {
    const lines = parseChart(original).doc.lines;
    const before = fromText(original);
    const after = fromText(edited);
    // One unit per section: the comments (and, after the first, tag lines) just above its
    // label belong to it, as the editor reads them; blank lines stay where they were.
    const starts: number[] = [];
    lines.forEach((l, s) => {
      if (l.kind !== "section") return;
      const floor = starts.length ? lines.findLastIndex((x, k) => k < s && (x.kind === "section" || x.kind === "rows")) + 1 : 0;
      let at = s;
      while (at > floor && (lines[at - 1].kind === "comment" || lines[at - 1].kind === "blank" || (starts.length > 0 && lines[at - 1].kind === "tags"))) at--;
      while (at < s && lines[at].kind === "blank") at++;
      starts.push(at);
    });
    if (!starts.length || starts.length !== before.parts.length) return edited;
    const head = lines.slice(0, starts[0]);
    const units = starts.map((at, i) => lines.slice(at, starts[i + 1] ?? lines.length));
    const tagCount = (ls: Line[]) => ls.reduce((n, l) => n + (l.kind === "tags" ? l.tags.length : 0), 0);
    const label = (u: Line[]) => u.findIndex((l) => l.kind === "section");
    // Tag lines above a label are its first items; the last section also keeps the ones after its bars.
    const prefix = (i: number) => tagCount(units[i].slice(0, label(units[i])));
    const trailing = (i: number) => (i === units.length - 1 ? tagCount(units[i].slice(label(units[i]))) : 0);

    const out: Line[] = [...patchHead(head, before.header, after.header)];
    const placed: { at: number; part: Part }[] = []; // where each edited section's label landed
    const emit = (ls: Line[], part: Part) => {
      placed.push({ at: out.length + ls.findIndex((l) => l.kind === "section"), part });
      out.push(...ls);
    };
    const ops = script(before.parts, after.parts, partKey);
    for (let i = 0; i < ops.length; ) {
      const o = ops[i];
      if (o.kind === "keep") {
        emit(units[o.ai], o.a);
        i++;
        continue;
      }
      const dels: number[] = [];
      const ins: Part[] = [];
      for (; i < ops.length && ops[i].kind !== "keep"; i++) {
        const x = ops[i];
        if (x.kind === "del") dels.push(x.ai);
        else if (x.kind === "ins") ins.push(x.b);
      }
      // Changed sections pair up in order with the ones they replace; the rest are new.
      ins.forEach((p, k) => {
        const d = dels[k];
        const kept = d === undefined ? null : patchSection(units[d], before.parts[d], p, prefix(d), trailing(d));
        emit(kept ?? written(p), p);
      });
    }
    // The editor files a comment under the section below it, but in the text it can sit inside
    // the section above. So a removed section's comment may linger, or one the edited chart
    // keeps may have gone with its neighbour: put back what's missing above the section that
    // owns it, then drop copies the edited chart no longer has (the last ones go first).
    const extra = new Map<string, number>();
    for (const l of out) if (l.kind === "comment") extra.set(l.text, (extra.get(l.text) ?? 0) + 1);
    for (const p of after.parts) for (const c of p.comments) extra.set(c, (extra.get(c) ?? 0) - 1);
    for (let k = placed.length - 1; k >= 0; k--) {
      const { at, part } = placed[k];
      const missing: Line[] = [];
      for (const text of part.comments) {
        const n = extra.get(text) ?? 0;
        if (n >= 0) continue;
        extra.set(text, n + 1);
        missing.push({ kind: "comment", text });
      }
      out.splice(at, 0, ...missing);
    }
    for (let k = out.length - 1; k >= 0; k--) {
      const l = out[k];
      if (l.kind === "comment" && (extra.get(l.text) ?? 0) > 0) {
        extra.set(l.text, extra.get(l.text)! - 1);
        out.splice(k, 1);
      }
    }
    const text = serializeChart({ version: 1, lines: out });
    return model(text) === model(edited) ? text : edited;
  } catch {
    return edited;
  }
}
