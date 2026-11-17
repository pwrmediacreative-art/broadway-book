// The song's road map for the Whole song view: "I V C V C B C×2 O", built from the chart.
import type { ChartView } from "./view";

const SHORT: Record<string, string> = {
  intro: "I",
  verse: "V",
  chorus: "C",
  bridge: "B",
  outro: "O",
  ending: "End",
  instrumental: "Inst",
  interlude: "Int",
  turnaround: "TA",
  prechorus: "Pre",
  "pre-chorus": "Pre",
};

export interface RoadStop {
  label: string; // short label, number kept ("V2")
  repeat: number; // ×N when over 1
}

/** One stop per section, in order. Long names are shortened; numbers and repeats are kept. */
export function roadMap(view: Pick<ChartView, "sections">): RoadStop[] {
  return view.sections.map((s) => {
    const base = s.label.replace(/ x\d+$/, "").trim();
    const m = /^([A-Za-z-]+?)(\d*)$/.exec(base);
    const word = m ? m[1] : base;
    const short = SHORT[word.toLowerCase()];
    return { label: short ? short + (m?.[2] ?? "") : base, repeat: s.repeat };
  });
}

export const roadText = (stops: RoadStop[]) => stops.map((s) => (s.repeat > 1 ? `${s.label}×${s.repeat}` : s.label)).join(" ");
