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

- **No disclaimers for players. Ever.** Never show players "check it by ear", "check by ear",
  "play it by ear", "this is a draft", "not yet checked", "AI-generated, may be wrong" or any
  similar disclaimer or warning about chart accuracy. Treat charts as close enough to correct.
  Wrong details get fixed through Suggest a change and the "+ Add" prompts. Accuracy info
  (confidence, unclear bars, Unverified) is for admin screens only; players keep the Unverified
  badge, the "NN% sure" line and unclear-bar markings as plain data, never as a warning.
  `lib/design/no-disclaimers.test.ts` fails if a banned phrase appears in player-facing code.

- **No lyrics stored. Ever.** Charts hold numbers, structure, dynamics and short cue
  words only (cues of 6 words or fewer, never lyric lines). The parser warns on long cues.
- Lyrics may only be **shown live** through the lyrics-provider module (`lib/lyrics/provider.ts`,
  LRCLIB today) via `/api/lyrics`, to the audience set on /admin (`lyrics_audience`, enforced by
  `lyrics_allowed()`), cached only on the viewer's device. Charts, our database, the repo, the
  search index, chart data and exports never contain lyrics. Licensed in-app lyrics (Musixmatch
  or LyricFind) are a later step and need a license first.
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
- Verified status: `20261113200000_verification.sql`. `songs.verified_at / verified_by / verified_revision_id` (+ `unverified_since`); the `songs_set_verification` trigger is the rule: only admins set or clear it, it belongs to the exact live revision (any change that isn't an admin's verified publish clears it: community merge, re-import, reviewer edit), examples sit outside it, and it keeps the older `songs.unverified` flag in step (search index `uv`, offline copy). `verification_log` = who/when/why, shown on the history page. Admin functions: `review_publish(verified)`, `review_verify` ("Verify as is", ⌘⇧Y), `review_unverify`, `review_bulk_verify` (max 20, `/admin/review/bulk`: chart text + PDF link, box unlocks after the PDF is opened), `revert_song` (restores Verified when the text was verified before). Queue filters `unverified` (default; falls through to Needs review when empty and not chosen) and `verified` in `lib/review/queue.ts`. Song page badge in `SongView.tsx` (never in `StageView`); search: `Filters.verified` + `isVerified` in `lib/search/browse.ts`, dot in `SongRow.tsx`. `npm run check:verify` checks the database rules.
- Auto-approve: `20261114100000_auto_approve.sql`. Settings `auto_approve_enabled` (0/1, off by default), `auto_approve_min_confidence` (percent 50–99; a score must be strictly over it, `auto_approve_over()`) and `auto_approve_max_unclear` (0–10, `20261114100200`); edited only in `app/admin/import/AutoApprove.tsx` (`auto-actions.ts`), hidden from the `/admin/community` settings form. The rule lives in one function, `auto_approve_candidates()` (needs_review, AI reading saved `ok` first try with no technical failure, over the cutoff, at most `auto_approve_max_unclear` `# UNCLEAR` notes, no other live file with the same title + artist, not held/claimed/drafted, never auto-approved before); `ai_finish` uses it for new readings and `auto_approve_existing(dry_run)` (switch must be on) for drafts already read. A chart it publishes is live and Unverified (the verification trigger sees to that), gets an admin-only `auto_approvals` row (approved_by `auto`, confidence, cutoff, run_by, pulled_back_at) — revisions are never edited — and an "Automatic" verification_log line for the history page. `auto_approved_songs()` = live, never verified, not sent back; queue filter `auto_approved`. Admins: `auto_approve_revert` ("Send back to review", queue row + review screen) and `auto_approve_pull_back(dry_run)`; a chart sent back is never auto-approved again. Switching off stops new ones and unpublishes nothing. `npm run check:auto` checks the rules (it only ever dry-runs the two bulk actions).
- Bulk Unverified publish + "Played it, it's right": `20261116100000_publish_unverified.sql`. `npm run publish:unverified` (dry run by default; `--apply`; `--undo [--apply] [--run id] [--song uuid]`) in `scripts/publish-unverified.ts` runs our parser on every needs_review draft and publishes the ones that pass `publish_unverified_reasons()` (skips lyrics flag, duplicate title+artist, needs_manual, held, in review, sent back) as Unverified, logged in `auto_approvals` (approved_by `bulk`, `run_id`). Service role only. Undo leaves anything verified or changed since. `chart_confirmations` (one per player per exact revision, `chart_confirm_state/toggle`), `app/songs/[slug]/Confirm.tsx`, `lib/confirm.ts` ("NN% sure", "Confirmed by N players" from 3). Queue order `confirmed` ("Most confirmed first", default for Unverified; cookie `bb_review2`). `npm run check:unverified` checks it.
- Uploads (private charts): `20261117100000_private_charts_enum.sql` + `20261117100100_private_charts.sql`. A private chart is a `songs` row with status `private` + `owner_id`; only the owner reads it, its revisions, its `uploads` row and its audio (other admins too are shut out: the admin RLS policies skip private songs). Never in `offline_sync()`, the search index, proposals, votes or confirmations. Writes only through `upload_create`, `private_save`, `upload_set_sync`, `upload_set_audio`, `upload_delete_audio`, `upload_delete`, `upload_share` / `upload_shared` (view-only link `/c/[code]`, chart only, never audio). Who may upload: setting `audio_upload_access` (0 off, 1 admins only, 2 admins + Pro) via `upload_access()` / `set_upload_access()` (control on `/admin`, `app/admin/UploadAccess.tsx`); Pro = `profiles.is_pro`, copied from the `PRO_EMAILS` env var by `syncPro` (lib/supabase/session.ts). Audio: private storage bucket `audio`, files at `<owner id>/<uuid>.<ext>`, short-lived signed links only; `MAX_AUDIO_MB` (default 50), 10-minute cap. `lib/upload/`: `musicxml.ts` (MusicXML chord symbols → `timeline.ts`; notes and lyrics never read), `build.ts` (timeline → chart: beat-snapped bars, split bars, numbers in the key, sections proposed from repeat patterns, `# UNCLEAR:` notes, estimated confidence; retry with simplified chords), `structure.ts` (Structure card / cheat sheet read from and written back to the chart text), `loudness.ts` (cold stop vs fade, a suggestion only), `audio.ts` (browser checks + upload with progress), `mine.ts` (your own charts on this phone, synced in `lib/offline/sync.ts`). Pages: `/upload` (form + My uploads), `/upload/[id]` (Structure card, player with tap sync, section loop, 0.5–1× slow-down, editor + preview, share, delete; `Workspace.tsx`, `Player.tsx`, `StructureCard.tsx`), `/upload/[id]/print`, `/upload/[id]/history`, `/mine/[id]` (+ `/stage` with the cheat sheet; `StageView` `mine` prop), `/offline/mine`. `app/upload/actions.ts` = all upload server actions. `npm run check:uploads` checks the database rules. Admins share uploads (`20261117110000_admin_shared_uploads.sql`, `_admin_sees_upload()`): every admin can read every admin's uploaded chart and its current version (chart page, stage, setlists, offline via `upload_charts_visible()`, home search + an "Uploads" row in A–Z, tagged "Uploaded by …"); only the uploader edits, shares, deletes or hears the audio; a Pro's uploads stay private. Music.AI audio analysis is not built yet (waiting on the account).
- Renaming songs: `20261118100000_song_rename.sql` (+ `20261118100100_slug_redirect_guard.sql`). `rename_song` (admins any song; an upload's owner their own), `propose_rename` / `vote_rename` / `admin_decide_rename` / `withdraw_rename` (community name suggestions, same `approvals_needed`/`rejections_needed` settings), all through `_apply_rename`: new slug, old slug kept in `song_slug_redirects` (`resolve_slug`; song/stage/edit/history pages redirect via `movedOrNotFound` in `app/songs/[slug]/data.ts`; `songs_bundle` follows old slugs for device setlists and snapshots, adding `asked`), log in `song_renames` (history pages), import list name marked fixed. Once renamed, `publish_chart` no longer copies `{title:}/{artist:}` onto the song; editors start from the current name (`lib/songs/name.ts`). UI: `app/songs/[slug]/Rename.tsx` + `rename-actions.ts`, `app/community/RenameSuggestions.tsx`, `app/admin/review/Rename.tsx` (import + review lists), same-name warning `lib/songs/dupName.ts`. `npm run check:rename` checks the rules.
- Clean AI drafts: `20261118120000_clean_drafts.sql` (+ `20261118120100_clean_pulled_back.sql`: sending a chart back clears its mark). Clean = AI reading, zero `# UNCLEAR`, AI confidence 75%+ (`is_clean_reading`). Admin-only `approved_as_is` (approved_by `auto`, exact revision, run id, undone_at); a trigger on `auto_approvals` marks clean charts that auto-approve or the bulk publish put live (auto-approve's switch still decides what publishes). Players see only Unverified; Verified is never touched. Queue: `review_items.clean`, filter `clean` ("Clean (auto-approved)"), count `clean`, clean charts sort last. One-time pass: `npm run clean:drafts` (dry run by default; `--apply`; `--undo [--apply] [--run id]`), `scripts/clean-drafts.ts` via `clean_plan` / `clean_mark` / `clean_undo` + `publish_unverified_apply/undo`. `npm run check:clean` checks the rules.
- Numbers/Chords choice: first song a player opens on a device shows "How do you read charts?" (`app/ReadChoice.tsx`, mounted in SongView and StageView, so stage, setlist play and shared links too); devices with `bb.display` set skip it. Settings sheet from the gear in the top bar (`app/Settings.tsx`, `DisplayPicker`). `lib/display.ts` `setDisplay` writes the device (`bb.display` + `bb.display.at`) and, signed in, the account (`user_prefs`, owner-only; `20261118140000_user_prefs.sql` + `20261118140100`); `syncDisplay` (AuthBar on sign-in, ReadChoice before asking) keeps the newest of the two (`lib/display-rule.ts`). The 123/ABC toggle uses `setDisplay`. `npm run check:prefs` checks the table rules.
- Lyrics (Q7): `20261118160000_lyrics.sql` (`lyrics_audience` setting 0 off/1 admins/2 signed-in/3 everyone, `lyrics_allowed()`, `lyrics_song()`, admin-only `lyrics_hidden` / `lyrics_picks` (an LRCLIB id) / `lyrics_log`). `lib/lyrics/` (`lrclib.ts` client: User-Agent, one request at a time, Retry-After; `match.ts`; `provider.ts` the swap point), `app/api/lyrics/route.ts` (no-store, noindex) + `actions.ts`, `app/songs/[slug]/Lyrics.tsx` (desktop side panel at 1280px+, phone drawer, admin Hide / Pick another), Lyrics toggle in Settings, `app/admin/LyricsAccess.tsx`. `npm run check:lyrics` checks the database rules.
- Send a setlist copy (Q8): `20261118180000_setlist_invites.sql` (`setlist_invites` one recipient / 7 days / turn off, `setlist_invite_seen` waiting + declined, `setlists.copied_from_name` + `copied_at`; functions `setlist_invite_create/open/accept/decline/revoke`, `setlist_invites_for` (sender), `setlist_invites_waiting` (cards + badge), `setlist_private_count`). Accept copies order, keys and notes into an independent setlist. UI: `app/setlists/SendCopy.tsx` (on the setlist page), `app/setlists/Invites.tsx` (card, /setlists cards, `/setlists/invite/[code]`), badge in `AuthBar`. `lib/setlists/invites.ts`. `npm run check:invites` checks the rules.
- Desktop layouts (Q4, lg/1024px+ only; phone layouts unchanged): song page = chart left + side panel (SongView grid), home/search = controls left + results right (`app/page.tsx` + `SongSearch.tsx`), setlists two columns, community two columns, wider top bar. Wrappers are `contents` below lg so phone DOM order stays. Stage mode side padding = `--bb-space-6` (+ safe areas). "My notes" (`/notes`, `app/notes/`, `lib/notes/group.ts`): flags + "Just for me" versions by song, newest first; flag links `/songs/<slug>#at=section.bar.beat` scroll to and light the spot (`.bb-flash`).
- Whole song view (Q9): `PREF.layout = "whole"` (switch in `DisplayControls` and Settings). Stage mode: `app/songs/[slug]/WholeChart.tsx` fits the chart into CSS columns (sections `break-inside-avoid`), largest size up to `MAX_STAGE_SIZE`, never below `PREF.wholeMin` (default 24); past that it pages (overflow columns to the right). Pedals/arrows/swipe/edge taps turn pages first (`Pager`), then songs; "Next:" on the last page; auto-scroll off. Song page: ~13em columns, page scrolls. Road map strip `RoadMap.tsx` + `lib/chart/roadmap.ts`. A section taller than the screen at the minimum continues in the next column (owner's choice).
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

- Dark everywhere, high contrast, large chart text, phone layout first,
  big tap targets (44px+). No light mode outside stage mode's Light look (DESIGN.md).
  A font-size control comes later. `npm test` includes `lib/design/design.test.ts`, which fails on hex,
  raw Tailwind colors, pill/card rounding, shadows, blur or text under 14px in components.
- Every UI change must follow DESIGN.md and use its tokens (`--bb-*` in `app/globals.css`); never hard-code colors or fonts.

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
