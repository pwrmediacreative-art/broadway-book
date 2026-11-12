// Blocker check for the Dropbox import. Creates two throwaway users (contributor + admin),
// checks that only admins reach the import functions, then checks the inventory against
// Dropbox itself: every PDF counted once, no duplicate rows or songs. Deletes both users.
// Run: npm run check:import                       (database + Dropbox)
//      BASE_URL=http://localhost:3000 npm run check:import   (also /admin/import + View PDF)
// Needs the Supabase keys (incl. SUPABASE_SERVICE_ROLE_KEY) and the DROPBOX_* keys.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const baseUrl = process.env.BASE_URL?.replace(/\/$/, "");
const folder = process.env.DROPBOX_FOLDER_PATH || "/Nashville Number Charts 2";
if (!url || !anonKey || !serviceKey) throw new Error("Set the Supabase keys in .env.local");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(url, serviceKey, opts);
const ref = new URL(url).hostname.split(".")[0];

let failed = 0;
const pass = (m) => console.log("PASS", m);
const fail = (m) => { failed++; console.log("FAIL", m); };
const expectErr = (r, m) => (r.error ? pass(`${m} (${r.error.code})`) : fail(`${m}: NOT blocked`));
const expectNone = (r, m) => (r.error || r.data.length === 0 ? pass(m) : fail(`${m}: saw ${r.data.length} row(s)`));

async function makeUser(tag) {
  const email = `import-check-${tag}-${Date.now()}@example.com`;
  const created = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const db = createClient(url, anonKey, opts);
  const v = await db.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (v.error) throw v.error;
  return { id: created.data.user.id, db, session: v.data.session };
}

function authCookie(session) {
  const name = `sb-${ref}-auth-token`;
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const max = 3180;
  if (value.length <= max) return `${name}=${value}`;
  const parts = [];
  for (let i = 0; i * max < value.length; i++) parts.push(`${name}.${i}=${value.slice(i * max, (i + 1) * max)}`);
  return parts.join("; ");
}

/** Count PDFs straight from Dropbox (independent of the app's code). */
async function dropboxPdfCount() {
  const { DROPBOX_APP_KEY: k, DROPBOX_APP_SECRET: s, DROPBOX_REFRESH_TOKEN: r } = process.env;
  if (!k || !s || !r) return null;
  const tok = await fetch("https://api.dropbox.com/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${k}:${s}`).toString("base64") },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: r }),
  }).then((x) => x.json());
  const call = (ep, body) =>
    fetch(`https://api.dropboxapi.com/2/files/${ep}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((x) => x.json());
  let page = await call("list_folder", { path: folder, recursive: true, limit: 2000 });
  let n = 0;
  let pages = 1;
  for (;;) {
    n += page.entries.filter((e) => e[".tag"] === "file" && /\.pdf$/i.test(e.name)).length;
    if (!page.has_more) return { n, pages };
    page = await call("list_folder/continue", { cursor: page.cursor });
    pages++;
  }
}

async function countRows(table, filter) {
  let q = svc.from(table).select("*", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) throw error;
  return count;
}

const anon = createClient(url, anonKey, opts);
const users = [];
try {
  const c = await makeUser("contrib");
  users.push(c);
  const a = await makeUser("admin");
  users.push(a);
  const promote = await svc.from("profiles").update({ role: "admin" }).eq("id", a.id);
  if (promote.error) throw promote.error;
  const fake = [{ id: "id:fake", path: "/x/fake.pdf", name: "fake.pdf", hash: "h", size: 1, modified: new Date().toISOString() }];
  const at = new Date().toISOString();

  // ── nobody but admins ──
  for (const [who, db] of [["anon", anon], ["contributor", c.db]]) {
    expectErr(await db.rpc("import_overview"), `${who} import_overview blocked`);
    expectErr(await db.rpc("import_scan_apply", { p_files: fake, p_scan_at: at }), `${who} import_scan_apply blocked`);
    expectErr(await db.rpc("import_scan_finish", { p_scan_at: at }), `${who} import_scan_finish blocked`);
    expectErr(await db.rpc("import_fix_name", { p_id: "00000000-0000-0000-0000-000000000000", p_title: "x", p_artist: "y" }), `${who} import_fix_name blocked`);
    expectErr(await db.rpc("import_ensure_song", { p_import_id: "00000000-0000-0000-0000-000000000000" }), `${who} import_ensure_song blocked`);
    expectNone(await db.from("import_files").select("id").limit(1), `${who} can't read import_files`);
    expectNone(await db.from("songs").select("id").eq("status", "imported").limit(1), `${who} can't see imported songs`);
  }
  expectErr(await a.db.rpc("import_ensure_song", { p_import_id: "00000000-0000-0000-0000-000000000000" }), "admin can't call internal import_ensure_song");
  const ov = await a.db.rpc("import_overview");
  ov.error ? fail(`admin import_overview: ${ov.error.message}`) : pass(`admin import_overview works (total ${ov.data.total})`);

  // ── inventory vs Dropbox ──
  const dbx = await dropboxPdfCount();
  const live = await countRows("import_files", (q) => q.eq("missing", false));
  if (!dbx) console.log("SKIP Dropbox count (DROPBOX_* not set)");
  else if (live === 0) console.log(`SKIP inventory checks: no scan yet (Dropbox has ${dbx.n} PDFs)`);
  else {
    live === dbx.n ? pass(`scan count ${live} = Dropbox count ${dbx.n} (${dbx.pages} list pages)`) : fail(`scan has ${live}, Dropbox has ${dbx.n}`);
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await svc
        .from("import_files")
        .select("dropbox_file_id, dropbox_path, song_id, title, artist")
        .order("id")
        .range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    const uniq = (k) => new Set(rows.map((r) => r[k])).size === rows.length;
    uniq("dropbox_file_id") && uniq("dropbox_path") ? pass(`no duplicate import rows (${rows.length})`) : fail("duplicate import rows");
    const songIds = rows.filter((r) => r.song_id).map((r) => r.song_id);
    new Set(songIds).size === songIds.length ? pass("no two files share a song") : fail("files share a song");
    const named = rows.filter((r) => r.title && r.artist).length;
    named === songIds.length ? pass(`every named file has its draft song (${named})`) : fail(`${named} named files, ${songIds.length} songs`);
    const imported = await countRows("songs", (q) => q.not("dropbox_path", "is", null));
    imported === songIds.length ? pass(`songs from Dropbox = ${imported}, no extras`) : fail(`songs with dropbox_path ${imported} vs linked ${songIds.length}`);
  }

  // ── pages over HTTP (local server must run without ADMIN_EMAILS, or the test admin is demoted) ──
  if (baseUrl) {
    const get = (p, cookie) => fetch(`${baseUrl}${p}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
    const out = await get("/admin/import");
    out.status >= 300 && out.status < 400 ? pass("signed-out /admin/import → login") : fail(`signed-out /admin/import: ${out.status}`);
    const asC = await get("/admin/import", authCookie(c.session));
    const cBody = asC.status === 200 ? await asC.text() : "";
    !cBody.includes("Import from Dropbox") ? pass(`contributor /admin/import → not found (${asC.status})`) : fail("contributor sees /admin/import");
    const asA = await get("/admin/import", authCookie(a.session));
    (await asA.text()).includes("Import from Dropbox") ? pass("admin /admin/import shows the page") : fail(`admin /admin/import: ${asA.status}`);
    const { data: one } = await svc.from("import_files").select("id").eq("missing", false).limit(1).maybeSingle();
    if (one) {
      const pc = await get(`/admin/import/pdf/${one.id}`, authCookie(c.session));
      pc.status === 404 ? pass("contributor View PDF → 404") : fail(`contributor View PDF: ${pc.status}`);
      const pa = await get(`/admin/import/pdf/${one.id}`, authCookie(a.session));
      const loc = pa.headers.get("location") ?? "";
      if (pa.status === 302 && /^https:\/\/[^/]*dropbox[^/]*\.com\//.test(loc)) {
        const pdf = await fetch(loc);
        const head = Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString();
        pdf.ok && head === "%PDF-" ? pass("admin View PDF → Dropbox temporary link serves the PDF") : fail(`temp link: ${pdf.status} ${head}`);
      } else fail(`admin View PDF: ${pa.status} ${loc.slice(0, 40)}`);
    }
  } else console.log("SKIP page checks (set BASE_URL to run them)");
} finally {
  for (const u of users) await svc.auth.admin.deleteUser(u.id);
  console.log(`cleaned up ${users.length} test user(s)`);
}
if (failed) {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("all import checks passed");
