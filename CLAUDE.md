@AGENTS.md

# Broadway Book

Free, open-source web app of Nashville Number System charts for musicians playing
Lower Broadway in Nashville. This file is the source of truth for every step.

## Who it's for

Working musicians on Broadway who need to pull up a song's number chart on a phone,
mid-set, in seconds. Dark stage, loud room, one hand, no time. Every screen should be
readable at arm's length and usable with a thumb.

## Where the charts come from

- ~1,900 handwritten charts, one song per scanned PDF, in a Dropbox folder shared with
  the owner by the co-owner.
- AI reads each PDF into the chart format (docs/CHART_FORMAT.md). Humans review it.
- `songs.dropbox_path` + `songs.dropbox_content_hash` track the source file so
  re-imports only touch changed PDFs. `import_files` logs each import attempt.
- Minor-key songs vary chart to chart: some count from the minor tonic (`1-`), some
  from the relative major (`6-`). The importer records which with `{numbers: relative}`.
  Players can flip between the two styles on the song page.

## Access and community edits

- Anyone can VIEW without logging in.
- Logging in (email magic link now; Google later) is needed to suggest edits or vote.
- Anyone signed in can propose a change (a `proposals` row holding new chart text).
- A proposal goes live after **3 approvals** from different signed-in users who are
  not its author. **3 rejections** close it.
- Admins (owner + co-owner, `profiles.role = 'admin'`) can approve or reject instantly
  and can revert a song to any earlier revision.
- Every published version is a row in `revisions`; `songs.current_revision_id` points
  at the live one. Revisions are never edited or deleted.
- Admin role comes from the `ADMIN_EMAILS` env var (comma-separated; Vercel + `.env.local`). The server
  copies it into `profiles.role` on each sign-in and /admin visit (service-role key, server only).
  Database checks use `is_admin()`. Users can never change their own role. Never put emails in the repo.

## Hard rules for content

- **No lyrics stored. Ever.** Charts hold numbers, structure, dynamics and short cue
  words only (cues of 6 words or fewer, never lyric lines). The parser warns on long cues.
- Code is MIT. Chart data contributed by users is CC BY-SA 4.0.

## Stage priorities (in order)

1. Fast search (title/artist, instant, forgiving).
2. Show any chart in any key (numbers or chord names).
3. Works offline (charts cached on the phone).
4. Setlists.
5. One-tap next song.

## Stack

- Next.js (App Router, TypeScript) + Tailwind. Read `node_modules/next/dist/docs/`
  before using a Next.js API; this version differs from older training data.
- Supabase: Postgres, Auth, Row Level Security. Migrations live in `supabase/migrations/`.
- Hosted on Vercel, auto-deploying from `main` on GitHub (public repo).
- Tests: Vitest (`npm test`).
- Keys live only in `.env.local` (gitignored) and Vercel env vars. Never commit keys.
  The service-role key is never used in browser code.

## Code map

- `lib/chart/` – chart format: `parse.ts` (text → JSON), `serialize.ts` (JSON → text),
  `transpose.ts` (numbers → chord names, minor/relative renumbering), `view.ts`
  (everything the song page draws), `examples.ts` (seed charts), `chart.test.ts`.
- `lib/supabase/` – Supabase clients: `server.ts` (anon, cached public reads), `session.ts` (signed-in user,
  `syncRole`), `browser.ts`, `service.ts` (service role, server only, role sync only).
- `lib/auth/roles.ts` – ADMIN_EMAILS parsing, profile validation, instrument list.
- `lib/search/` – home search: `pack.ts` (index file format), `engine.ts` (MiniSearch, typo-tolerant), `browse.ts` (filters, sort, facets, URL state), `recent.ts`, `useIndex.ts` (device copy + refresh). Index served by `app/search-index.json/route.ts`.
- `lib/dropbox/client.ts` – server-only Dropbox (refresh token, `listPdfs`, `temporaryLink`). `lib/import/filename.ts` – filename → title/artist.
  `/admin/import` scans Dropbox into `import_files` via `import_scan_apply()`; `npm run dropbox:token` gets the refresh token once.
  AI reading: `lib/ai/` (prompt, reader, cost, `takeChunk`), `app/admin/import/ai-actions.ts` (pilot, full batch loop, Retry failed, first-chunk check).
  Rules live in the DB (`20261112200100_ai_reading.sql`, `20261113160000_ai_full_batch.sql`); `npm run check:ai` and `npm run check:batch` check them.
- `lib/chart/diff.ts` (bar-by-bar diff), `lib/chart/validate.ts` (`checkChart`: parse + long-cue guard + canonical text before any save).
- `lib/personal/versions.ts` – the player's own chart versions: one request (RLS owner-only), device copy per user, `usePickedChart` (song page, stage, search "Yours" tag).
- `lib/flags/` – personal flags ("Flag for me"): `ref.ts` (bar reference: section/bar/beat + text as written, `locateBar` for the editor), `store.ts` (device copy signed out, account + device copy signed in, move-to-account). `app/songs/[slug]/Hold.tsx` – press-and-hold (500ms, 10px), bottom sheet, "My flags" list, move banner.
  Table `personal_flags` (`20261113140000_personal_flags.sql`, owner-only RLS); `npm run check:flags` checks it. Stage caps: `MAX_STAGE_SIZE` (75px) and `MAX_SPEED` (6) in `lib/chart/layout.ts`.
- `app/community/` – `/community` list, `/community/[id]` suggestion (bar diff, votes, admin approve/close), `actions.ts` (all community + personal-version server actions), `BarDiff.tsx`.
  `/songs/[slug]/edit` (editor: "Just for me" / "Suggest for everyone"), `/songs/[slug]/history` (revisions + admin revert), `/notifications`, `/profile/versions`, `/admin/community` (settings, reports, blocks).
  Rules live in the DB (`20261112190000_community_edits.sql`): `settings` thresholds, stale check, vote/proposal limits, blocking. `npm run check:community` checks them.
- `proxy.ts` – refreshes the session and sends signed-out visitors to /login for `/profile`, `/admin`, `/notifications` and the editor.
- `app/admin/review/` – review screen: `/admin/review` opens the next unclaimed song, `[id]` split screen (`PdfViewer.tsx` pdf.js, editor + preview, shortcuts), `queue/` list + filters, `actions.ts`, `release/` (claim release beacon). `lib/review/` (`unclear.ts` notes → preview rows, `queue.ts` order/filter, `keys.ts` shortcuts).
  Claims/drafts/review log/trusted reviewers live in `20261113120000_review_claims.sql`; `npm run check:claims` checks them.
- `app/` – pages. `/` = song list + search, `/songs/[slug]` = chart, `/login` (magic link),
  `/auth/callback`, `/profile` (display name + instrument), `/admin` (admins only, via `admin_dashboard()`).
- `supabase/migrations/` – schema + RLS + example songs (seed migration generated by `scripts/gen-seed.ts`). `npm run check:rls` checks anon access;
  `npm run check:roles` checks contributor/admin access (needs `SUPABASE_SERVICE_ROLE_KEY`).
- Offline + install: `public/sw.js` (hand-written service worker: saves the app pages in `SHELLS` and their files, network first, swaps the saved copy only when a whole new version has downloaded; offline it serves a saved page or redirects song/setlist addresses to `/offline/song` and `/offline/setlist`).
  `lib/offline/`: `db.ts` (IndexedDB `bb-offline`: `songs` + `kv`), `sync.ts` (first download, then changed-since via `offline_sync()`; setlists; status), `charts.ts` (read saved charts/setlists), `status.ts` (`useOffline`, `OFFLINE_MSG`), `user.ts` (signed-in user remembered for offline), `routes.ts` (offline route table, mirrored in `sw.js`; a test keeps them in step), `nav.tsx` (`useGo`: in-place song changes on the saved-chart page), `install.ts`, `plan.ts` (pure helpers).
  `app/OfflineRoot.tsx` (registers the worker, sync triggers, offline strip, "Updated N songs"), `app/Install.tsx` (install card, home footer status line), `app/offline/*`, `app/setlists/SavedSet.tsx`, `app/manifest.ts`; icons from `npm run icons`.
  DB: `20261113180000_offline_sync.sql` (`songs_touch` trigger keeps `songs.updated_at` honest; `offline_sync()`); `npm run check:offline` checks it. Anything that writes to the server must be disabled offline with `OFFLINE_MSG`; a new whole page that should work offline goes in `SHELLS` in BOTH `routes.ts` and `sw.js`.
- `docs/CHART_FORMAT.md` – the chart format spec.
- `FIX_LATER.md` – known smaller issues, one line each.

## Chart format rules

- The canonical text form round-trips exactly: `serialize(parse(text)) === text`.
  Keep that true; add a round-trip test for every new syntax.
- If you change the format, update docs/CHART_FORMAT.md, the parser, the serializer
  and the tests in the same change.

## Database rules

- Public (anon) can read only `status = 'published'` songs and their current revision.
- All writes need an authenticated user; RLS enforces it, not just the UI.
- Approval counting and publishing happen in database functions, not in the client.

## Design

- Dark only for now, high contrast, large chart text, phone layout first,
  big tap targets (44px+). Font-size control and light mode come later.

## Rules for every future step

1. **Ask questions first.** Before writing code, ask until the goal and vision are clear,
   in short numbered rounds with a recommended answer each. Then repeat the plan back
   and wait for an OK.
2. **Blockers must pass** before a step is called done (tests, security, build, deploy).
   Smaller issues go in `FIX_LATER.md` (one line each); don't stop for them.
3. **Check the live site after every deploy**: home page, search, one song chart.
   If the deploy broke any of them, roll back to the previous deployment
   (`vercel rollback`) and report what happened.
4. Mark guesses as `[ASSUMPTION: ...]` in the step summary.
5. Keep usage low: read only the files the step needs, no full-repo scans.
