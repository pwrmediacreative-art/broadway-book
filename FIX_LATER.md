# Fix later

Smaller issues found along the way. One line each. Blockers never go here.

- Google sign-in: needs a Google Cloud OAuth client; add as a second login option.
- Sign-in page (email magic link) and profile page aren't built yet; needed before anyone can propose or vote.
- Proposals aren't validated by the chart parser server-side yet; add an API route that parses before insert.
- Proposal based on an old revision can overwrite a newer one; detect and flag conflicts.
- Draw diamonds, pushes, fermatas and stops as real symbols on the song page (now shown as ASCII <1> ^4 1~ 1!).
- Remember the chosen key / 123-ABC / 1- vs 6- per song (URL or local storage).
- Offline support (service worker + cached charts) not started.
- Setlists UI and one-tap next song not started.
- Code of Conduct needs a private contact email for reports.
- Search is client-side over the full list; fine for ~1,900 songs, revisit if it grows a lot.
- songs.updated_at is only bumped by publish_chart; add a trigger for other updates.
- Add the co-owner and owner as admins after first sign-in (one SQL update each).
- Unknown song URLs show the 404 page but return HTTP 200 (streamed notFound with Cache Components); fix status code.
- Add database tests (pgTAP) for the voting trigger: 3 approvals publish, 3 rejections close, admin vote decides.
- Auto-deploy on push: install the Vercel GitHub app for pwrmediacreative-art, then run `npx vercel git connect` (deploys are via CLI until then).
