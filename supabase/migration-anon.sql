-- ─── Open the curation site to anonymous contributors ─────────────
-- Run this on top of schema.sql to remove the auth requirement.

-- 1. Track contributors by free-text name (stored in localStorage on the
--    client). The existing auth-user FK is kept around but optional now.
alter table curation_actions add column if not exists contributor_name text;
alter table curation_actions alter column contributor_id drop not null;

alter table exercise_aliases add column if not exists contributor_name text;

-- 2. Open writes to anon. Reads were already public.
--    (Existing auth-required policies stay — these are OR'd in.)
drop policy if exists "Anon insert curated_exercises" on curated_exercises;
drop policy if exists "Anon update curated_exercises" on curated_exercises;
drop policy if exists "Anon insert aliases" on exercise_aliases;
drop policy if exists "Anon insert actions" on curation_actions;

create policy "Anon insert curated_exercises" on curated_exercises
  for insert with check (true);
create policy "Anon update curated_exercises" on curated_exercises
  for update using (true);
create policy "Anon insert aliases" on exercise_aliases
  for insert with check (true);
create policy "Anon insert actions" on curation_actions
  for insert with check (true);

-- 3. Update the leaderboard to aggregate by contributor_name when there's
--    no auth user attached.
create or replace view curation_leaderboard as
  with named as (
    select
      coalesce(c.display_name, a.contributor_name, 'Anonymous') as display_name,
      coalesce(c.avatar_url, null) as avatar_url,
      a.action,
      a.created_at
    from curation_actions a
    left join curation_contributors c on c.user_id = a.contributor_id
  )
  select
    display_name,
    avatar_url,
    count(*) filter (where action = 'approved')  as approvals,
    count(*) filter (where action = 'renamed')   as renames,
    count(*) filter (where action = 'aliased')   as aliases_added,
    count(*) as total_actions,
    max(created_at) as last_active
  from named
  group by display_name, avatar_url
  order by total_actions desc, last_active desc;
