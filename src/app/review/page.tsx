import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseServer } from '@/lib/supabase-server';
import { ReviewQueue } from '@/components/ReviewQueue';
import { SignOutButton } from '@/components/SignOutButton';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  // Ensure a contributor row exists. (Idempotent.)
  await supabase.from('curation_contributors').upsert({
    user_id: user.id,
    display_name: (user.user_metadata?.full_name as string | undefined) ?? user.email ?? 'User',
    avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  }, { onConflict: 'user_id' });

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

  // How many this user has touched.
  const { count: mine } = await supabase
    .from('curation_actions')
    .select('*', { count: 'exact', head: true })
    .eq('contributor_id', user.id);

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
          <span>
            You: <span className="text-lime-400 font-semibold">{mine ?? 0}</span>
          </span>
          <span>·</span>
          <Link href="/leaderboard" className="hover:text-zinc-100">Leaderboard</Link>
          <span>·</span>
          <SignOutButton />
        </div>
      </header>

      <ReviewQueue initial={batch ?? []} userId={user.id} />
    </main>
  );
}
