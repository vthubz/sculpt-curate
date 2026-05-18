/**
 * One-time seed: imports free-exercise-db (~800 entries) into
 * `curated_exercises` so the curation site has something to review.
 *
 * Run with:
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed-exercises.ts
 *
 * Safe to re-run — uses upsert on `source_id` so existing curated entries
 * (renamed by contributors) are preserved.
 */

const SUPABASE_URL = 'https://isevnzxvsbdjdxoinhix.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var.');
  process.exit(1);
}

const DB_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const IMG_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

interface RawExercise {
  id: string;
  name: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  category: string;
  equipment: string;
  force: string | null;
  images: string[];
}

function categoryToType(category: string): 'lift' | 'conditioning' | 'stretching' {
  const c = category.toLowerCase();
  if (c === 'cardio') return 'conditioning';
  if (c === 'stretching') return 'stretching';
  return 'lift';
}

async function main() {
  console.log('Fetching free-exercise-db…');
  const raw: RawExercise[] = await fetch(DB_URL).then((r) => r.json());
  console.log(`  ${raw.length} exercises.`);

  const rows = raw.map((e) => ({
    source_id: e.id,
    canonical_name: e.name,
    original_name: e.name,
    primary_muscles: e.primaryMuscles ?? [],
    secondary_muscles: e.secondaryMuscles ?? [],
    equipment: e.equipment ?? null,
    category: categoryToType(e.category ?? ''),
    movement_pattern: null,
    image_url: e.images?.[0] ? `${IMG_BASE}/${e.images[0]}` : null,
  }));

  // Upsert in chunks — Supabase rejects huge single payloads.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/curated_exercises?on_conflict=source_id`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY!,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(slice),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error('Upsert failed:', res.status, txt);
      process.exit(1);
    }
    console.log(`  upserted ${i + slice.length}/${rows.length}`);
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
