# Fix later

Smaller issues found along the way. One line each. Blockers never go here.

- Google sign-in: needs a Google Cloud OAuth client; add as a second login option.
- Proposals aren't validated by the chart parser server-side yet; add an API route that parses before insert.
- Proposal based on an old revision can overwrite a newer one; detect and flag conflicts.
- Offline support (service worker + cached charts) not started.
- Setlists UI and one-tap next song not started.
- Code of Conduct needs a private contact email for reports.
- Search is client-side over the full list; fine for ~1,900 songs, revisit if it grows a lot.
- songs.updated_at is only bumped by publish_chart; add a trigger for other updates.
- Unknown song URLs show the 404 page but return HTTP 200 (streamed notFound with Cache Components); fix status code.
- Add database tests (pgTAP) for the voting trigger: 3 approvals publish, 3 rejections close, admin vote decides.
- Auto-deploy on push: install the Vercel GitHub app for pwrmediacreative-art, then run `npx vercel git connect` (deploys are via CLI until then).
- Supabase's built-in email sender only allows a few sign-in emails per hour; set up custom SMTP (e.g. Resend) before inviting players.
- Magic-link email could also show a 6-digit code, for when the link opens in the wrong app.
- Removing someone from ADMIN_EMAILS only takes effect at their next sign-in or /admin visit; add a sync on every signed-in request or a "sync all" job.
- Account bar is blank for a moment while the browser checks sign-in; could render from a cookie hint.
- Admin dashboard section cards (Import, Review, Community) are placeholders until those steps.
- Search isn't typo-tolerant yet ("wagn" finds nothing for Wagon Wheel); add fuzzy matching.
- Light mode toggle not built (dark only, per CLAUDE.md); stage mode would need light tokens for chart colors.
- Fullscreen in stage mode only works where the browser allows it (not iPhone Safari); consider "Add to Home Screen" guidance.
- Stage pages are prerendered too (2 pages per song, ~3,800 at full catalog); watch Vercel build time after the Dropbox import.
- Beat pulse and suggested scroll speed ignore mid-chart {bpm}/{time} changes; they use the header values only.
- Next/previous song follows the home list or search results; switch to setlist order once setlists exist.
- Old stage pages stay mounted (hidden) after moving between songs (Cache Components keeps routes); fine now, watch memory on long sets.
- Split bars reserve the push/stop mark row even when only one beat has a mark; a little extra height on those lines.
- Stage light mode: black text on the amber-700 accent buttons is ~4.4:1 contrast; consider white text on accent in light mode.
- Stage mode: when a chart just fits, the floating Aa button covers the last bar's right edge until controls auto-hide.
- Stage header at 375px: with the key pair and "Next:" shown, long song titles shrink to a few letters; consider a two-line header or shorter Next label.
- Song page sticky controls now wrap to two rows on a phone (key, 123/ABC, Relative/Parallel, 6-/6m); consider moving 6-/6m into a settings sheet.
- The old app-wide 1-/6- choice (localStorage `bb.style`) is no longer read; numbering is per song now. Players who had flipped it will see each song as written until they flip again.
