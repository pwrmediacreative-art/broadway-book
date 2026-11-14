import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { canonKey, countFilters, facets, isVerified, matches, NO_FILTERS, parseState, sortDocs, stateQuery, type Filters } from "./browse";
import { createEngine } from "./engine";
import { packIndex, unpackIndex, type IndexRow } from "./pack";

const row = (title: string, artist: string | null, extra: Partial<IndexRow> = {}): IndexRow => ({
  slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  title,
  artist,
  key: null,
  bpm: null,
  time_sig: null,
  feel: null,
  tags: [],
  is_example: false,
  ...extra,
});

const REAL: IndexRow[] = [
  row("Wagon Wheel", "Darius Rucker", { key: "A", bpm: 74, time_sig: "4/4", tags: ["country", "singalong"] }),
  row("Friends in Low Places", "Garth Brooks", { key: "A", bpm: 132, feel: "shuffle", tags: ["country", "90s"] }),
  row("Don't Rock the Jukebox", "Alan Jackson", { key: "D", bpm: 156, feel: "two-step", tags: ["90s"] }),
  row("Boot Scootin' Boogie", "Brooks & Dunn", { key: "A#", bpm: 150, feel: "shuffle" }),
  row("Tennessee Whiskey", "Chris Stapleton", { key: "A", bpm: 48, time_sig: "6/8", tags: ["slow"] }),
  row("Mr. Brightside", "The Killers", { key: "Db", bpm: 148 }),
  row("Jolene", "Dolly Parton", { key: "C#m", bpm: 110 }),
  row("Folsom Prison Blues", "Johnny Cash", { key: "E", feel: "train beat" }),
  row("Hey Jude", "The Beatles", { key: "F" }),
];
const docs = unpackIndex(JSON.parse(JSON.stringify(packIndex(REAL))))!;
const engine = createEngine(docs);
const top = (q: string) => engine.search(q)?.[0];

describe("search", () => {
  it("finds songs despite typos", () => {
    expect(top("wagin wheel")).toBe("wagon-wheel");
    expect(top("wagon wheal")).toBe("wagon-wheel");
    expect(top("frends in lo places")).toBe("friends-in-low-places");
    expect(top("tenesee whiskey")).toBe("tennessee-whiskey");
    expect(top("stapelton")).toBe("tennessee-whiskey");
    expect(top("jolenne")).toBe("jolene");
    expect(top("dolly parten")).toBe("jolene");
  });

  it("matches partial words and either order", () => {
    expect(top("wag")).toBe("wagon-wheel");
    for (const partial of ["wagi", "wagin", "wagin w", "wagin whe"]) expect(top(partial)).toBe("wagon-wheel");
    expect(top("rucker wagon")).toBe("wagon-wheel");
    expect(top("wagon rucker")).toBe("wagon-wheel");
    expect(top("garth friends")).toBe("friends-in-low-places");
    expect(top("folsom cash")).toBe("folsom-prison-blues");
  });

  it("ignores apostrophes, accents and &", () => {
    expect(top("dont rock")).toBe("don-t-rock-the-jukebox");
    expect(top("boot scootin")).toBe("boot-scootin-boogie");
    expect(top("brooks and dunn")).toBe("boot-scootin-boogie");
    expect(top("brooks dunn")).toBe("boot-scootin-boogie");
  });

  it("returns null for an empty query", () => {
    expect(engine.search("  ")).toBeNull();
  });
});

describe("index file", () => {
  it("round-trips every field and drops empties", () => {
    const packed = packIndex(REAL);
    expect(packed.s[8]).toEqual(["hey-jude", "Hey Jude", "The Beatles", "F"]);
    expect(docs[0]).toEqual({
      slug: "wagon-wheel",
      title: "Wagon Wheel",
      artist: "Darius Rucker",
      key: "A",
      bpm: 74,
      time: "4/4",
      feel: null,
      tags: ["country", "singalong"],
      ex: false,
      uv: false,
    });
    expect(unpackIndex({ v: 2, s: [] })).toBeNull();
  });

  it("carries the unverified flag", () => {
    const row = { ...REAL[0], unverified: true };
    const [d] = unpackIndex(JSON.parse(JSON.stringify(packIndex([row]))))!;
    expect(d.uv).toBe(true);
    expect(packIndex([row]).s[0]).toHaveLength(10);
  });
});

const f = (x: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...x });
const pick = (x: Partial<Filters>) => docs.filter((d) => matches(d, f(x))).map((d) => d.slug);

describe("filters", () => {
  it("merges enharmonic keys but keeps minor apart", () => {
    expect(canonKey("A#")).toBe("Bb");
    expect(canonKey("Bb")).toBe("Bb");
    expect(canonKey("Dbm")).toBe("C#m");
    expect(canonKey("C#-")).toBe("C#m");
    expect(canonKey("A")).not.toBe(canonKey("Am"));
    expect(pick({ keys: ["Bb"] })).toEqual(["boot-scootin-boogie"]);
    expect(pick({ keys: ["C#m"] })).toEqual(["jolene"]);
  });

  it("tempo bands and custom range", () => {
    expect(pick({ tempos: ["slow"] })).toEqual(["wagon-wheel", "tennessee-whiskey"]);
    expect(pick({ tempos: ["medium"] })).toEqual(["jolene"]);
    expect(pick({ bpmMin: 140, bpmMax: 155 })).toEqual(["boot-scootin-boogie", "mr-brightside"]);
  });

  it("combines groups with AND, values with OR", () => {
    expect(pick({ keys: ["A"], tags: ["country"] })).toEqual(["wagon-wheel", "friends-in-low-places"]);
    expect(pick({ keys: ["A"], tempos: ["fast"] })).toEqual(["friends-in-low-places"]);
    expect(pick({ feels: ["shuffle", "train beat"] })).toEqual([
      "friends-in-low-places",
      "boot-scootin-boogie",
      "folsom-prison-blues",
    ]);
  });

  it("keeps songs with missing data when that filter is off", () => {
    expect(pick({})).toHaveLength(docs.length);
    expect(pick({ keys: ["F"] })).toEqual(["hey-jude"]); // no BPM, feel or tags
    expect(pick({ tempos: ["slow"] })).not.toContain("hey-jude");
  });

  it("builds facets from the data", () => {
    const fx = facets(docs);
    expect(fx.tags.slice(0, 2)).toEqual([{ value: "90s", count: 2 }, { value: "country", count: 2 }]);
    expect(fx.feels.map((x) => x.value)).toEqual(["shuffle", "train beat", "two-step"]);
    expect(fx.keys.map((x) => x.value)).toEqual(["Db", "C#m", "D", "E", "F", "A", "Bb"]);
  });
});

describe("verified only", () => {
  const base = { slug: "a", title: "A", artist: null, key: "G", bpm: null, time: null, feel: null, tags: [] };
  const verified = { ...base, ex: false, uv: false };
  const unverified = { ...base, slug: "b", ex: false, uv: true };
  const example = { ...base, slug: "c", ex: true, uv: false };
  it("off by default: nothing is hidden", () => {
    expect([verified, unverified, example].filter((d) => matches(d, NO_FILTERS))).toHaveLength(3);
    expect(countFilters(NO_FILTERS)).toBe(0);
  });
  it("on: only charts an admin checked (unverified charts and examples are hidden)", () => {
    const on = f({ verified: true });
    expect([verified, unverified, example].filter((d) => matches(d, on)).map((d) => d.slug)).toEqual(["a"]);
    expect(isVerified(verified) && !isVerified(unverified) && !isVerified(example)).toBe(true);
    expect(countFilters(on)).toBe(1);
  });
  it("combines with the key filter and survives the URL", () => {
    expect(matches(verified, f({ verified: true, keys: ["A"] }))).toBe(false);
    const s = parseState("verified=1&key=G");
    expect(s.f.verified).toBe(true);
    expect(parseState(stateQuery(s))).toEqual(s);
    expect(parseState("verified=yes").f.verified).toBe(false);
  });
  it("does not change the result order: status plays no part in sorting", () => {
    const list = [
      { ...verified, slug: "v", title: "Bravo" },
      { ...unverified, slug: "u", title: "Alpha" },
      { ...example, slug: "e", title: "Charlie" },
    ];
    expect(sortDocs(list, "title", false, new Map()).map((d) => d.slug)).toEqual(["u", "v", "e"]);
    expect(sortDocs(list, "best", true, new Map()).map((d) => d.slug)).toEqual(["v", "u", "e"]); // search rank kept as is
  });
});

describe("sort", () => {
  const order = (s: Parameters<typeof sortDocs>[1]) => sortDocs(docs, s, false, new Map()).map((d) => d.slug);
  it("sorts by BPM with missing last both ways", () => {
    expect(order("bpm").slice(0, 2)).toEqual(["tennessee-whiskey", "wagon-wheel"]);
    expect(order("bpm-desc").slice(0, 2)).toEqual(["don-t-rock-the-jukebox", "boot-scootin-boogie"]);
    expect(order("bpm").slice(-2)).toEqual(order("bpm-desc").slice(-2));
  });
  it("sorts by recently viewed", () => {
    const recent = new Map([["jolene", 2], ["hey-jude", 1]]);
    expect(sortDocs(docs, "recent", false, recent).slice(0, 2).map((d) => d.slug)).toEqual(["jolene", "hey-jude"]);
  });
});

describe("URL state", () => {
  it("round-trips filters, sort and search", () => {
    const qs = "q=wagon&view=az&key=Bb&key=Am&tempo=slow&bpm=90-&time=6%2F8&feel=shuffle&tag=90s&sort=bpm-desc";
    const s = parseState(qs);
    expect(s.f).toEqual({
      keys: ["Bb", "Am"],
      tempos: ["slow"],
      bpmMin: 90,
      bpmMax: null,
      times: ["6/8"],
      feels: ["shuffle"],
      tags: ["90s"],
      verified: false,
    });
    expect(parseState(stateQuery(s))).toEqual(s);
  });
  it("ignores junk", () => {
    expect(parseState("sort=nope&tempo=lightning&key=H&bpm=abc").f).toEqual(NO_FILTERS);
  });
});

// ── ~1,900 songs: speed + size ──────────────────────────────────────────────
const WORDS =
  "love heart night road whiskey river town girl truck dirt beer honky tonk blue moon summer rain fire home country boots dance kiss small long gone wild heaven angel highway cowboy southern sweet tennessee rodeo sunset barroom lonely broken good time old new red".split(
    " ",
  );
const FIRST = "Garth Alan George Dolly Reba Shania Luke Morgan Chris Kenny Tim Faith Willie Merle Johnny Brad Carrie Miranda Blake Eric".split(" ");
const LAST = "Brooks Jackson Strait Parton McEntire Twain Combs Wallen Bryan Chesney McGraw Hill Nelson Haggard Stevens Paisley Underwood Lambert Shelton Church".split(" ");
const KEYS = ["G", "A", "E", "D", "C", "F", "Bb", "Am", "Em", "B", "Eb", null];
const FEELS = ["shuffle", "two-step", "train beat", "straight", "half time", null, null];
const TAGS = ["country", "90s", "2000s", "classic", "rock", "singalong", "ballad", "outlaw", "pop", "christmas"];

function dummy(n: number): IndexRow[] {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const pickOne = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  return Array.from({ length: n }, (_, i) => {
    const title = Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => pickOne(WORDS))
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ");
    return {
      slug: `${title.toLowerCase().replace(/ /g, "-")}-${i}`,
      title,
      artist: `${pickOne(FIRST)} ${pickOne(LAST)}`,
      key: pickOne(KEYS),
      bpm: rnd() < 0.85 ? 60 + Math.floor(rnd() * 120) : null,
      time_sig: rnd() < 0.8 ? pickOne(["4/4", "4/4", "4/4", "3/4", "6/8"]) : null,
      feel: pickOne(FEELS),
      tags: Array.from(new Set(Array.from({ length: Math.floor(rnd() * 3) }, () => pickOne(TAGS)))),
      is_example: false,
    };
  });
}

describe("1,900 songs", () => {
  const rows = [...dummy(1900 - REAL.length), ...REAL];
  const json = JSON.stringify(packIndex(rows));
  const big = unpackIndex(JSON.parse(json))!;

  it("index stays small", () => {
    const gz = gzipSync(json).length;
    console.log(`[index] ${rows.length} songs: ${(json.length / 1024).toFixed(1)} KB raw, ${(gz / 1024).toFixed(1)} KB gzipped`);
    expect(json.length).toBeLessThan(250 * 1024);
    expect(gz).toBeLessThan(60 * 1024);
  });

  it("search + filter + sort per keystroke well under 100ms (25ms here = 4x headroom for a mid-range phone)", () => {
    const t0 = performance.now();
    const e = createEngine(big);
    const buildMs = performance.now() - t0;

    // Type each query one letter at a time, like a player would.
    const queries = ["wagin wheel", "frends in low", "garth", "honky tonk", "stapelton whiskey", "rucker wagon"];
    const times: number[] = [];
    for (const q of queries)
      for (let i = 1; i <= q.length; i++) {
        const s = performance.now();
        const set = new Set(e.search(q.slice(0, i)) ?? []);
        const hits = big.filter((d) => set.has(d.slug) && matches(d, f({ tempos: ["slow", "medium"] })));
        sortDocs(hits, "best", true, new Map());
        times.push(performance.now() - s);
      }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    console.log(
      `[speed] build ${buildMs.toFixed(1)}ms, ${times.length} keystrokes: median ${times[times.length >> 1].toFixed(2)}ms, p95 ${p95.toFixed(2)}ms, max ${times[times.length - 1].toFixed(2)}ms`,
    );
    expect(buildMs).toBeLessThan(100);
    expect(p95).toBeLessThan(25);
    expect(e.search("wagin wheel")?.[0]).toBe("wagon-wheel");
    expect(e.search("stapelton whiskey")?.[0]).toBe("tennessee-whiskey");
  });
});
