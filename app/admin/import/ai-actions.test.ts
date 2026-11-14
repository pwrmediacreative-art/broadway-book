// The full-batch loop (batchStep) against a fake database and a fake Anthropic client.
// Nothing here reaches Supabase, Dropbox or Anthropic. The database rules themselves
// (cap, never twice, first-chunk gate) are checked for real by `npm run check:batch`.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface File {
  id: string;
  size: number;
}
interface Reading {
  id: string;
  file: File;
  status: string;
  mode: string;
  batch_id: string | null;
}

const db = {
  files: [] as File[],
  readings: [] as Reading[],
  firstChunkOk: false,
  cap: 80,
  est: 0.1,
  spent: 0,
};
const anthropic = { batches: [] as { id: string; ids: string[] }[], ended: true };

function fakeDb() {
  const readable = (f: File) => !db.readings.some((r) => r.file.id === f.id);
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    switch (name) {
      case "ai_expire_stale":
        return { data: 0, error: null };
      case "ai_candidates":
        return { data: db.files.filter(readable).map((f) => ({ id: f.id, file_name: f.id, size: f.size })), error: null };
      case "ai_reserve": {
        const items = args.p_items as { import_file_id: string }[];
        const reserved = [];
        let capped = false;
        for (const it of items) {
          const f = db.files.find((x) => x.id === it.import_file_id)!;
          if (!readable(f)) continue;
          if (db.spent + db.est > db.cap) {
            capped = true;
            break;
          }
          db.spent += db.est;
          const r = { id: `r-${f.id}`, file: f, status: "reserved", mode: String(args.p_mode), batch_id: null };
          db.readings.push(r);
          reserved.push({ reading_id: r.id, dropbox: f.id, file_name: f.id, size: f.size });
        }
        return { data: { reserved, capped, skipped: 0, spent: db.spent }, error: null };
      }
      case "ai_mark_submitted":
        for (const r of db.readings)
          if ((args.p_ids as string[]).includes(r.id)) Object.assign(r, { status: "submitted", batch_id: args.p_batch_id });
        return { data: 1, error: null };
      case "ai_finish": {
        const r = db.readings.find((x) => x.id === args.p_id)!;
        r.status = String(args.p_status);
        return { data: r.status, error: null };
      }
      case "ai_release":
        return { data: 0, error: null };
      default:
        throw new Error(`unexpected rpc ${name}`);
    }
  };
  const from = (table: string) => {
    const q = { filters: {} as Record<string, string>, head: false };
    const run = () => {
      if (table === "ai_state") return { data: { first_chunk_ok_at: db.firstChunkOk ? "now" : null }, error: null };
      const rows = db.readings.filter((r) => Object.entries(q.filters).every(([k, v]) => r[k as keyof Reading] === v));
      if (q.head) return { count: rows.length, data: null, error: null };
      const out = rows.map((r) => ({
        ...r,
        import_files: { dropbox_file_id: r.file.id, dropbox_path: r.file.id, file_name: r.file.id, size_bytes: r.file.size },
      }));
      return { data: out, error: null };
    };
    const chain = {
      select(_cols: string, opts?: { head?: boolean }) {
        q.head = Boolean(opts?.head);
        return chain;
      },
      eq(k: string, v: string) {
        q.filters[k] = v;
        return chain;
      },
      single: async () => run(),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return chain;
  };
  return { rpc, from };
}

vi.mock("next/cache", () => ({ revalidatePath: () => {}, updateTag: () => {} }));
vi.mock("@/lib/supabase/server", () => ({ SONGS_TAG: "songs" }));
vi.mock("@/lib/dropbox/client", () => ({ dropboxConfigured: () => true }));
vi.mock("@/lib/supabase/session", () => ({
  getCurrentUser: async () => ({ role: "admin" }),
  sessionClient: async () => fakeDb(),
}));
vi.mock("@/lib/ai/cost", () => import("../../../lib/ai/cost"));
vi.mock("@/lib/ai/pick", () => import("../../../lib/ai/pick"));
vi.mock("@/lib/ai/prompt", () => ({ AI_MODEL: "fake-model" }));
vi.mock("@/lib/ai/result", () => import("../../../lib/ai/result"));
vi.mock("@/lib/ai/reader", () => ({
  aiConfigured: () => true,
  spendCap: () => db.cap,
  downloadPdf: async () => "JVBERi0=",
  requestParams: () => ({}),
  readNow: async () => ({ status: "ok", payload: {} }),
  createBatch: async (items: { id: string }[]) => {
    const id = `batch-${anthropic.batches.length + 1}`;
    anthropic.batches.push({ id, ids: items.map((i) => i.id) });
    return id;
  },
  batchEnded: async () => anthropic.ended,
  batchResults: async (id: string) =>
    (async function* () {
      for (const custom_id of anthropic.batches.find((b) => b.id === id)!.ids)
        yield { custom_id, result: { type: "succeeded", message: {} } };
    })(),
  finishReading: async () => ({ status: "ok", payload: { cost_usd: 0.03 } }),
}));

const { batchStep } = await import("./ai-actions");

const MB = 1024 * 1024;
beforeEach(() => {
  db.files = Array.from({ length: 300 }, (_, i) => ({ id: `f${String(i).padStart(3, "0")}`, size: 300_000 }));
  db.readings = [];
  db.firstChunkOk = false;
  db.cap = 80;
  db.spent = 0;
  anthropic.batches = [];
  anthropic.ended = true;
});

describe("batchStep", () => {
  it("sends one chunk of 25, saves its results, then pauses for the first-chunk check", async () => {
    const s1 = await batchStep({});
    expect(s1.error).toBeUndefined();
    expect(anthropic.batches).toHaveLength(1);
    expect(anthropic.batches[0].ids).toHaveLength(25);
    expect(s1.more).toBe(true);

    const s2 = await batchStep({});
    expect(db.readings.filter((r) => r.status === "ok")).toHaveLength(25); // saved as they came back
    expect(anthropic.batches).toHaveLength(1); // nothing more sent
    expect(s2.paused).toBe(true);
    expect(s2.more).toBe(false);
    expect(s2.open).toBe(0); // the page's loop stops here
  });

  it("after the check, keeps at most 8 batches out and never sends a file twice", async () => {
    db.firstChunkOk = true;
    anthropic.ended = false; // batches take a while
    let last = await batchStep({});
    for (let i = 0; i < 12 && last.more; i++) last = await batchStep({});
    expect(anthropic.batches).toHaveLength(8);
    expect(last.more).toBe(false);
    expect(last.open).toBe(8); // the loop keeps polling every 30 s
    anthropic.ended = true;
    for (let i = 0; i < 20 && (last.more || last.open); i++) last = await batchStep({});
    const sent = anthropic.batches.flatMap((b) => b.ids);
    expect(new Set(sent).size).toBe(sent.length);
    expect(sent).toHaveLength(300);
    expect(db.readings.every((r) => r.status === "ok")).toBe(true);
  });

  it("caps a chunk at 100 MB of PDFs", async () => {
    db.firstChunkOk = true;
    db.files = Array.from({ length: 10 }, (_, i) => ({ id: `big${i}`, size: 30 * MB }));
    await batchStep({});
    expect(anthropic.batches[0].ids).toHaveLength(3);
  });

  it("stops at the spending cap", async () => {
    db.firstChunkOk = true;
    db.cap = 1; // room for 10 worst cases at $0.10
    const s = await batchStep({});
    expect(anthropic.batches[0].ids).toHaveLength(10);
    expect(s.capped).toBe(true);
    expect(s.more).toBe(false);
    expect(s.summary).toMatch(/cap/);
  });

  it("resumes where it left off after a stop", async () => {
    db.firstChunkOk = true;
    await batchStep({});
    await batchStep({}); // "Stop" here, then press Resume: the same function runs again
    const before = anthropic.batches.flatMap((b) => b.ids);
    await batchStep({});
    const after = anthropic.batches.flatMap((b) => b.ids);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(new Set(after).size).toBe(after.length);
  });
});
