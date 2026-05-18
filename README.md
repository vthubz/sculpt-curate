# Sculpt · Curation

Public-facing tool for friends to clean up Sculpt's exercise catalog. Anyone
signs in with Google, gets dropped into a queue of one-card-at-a-time
exercises, and can **approve / rename / add aliases** to make the Sculpt
mobile app smarter.

Built with **Next.js 16** + **Tailwind** + **Supabase** (sharing the same
Sculpt project — auth, schema, and users are reused).

---

## One-time setup checklist

### 1. Run the schema migration

Open the [Sculpt Supabase project's SQL editor](https://supabase.com/dashboard/project/isevnzxvsbdjdxoinhix/sql)
and paste in `supabase/schema.sql`. Adds four tables + RLS + a leaderboard
view. Idempotent (uses `if not exists`).

### 2. Seed the catalog from free-exercise-db

```bash
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> npx tsx scripts/seed-exercises.ts
```

The service-role key is in **Supabase → Project settings → API**. Don't
commit it; this is a one-time run.

Confirms ~800 rows in `curated_exercises`, all with `is_approved = false`.

### 3. Allow this site's OAuth redirect URL

In Supabase Authentication → URL Configuration:
- Add `https://curate.huber.llc/auth/callback` to **Redirect URLs**.
- Add `http://localhost:3000/auth/callback` for local dev.

(Google OAuth is already configured for Sculpt.)

### 4. Deploy to Vercel + DNS

```bash
cd ~/sculpt-curate
git init && git add . && git commit -m "Initial commit"
gh repo create sculpt-curate --private --source=. --remote=origin --push
```

In Vercel:
- Import `vthubz/sculpt-curate`.
- Add the two `NEXT_PUBLIC_SUPABASE_*` env vars from `.env.local`.
- Add a custom domain: `curate.huber.llc`.

In your DNS provider (huber.llc):
- Add a CNAME from `curate` → `cname.vercel-dns.com`.

---

## Local development

```bash
npm install
npm run dev
# → http://localhost:3000
```

---

## What's in this repo

- `src/app/page.tsx` — landing + sign-in.
- `src/app/review/page.tsx` — auth-gated review queue.
- `src/app/leaderboard/page.tsx` — public contributor rankings.
- `src/components/ReviewQueue.tsx` — the card UI with keyboard shortcuts.
- `src/proxy.ts` — Supabase session cookie refresher (was `middleware.ts` pre-Next-16).
- `supabase/schema.sql` — DB schema + RLS + leaderboard view.
- `scripts/seed-exercises.ts` — one-time import from free-exercise-db.

## Mobile app integration (later)

Once curated data has accumulated, the Sculpt mobile app will switch from
fetching `free-exercise-db` from GitHub raw to fetching `curated_exercises`
from Supabase. The schema is designed to drop into MiniSearch-style indexing
with `name`, `aliases`, and `muscles` weighted fields.
