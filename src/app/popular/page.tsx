import Link from 'next/link';
import { createSupabaseServer } from '@/lib/supabase-server';
import { PopularSeeder } from '@/components/PopularSeeder';

export const dynamic = 'force-dynamic';

export default async function PopularPage() {
  const supabase = await createSupabaseServer();

  // Pull everything in parallel — small payloads.
  const [exRes, aliasRes, seedRes, matchRes] = await Promise.all([
    supabase
      .from('curated_exercises')
      .select('id, source_id, canonical_name, original_name, primary_muscles, secondary_muscles, equipment, category, image_url, is_approved, is_low_relevancy, popularity'),
    supabase.from('exercise_aliases').select('exercise_id, alias').eq('is_removed', false),
    supabase.from('popularity_seeds').select('*').order('pattern').order('rank'),
    supabase.from('seed_matches').select('*'),
  ]);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-900 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-xs uppercase tracking-[0.2em] text-lime-400 font-semibold">
          Sculpt · Curation
        </Link>
        <div className="flex items-center gap-4 text-xs text-zinc-400">
          <Link href="/browse" className="hover:text-zinc-100">Browse</Link>
          <span>·</span>
          <Link href="/review" className="hover:text-zinc-100">Review</Link>
          <span>·</span>
          <Link href="/leaderboard" className="hover:text-zinc-100">Leaderboard</Link>
        </div>
      </header>

      <PopularSeeder
        initialExercises={(exRes.data ?? []) as any}
        initialAliases={(aliasRes.data ?? []) as any}
        initialSeeds={(seedRes.data ?? []) as any}
        initialMatches={(matchRes.data ?? []) as any}
      />
    </main>
  );
}
