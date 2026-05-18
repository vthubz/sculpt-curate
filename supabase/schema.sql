-- ─── Sculpt Curation Schema ────────────────────────────────────────
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New Query).
-- Tables share the existing Sculpt project and reuse the same auth.users.

-- 1. Canonical curated exercise catalog. Seeded once from free-exercise-db.
--    Becomes the source of truth that the Sculpt mobile app reads from.
create table if not exists curated_exercises (
  id uuid primary key default gen_random_uuid(),
  source_id text unique,                 -- original ID from free-exercise-db
  canonical_name text not null,          -- the display name users see
  original_name text,                    -- what free-exercise-db called it
  primary_muscles text[] default '{}',
  secondary_muscles text[] default '{}',
  equipment text,
  category text,                          -- lift | conditioning | stretching
  movement_pattern text,                  -- push | pull | hinge | squat | carry | rotate | core
  image_url text,
  is_approved boolean not null default false,   -- "looks well-labeled" flag
  is_hidden boolean not null default false,     -- hide from app
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  rename_count integer not null default 0,      -- how many times it's been renamed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_curated_exercises_approved on curated_exercises(is_approved) where is_hidden = false;
create index if not exists idx_curated_exercises_canonical on curated_exercises(canonical_name);

-- 2. Aliases proposed by contributors. Multiple aliases per exercise.
create table if not exists exercise_aliases (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references curated_exercises(id) on delete cascade,
  alias text not null,
  contributor_id uuid references auth.users(id),
  contributor_name text,                 -- free-text name for anon contributors
  vote_score integer not null default 0,
  is_removed boolean not null default false,
  created_at timestamptz not null default now(),
  unique(exercise_id, alias)
);

create index if not exists idx_exercise_aliases_exercise on exercise_aliases(exercise_id) where is_removed = false;

-- 3. Audit log — every approve/rename/alias/muscle action contributors take.
create table if not exists curation_actions (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references curated_exercises(id) on delete cascade,
  contributor_id uuid references auth.users(id),
  contributor_name text,                 -- free-text name for anon contributors
  action text not null,                  -- approved | renamed | aliased | hidden | unhidden | muscles
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_curation_actions_contributor on curation_actions(contributor_id);
create index if not exists idx_curation_actions_exercise on curation_actions(exercise_id);

-- 4. Contributor profile (display name on leaderboard).
create table if not exists curation_contributors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  joined_at timestamptz not null default now()
);

-- ─── Row level security ────────────────────────────────────────────
alter table curated_exercises enable row level security;
alter table exercise_aliases enable row level security;
alter table curation_actions enable row level security;
alter table curation_contributors enable row level security;

-- Reads: open to everyone (anon + auth). Even logged-out visitors can browse.
create policy "Read curated exercises" on curated_exercises for select using (true);
create policy "Read aliases" on exercise_aliases for select using (true);
create policy "Read actions" on curation_actions for select using (true);
create policy "Read contributors" on curation_contributors for select using (true);

-- Writes: only signed-in users. Friends with the link can sign in with Google.
create policy "Auth insert curated_exercises" on curated_exercises for insert with check (auth.role() = 'authenticated');
create policy "Auth update curated_exercises" on curated_exercises for update using (auth.role() = 'authenticated');

create policy "Auth insert aliases" on exercise_aliases for insert with check (auth.role() = 'authenticated');
create policy "Auth update own aliases" on exercise_aliases for update using (auth.uid() = contributor_id);

create policy "Auth insert actions" on curation_actions for insert with check (auth.uid() = contributor_id);

create policy "Auth upsert own contributor" on curation_contributors for insert with check (auth.uid() = user_id);
create policy "Auth update own contributor" on curation_contributors for update using (auth.uid() = user_id);

-- ─── Aggregates view — for the contributor leaderboard ─────────────
create or replace view curation_leaderboard as
  select
    c.user_id,
    c.display_name,
    c.avatar_url,
    count(*) filter (where a.action = 'approved')  as approvals,
    count(*) filter (where a.action = 'renamed')   as renames,
    count(*) filter (where a.action = 'aliased')   as aliases_added,
    count(*) as total_actions,
    max(a.created_at) as last_active
  from curation_contributors c
  left join curation_actions a on a.contributor_id = c.user_id
  group by c.user_id, c.display_name, c.avatar_url
  order by total_actions desc, last_active desc;
