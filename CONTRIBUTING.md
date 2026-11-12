# Contributing to Broadway Book

Thanks for helping. There are two ways to contribute.

## 1. Fix or add a chart (no code)

1. Sign in on the site (email magic link).
2. Open a song and suggest an edit.
3. Three other signed-in players approve it and it goes live. Admins can approve
   right away.

Rules for charts:

- **No lyrics.** Numbers, structure, dynamics and short cue words only.
- Follow [docs/CHART_FORMAT.md](docs/CHART_FORMAT.md).
- Chart what the band actually plays on Broadway, not the album's every detail.
- By submitting a chart you agree to license it under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

## 2. Improve the code

1. Fork the repo and create a branch.
2. Set up locally (see [README.md](README.md)).
3. Make your change. Keep it small and focused.
4. Run `npm test` and `npm run build`. Both must pass.
5. If you touch the chart format, update `docs/CHART_FORMAT.md`, the parser, the
   serializer and the tests together, and add a round-trip test.
6. Open a pull request that says what changed and how you tested it.

Code contributions are licensed under the MIT License.

Never commit keys or `.env.local`. Database changes go in a new file in
`supabase/migrations/` and must keep Row Level Security on for every table.

Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).
