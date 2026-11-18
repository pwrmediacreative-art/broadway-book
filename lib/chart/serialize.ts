import type { BeatItem, ChartDoc, Degree, Line, Row, RowItem, SectionLabel, Tag } from "./types";

export function degreeText(d: Degree): string {
  return `${d.acc}${d.degree}`;
}

export function beatText(b: BeatItem): string {
  if (b.kind === "repeat") return "%";
  let core = b.kind === "nc" ? "NC" : degreeText(b.root) + b.quality;
  if (b.kind === "chord" && b.bass) core += "/" + degreeText(b.bass);
  if (b.diamond) core = `<${core}>`;
  if (b.push) core = "^" + core;
  if (b.end === "fermata") core += "~";
  if (b.end === "stop") core += "!";
  return core;
}

const tagText = (t: Tag) => (t.value ? `{${t.name}: ${t.value}}` : `{${t.name}:}`);

export function itemText(item: RowItem): string {
  switch (item.kind) {
    case "split":
      return `(${item.beats.map(beatText).join(" ")})`;
    case "dynamic":
      return item.value === "cresc" ? "<<" : ">>";
    case "cue":
      return `"${item.text}"`;
    case "tag":
      return tagText(item);
    case "box":
      return `"[${item.text}]"`;
    case "repeatSign":
      return item.side === "start" ? "|:" : item.text ? `:|"${item.text}"` : ":|";
    default:
      return beatText(item);
  }
}

/** The text inside a section label's brackets: `V2 x2`, `"Big ending"`, `"Breakdown"2`. */
export function labelText({ name, custom, number, repeat }: SectionLabel): string {
  return `${custom ? `"${name}"` : name}${number ?? ""}${repeat ? ` x${repeat}` : ""}`;
}

/** A section label as players read it: `V2 x2`, `Big ending`, `Breakdown 2 x2`. */
export function labelShown({ name, custom, number, repeat }: SectionLabel): string {
  return `${name}${number != null ? (custom ? ` ${number}` : number) : ""}${repeat ? ` x${repeat}` : ""}`;
}

const rowsText = (rows: Row[]) => rows.map((r) => r.map(itemText).join(" ")).join(" | ");

function lineText(line: Line): string {
  switch (line.kind) {
    case "blank":
      return "";
    case "comment":
      return line.text ? `# ${line.text}` : "#";
    case "tags":
      return line.tags.map(tagText).join(" ");
    case "rows":
      return rowsText(line.rows);
    case "section": {
      const label = `[${labelText(line.section)}]`;
      return line.rows.length ? `${label} ${rowsText(line.rows)}` : label;
    }
  }
}

/** Canonical text. serializeChart(parseChart(t).doc) === t for canonical t. */
export function serializeChart(doc: ChartDoc): string {
  return doc.lines.map(lineText).join("\n") + "\n";
}
