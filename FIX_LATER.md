# Fix later

Smaller issues found along the way. One line each. Blockers never go here.

- Google sign-in: needs a Google Cloud OAuth client; add as a second login option.
- Proposals aren't validated by the chart parser server-side yet; add an API route that parses before insert.
- Proposal based on an old revision can overwrite a newer one; detect and flag conflicts.
- Draw diamonds, pushes, fermatas and stops as real symbols on the song page (now shown as ASCII <1> ^4 1~ 1!).
- Remember the chosen key / 123-ABC / 1- vs 6- per song (URL or local storage).
- Offline support (service worker + cached charts) not started.
- Setlists UI and one-tap next song not started.
- Code of Conduct needs a private contact email for reports.
- Search is client-side over the full list; fine for ~1,900 songs, revisit if it grows a lot.
- songs.updated_at is only bumped by publish_chart; add a trigger for other updates.
- Unknown song URLs show the 404 page but return HTTP 200 (streamed notFound with Cache Components); fix status code.
- Add database tests (pgTAP) for the voting trigger: 3 approvals publish, 3 rejections close, admin vote decides.
- Auto-deploy on push: install the Vercel GitHub app for pwrmediacreative-art, then run `npx vercel git connect` (deploys are via CLI until then).
- Split bars (e.g. (4 5)) are only underlined; on a phone they can read like two bars. Make them more distinct.
- Supabase's built-in email sender only allows a few sign-in emails per hour; set up custom SMTP (e.g. Resend) before inviting players.
- Magic-link email could also show a 6-digit code, for when the link opens in the wrong app.
- Removing someone from ADMIN_EMAILS only takes effect at their next sign-in or /admin visit; add a sync on every signed-in request or a "sync all" job.
- Account bar is blank for a moment while the browser checks sign-in; could render from a cookie hint.
- Admin dashboard section cards (Import, Review, Community) are placeholders until those steps.
- Search isn't typo-tolerant yet ("wagn" finds nothing for Wagon Wheel); add fuzzy matching.
