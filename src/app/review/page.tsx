import Link from 'next/link';
import { createSupabaseServer } from '@/lib/supabase-server';
import { ReviewQueue } from '@/components/ReviewQueue';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const supabase = await createSupabaseServer();

  // First batch of unapproved exercises.
  const { data: batch } = await supabase
    .from('curated_exercises')
    .select('*')
    .eq('is_approved', false)
    .eq('is_hidden', false)
    .order('rename_count', { ascending: true })
    .order('canonical_name', { ascending: true })
    .limit(25);

  const { count: total } = await supabase
    .from('curated_exercises')
    .select('*', { count: 'exact', head: true });
  const { count: approved } = await supabase
    .from('curated_exercises')
    .select('*', { count: 'exact', head: true })
    .eq('is_approved', true);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-900 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-xs uppercase tracking-[0.2em] text-lime-400 font-semibold">
          Sculpt · Curation
        </Link>
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span>
            <span className="text-zinc-300 font-semibold">{approved ?? 0}</span> / {total ?? '…'} approved
          </span>
          <span>·</span>
          <Link href="/popular" className="hover:text-zinc-100">Seed popular</Link>
          <span>·</span>
          <Link href="/browse" className="hover:text-zinc-100">Browse</Link>
          <span>·</span>
          <Link href="/leaderboard" className="hover:text-zinc-100">Leaderboard</Link>
        </div>
      </header>

      <ReviewQueue initial={batch ?? []} />
    </main>
  );
}
