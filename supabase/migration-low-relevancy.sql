-- Adds a "Low Relevancy" flag — exercise stays in the catalog but is
-- deprioritized in the Sculpt app's search/suggestion ranking. Sits between
-- Hide (remove from app) and Skip (defer decision) on the review queue.

alter table curated_exercises
  add column if not exists is_low_relevancy boolean not null default false;
