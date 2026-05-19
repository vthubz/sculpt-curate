-- Top-down popularity seeding by movement pattern.
-- The user types popular exercises into pattern tabs (Push, Pull, Squat,
-- Hinge, Carry, Core). Each seed gets matched against curated_exercises;
-- the position in their list IS the popularity ranking within the pattern.

create table if not exists popularity_seeds (
  id uuid primary key default gen_random_uuid(),
  pattern text not null,         -- 'Push' | 'Pull' | 'Squat' | 'Hinge' | 'Carry' | 'Core'
  name text not null,            -- user-typed canonical
  rank integer not null,         -- 1 = most popular within pattern
  contributor_name text,
  created_at timestamptz not null default now()
);
create unique index if not exists popularity_seeds_pattern_lower_name
  on popularity_seeds(pattern, lower(name));
create index if not exists popularity_seeds_pattern_rank
  on popularity_seeds(pattern, rank);

create table if not exists seed_matches (
  seed_id uuid not null references popularity_seeds(id) on delete cascade,
  exercise_id uuid not null references curated_exercises(id) on delete cascade,
  match_quality text not null check (match_quality in ('perfect', 'similar', 'irrelevant')),
  contributor_name text,
  created_at timestamptz not null default now(),
  primary key (seed_id, exercise_id)
);

alter table popularity_seeds enable row level security;
alter table seed_matches enable row level security;

create policy "Read popularity_seeds" on popularity_seeds for select using (true);
create policy "Anon insert popularity_seeds" on popularity_seeds for insert with check (true);
create policy "Anon update popularity_seeds" on popularity_seeds for update using (true);
create policy "Anon delete popularity_seeds" on popularity_seeds for delete using (true);

create policy "Read seed_matches" on seed_matches for select using (true);
create policy "Anon insert seed_matches" on seed_matches for insert with check (true);
create policy "Anon update seed_matches" on seed_matches for update using (true);
create policy "Anon delete seed_matches" on seed_matches for delete using (true);
