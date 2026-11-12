// Blocker check for sign-in and roles. Creates two throwaway users (contributor + admin),
// checks what each can do in the DATABASE (RLS + functions), optionally checks /admin over
// HTTP, then deletes both users.
// Run: npm run check:roles                  (database only)
//      BASE_URL=http://localhost:3000 npm run check:roles   (also checks the /admin page)
// Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const baseUrl = process.env.BASE_URL?.replace(/\/$/, "");
if (!url || !anonKey || !serviceKey) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY");
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(url, serviceKey, opts);
const ref = new URL(url).hostname.split(".")[0];

let failed = 0;
const pass = (m) => console.log("PASS", m);
const fail = (m) => { failed++; console.log("FAIL", m); };
const expectErr = (r, m) => (r.error ? pass(`${m} (${r.error.code})`) : fail(`${m}: NOT blocked`));
const expectNoRows = (r, m) => (r.error || r.data.length === 0 ? pass(m) : fail(`${m}: changed ${r.data.length} row(s)`));

/** Create a confirmed user and sign them in via a magic-link token (no email sent). */
async function makeUser(tag) {
  const email = `roles-check-${tag}-${Date.now()}@example.com`;
  const created = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const db = createClient(url, anonKey, opts);
  const v = await db.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (v.error) throw v.error;
  return { id: created.data.user.id, email, db, session: v.data.session };
}

/** The cookie(s) @supabase/ssr reads, so we can request pages as this user. */
function authCookie(session) {
  const name = `sb-${ref}-auth-token`;
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const max = 3180;
  if (value.length <= max) return `${name}=${value}`;
  const parts = [];
  for (let i = 0; i * max < value.length; i++) parts.push(`${name}.${i}=${value.slice(i * max, (i + 1) * max)}`);
  return parts.join("; ");
}

async function getAdminPage(cookie) {
  const res = await fetch(`${baseUrl}/admin`, { redirect: "manual", headers: cookie ? { cookie } : {} });
  return { status: res.status, location: res.headers.get("location") ?? "", body: res.status === 200 ? await res.text() : "" };
}

const anon = createClient(url, anonKey, opts);
const users = [];
try {
  const contributor = await makeUser("contrib");
  users.push(contributor);
  const admin = await makeUser("admin");
  users.push(admin);
  const promote = await svc.from("profiles").update({ role: "admin" }).eq("id", admin.id);
  if (promote.error) throw promote.error;
  const c = contributor.db;

  // ── anon ──
  expectErr(await anon.rpc("admin_dashboard"), "anon admin_dashboard blocked");

  // ── contributor: can read, can't write admin things ──
  const songs = await c.from("songs").select("id, status");
  if (!songs.error && songs.data.length && songs.data.every((s) => s.status === "published")) pass(`contributor reads ${songs.data.length} published songs`);
  else fail(`contributor songs read: ${songs.error?.message ?? "unexpected rows"}`);
  const songId = songs.data?.[0]?.id;

  expectErr(await c.rpc("admin_dashboard"), "contributor admin_dashboard blocked");
  expectErr(await c.from("songs").insert({ slug: `roles-check-${Date.now()}`, title: "x", status: "published" }), "contributor insert songs blocked");
  expectNoRows(await c.from("songs").update({ title: "hacked" }).eq("id", songId).select(), "contributor update songs blocked");
  expectNoRows(await c.from("songs").delete().eq("id", songId).select(), "contributor delete songs blocked");
  expectErr(await c.from("revisions").insert({ song_id: songId, chart_text: "x", source: "human" }), "contributor insert revisions blocked");
  expectErr(await c.from("import_files").insert({ dropbox_path: "/x.pdf" }), "contributor insert import_files blocked");
  const imports = await c.from("import_files").select("id").limit(1);
  imports.error || imports.data.length === 0 ? pass("contributor can't read import_files") : fail("contributor read import_files");
  expectErr(await c.rpc("revert_song", { p_song_id: songId, p_revision_id: songId }), "contributor revert_song blocked");
  expectErr(await c.rpc("publish_chart", {}), "contributor publish_chart blocked");
  expectErr(await c.rpc("decide_proposal", {}), "contributor decide_proposal blocked");

  // ── contributor: own profile only, never own role ──
  expectErr(await c.from("profiles").update({ role: "admin" }).eq("id", contributor.id), "contributor can't make self admin");
  const ok = await c.from("profiles").update({ display_name: "Check Bot", instrument: "steel" }).eq("id", contributor.id).select();
  !ok.error && ok.data.length === 1 ? pass("contributor saves own display name + instrument") : fail(`own profile update: ${ok.error?.message ?? "0 rows"}`);
  expectErr(await c.from("profiles").update({ instrument: "kazoo" }).eq("id", contributor.id), "instrument outside list rejected");
  expectErr(await c.from("profiles").update({ display_name: "x".repeat(41) }).eq("id", contributor.id), "display name over 40 rejected");
  expectNoRows(await c.from("profiles").update({ display_name: "hacked" }).eq("id", admin.id).select(), "contributor can't edit someone else's profile");
  const role = await svc.from("profiles").select("role").eq("id", contributor.id).single();
  role.data?.role === "contributor" ? pass("contributor role unchanged") : fail(`contributor role is ${role.data?.role}`);

  // ── admin ──
  const dash = await admin.db.rpc("admin_dashboard");
  !dash.error && typeof dash.data?.songs === "number" ? pass(`admin admin_dashboard works (${dash.data.songs} songs)`) : fail(`admin dashboard: ${dash.error?.message}`);

  // ── /admin page over HTTP ──
  if (baseUrl) {
    const out = await getAdminPage();
    out.status >= 300 && out.status < 400 && out.location.includes("/login") ? pass("signed-out /admin → /login") : fail(`signed-out /admin: ${out.status} ${out.location}`);
    const asC = await getAdminPage(authCookie(contributor.session));
    !asC.body.includes("Open proposals") && (asC.status === 404 || /could not be found|404/i.test(asC.body))
      ? pass(`contributor /admin → not found (${asC.status})`)
      : fail(`contributor /admin: status ${asC.status}, dashboard shown=${asC.body.includes("Open proposals")}`);
    // Magic link → /auth/confirm → /auth/finish, as a brand-new browser would do it
    // (default Supabase email, implicit flow: tokens arrive in the URL #fragment).
    const fresh = await svc.auth.admin.createUser({ email: `roles-check-link-${Date.now()}@example.com`, email_confirm: true });
    users.push({ id: fresh.data.user.id });
    const link = await svc.auth.admin.generateLink({ type: "magiclink", email: fresh.data.user.email });
    const hop = await fetch(link.data.properties.action_link, { redirect: "manual" });
    const frag = new URLSearchParams((hop.headers.get("location") ?? "").split("#")[1] ?? "");
    const fin = await fetch(`${baseUrl}/auth/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_token: frag.get("access_token"), refresh_token: frag.get("refresh_token"), next: "/songs/x" }),
    });
    const finBody = fin.ok ? await fin.json() : {};
    fin.ok && finBody.dest === "/profile?next=%2Fsongs%2Fx" && (fin.headers.get("set-cookie") ?? "").includes("auth-token")
      ? pass("magic link signs in from any browser, new user → profile step")
      : fail(`magic link finish: ${fin.status} ${JSON.stringify(finBody)}`);
    const bad = await fetch(`${baseUrl}/auth/finish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ access_token: "x", refresh_token: "y" }) });
    bad.status === 401 ? pass("forged tokens rejected (401)") : fail(`forged tokens: ${bad.status}`);

    // The page re-syncs roles from ADMIN_EMAILS, which demotes this test admin (not on the
    // list) unless the server runs with ADMIN_EMAILS unset. Opt in with CHECK_ADMIN_PAGE=1.
    if (process.env.CHECK_ADMIN_PAGE === "1") {
      const asA = await getAdminPage(authCookie(admin.session));
      asA.body.includes("Open proposals") ? pass("admin /admin shows dashboard") : fail(`admin /admin: status ${asA.status}`);
    }
  } else {
    console.log("SKIP /admin page checks (set BASE_URL to run them)");
  }
} finally {
  for (const u of users) await svc.auth.admin.deleteUser(u.id);
  console.log(`cleaned up ${users.length} test user(s)`);
}

console.log(failed ? `\n${failed} role check(s) FAILED` : "\nAll role checks passed");
process.exit(failed ? 1 : 0);
