import Link from 'next/link';
import { createSupabaseServer } from '@/lib/supabase-server';
import { BrowseList } from '@/components/BrowseList';

export const dynamic = 'force-dynamic';

export default async function BrowsePage() {
  const supabase = await createSupabaseServer();

  const [exRes, aliasRes] = await Promise.all([
    supabase
      .from('curated_exercises')
      .select('id, canonical_name, original_name, primary_muscles, secondary_muscles, equipment, category, image_url, is_approved, is_low_relevancy, is_hidden, rename_count, popularity')
      .eq('is_hidden', false),
    supabase
      .from('exercise_aliases')
      .select('id, exercise_id, alias')
      .eq('is_removed', false),
  ]);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-900 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-xs uppercase tracking-[0.2em] text-lime-400 font-semibold">
          Sculpt · Curation
        </Link>
        <div className="flex items-center gap-4 text-xs text-zinc-400">
          <Link href="/popular" className="hover:text-zinc-100">Seed popular</Link>
          <span>·</span>
          <Link href="/review" className="hover:text-zinc-100">Review →</Link>
          <span>·</span>
          <Link href="/leaderboard" className="hover:text-zinc-100">Leaderboard</Link>
        </div>
      </header>

      <BrowseList
        initialExercises={(exRes.data ?? []) as any}
        initialAliases={(aliasRes.data ?? []) as any}
      />
    </main>
  );
}
