# Broadway Book

Free, open-source Nashville Number System charts for musicians playing Lower Broadway
in Nashville. Pull up a song's number chart on your phone, mid-set, in seconds, and show
it in any key.

- Anyone can view charts, no login.
- Signed-in players can suggest edits and vote. An edit goes live after 3 approvals.
- No lyrics, ever. Just numbers, structure, dynamics and short cues.

Chart format: [docs/CHART_FORMAT.md](docs/CHART_FORMAT.md)

## Run it locally

You need Node 20+ and a Supabase project (the free tier is fine).

```bash
git clone https://github.com/pwrmediacreative-art/broadway-book.git
cd broadway-book
npm install
cp .env.example .env.local   # then fill in your Supabase URL and anon key
npm run dev                  # http://localhost:3000
```

Set up the database (once):

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push          # runs supabase/migrations (schema, RLS, example songs)
```

Tests:

```bash
npm test
```

## Stack

Next.js (App Router, TypeScript), Tailwind, Supabase (Postgres, Auth, Row Level
Security), Vercel.

## License

- **Code:** [MIT](LICENSE).
- **Chart data** contributed by users: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
  You can share and adapt charts with credit, under the same license.

Contributions welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md).
