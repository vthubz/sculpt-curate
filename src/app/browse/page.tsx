import Link from 'next/link';
import { createSupabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  canonical_name: string;
  primary_muscles: string[];
  image_url: string | null;
  is_approved: boolean;
  is_low_relevancy: boolean;
  rename_count: number;
  popularity: number;
}

export default async function BrowsePage() {
  const supabase = await createSupabaseServer();

  const [exRes, aliasRes] = await Promise.all([
    supabase
      .from('curated_exercises')
      .select('id, canonical_name, primary_muscles, image_url, is_approved, is_low_relevancy, rename_count, popularity')
      .eq('is_hidden', false),
    supabase
      .from('exercise_aliases')
      .select('exercise_id')
      .eq('is_removed', false),
  ]);

  const exercises = (exRes.data ?? []) as Row[];

  // Count aliases per exercise.
  const aliasCount = new Map<string, number>();
  for (const a of aliasRes.data ?? []) {
    const id = (a as { exercise_id: string }).exercise_id;
    aliasCount.set(id, (aliasCount.get(id) ?? 0) + 1);
  }

  // Pull out the few global tallies for the page header.
  const totals = {
    all: exercises.length,
    approved: exercises.filter((e) => e.is_approved && !e.is_low_relevancy).length,
    lowRel: exercises.filter((e) => e.is_low_relevancy).length,
    unreviewed: exercises.filter((e) => !e.is_approved).length,
  };

  // Group by every primary muscle (an exercise listed under multiple
  // muscles shows up under each — gives the full picture per group).
  const groups = new Map<string, Row[]>();
  for (const ex of exercises) {
    const muscles = ex.primary_muscles?.length ? ex.primary_muscles : ['unspecified'];
    for (const m of muscles) {
      const list = groups.get(m) ?? [];
      list.push(ex);
      groups.set(m, list);
    }
  }

  // Within each muscle group:
  // 1. Low-relevancy sinks to the bottom (matches the mobile app's ranking).
  // 2. Otherwise, popularity score wins — the hand-curated tier list of
  //    common gym lifts dominates so Bench/Squat/Deadlift float to the top.
  // 3. Tie-break by alias count (friends signaling "this matters").
  // 4. Then approved before unreviewed (a curated win edges out a 0-pop unknown).
  // 5. Finally alphabetical.
  const sectioned = [...groups.entries()]
    .map(([muscle, exs]) => {
      const sorted = [...exs].sort((a, b) => {
        if (a.is_low_relevancy !== b.is_low_relevancy) return a.is_low_relevancy ? 1 : -1;
        if (a.popularity !== b.popularity) return b.popularity - a.popularity;
        const aA = aliasCount.get(a.id) ?? 0;
        const bA = aliasCount.get(b.id) ?? 0;
        if (aA !== bA) return bA - aA;
        if (a.is_approved !== b.is_approved) return a.is_approved ? -1 : 1;
        return a.canonical_name.localeCompare(b.canonical_name);
      });
      return { muscle, exercises: sorted };
    })
    .sort((a, b) => b.exercises.length - a.exercises.length); // biggest groups first

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-900 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-xs uppercase tracking-[0.2em] text-lime-400 font-semibold">
          Sculpt · Curation
        </Link>
        <div className="flex items-center gap-4 text-xs text-zinc-400">
          <Link href="/review" className="hover:text-zinc-100">Review →</Link>
          <span>·</span>
          <Link href="/leaderboard" className="hover:text-zinc-100">Leaderboard</Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-10">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">How the system sees them</h1>
          <p className="text-sm text-zinc-500">
            Organized by primary muscle. Within each group, the most common gym
            exercises come first — driven by a hand-curated popularity tier
            list. Alias counts and approval status are the next tiebreakers.
            Low-relevancy exercises always sink to the bottom.
          </p>
          <div className="flex gap-4 text-xs text-zinc-400 pt-2">
            <span><b className="text-lime-400">{totals.approved}</b> approved</span>
            <span>· <b className="text-zinc-300">{totals.unreviewed}</b> unreviewed</span>
            <span>· <b className="text-amber-400">{totals.lowRel}</b> low rel</span>
            <span>· <b className="text-zinc-500">{totals.all}</b> total</span>
          </div>
        </div>

        {sectioned.map(({ muscle, exercises: rows }) => (
          <section key={muscle} className="space-y-3">
            <div className="flex items-baseline gap-3">
              <h2 className="text-xs uppercase tracking-[0.2em] text-lime-400 font-semibold capitalize">
                {muscle}
              </h2>
              <span className="text-xs text-zinc-600">{rows.length}</span>
            </div>
            <div className="space-y-1">
              {rows.map((ex) => {
                const aliases = aliasCount.get(ex.id) ?? 0;
                const status = ex.is_low_relevancy
                  ? { label: 'low rel.', cls: 'text-amber-400' }
                  : ex.is_approved
                  ? { label: 'approved', cls: 'text-lime-400' }
                  : { label: 'unreviewed', cls: 'text-zinc-500' };
                return (
                  <div
                    key={`${muscle}-${ex.id}`}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-900/60 transition"
                  >
                    {ex.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={ex.image_url}
                        alt=""
                        className="w-10 h-10 rounded object-cover bg-zinc-900 border border-zinc-800"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-zinc-900 border border-zinc-800" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-100 truncate">{ex.canonical_name}</p>
                      <p className="text-xs text-zinc-500">
                        <span className={status.cls}>{status.label}</span>
                        {ex.popularity > 0 && (
                          <>
                            {' · '}
                            <span className="text-zinc-400">pop {ex.popularity}</span>
                          </>
                        )}
                        {' · '}
                        {aliases} {aliases === 1 ? 'alias' : 'aliases'}
                        {ex.rename_count > 0 && ` · ${ex.rename_count} ${ex.rename_count === 1 ? 'rename' : 'renames'}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
