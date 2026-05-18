import Link from 'next/link';
import { createSupabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = await createSupabaseServer();
  const { count: total } = await supabase
    .from('curated_exercises')
    .select('*', { count: 'exact', head: true });
  const { count: approved } = await supabase
    .from('curated_exercises')
    .select('*', { count: 'exact', head: true })
    .eq('is_approved', true);

  const pct = total && total > 0 ? Math.round(((approved ?? 0) / total) * 100) : 0;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <div className="max-w-2xl mx-auto px-6 py-24 flex-1 flex flex-col justify-center gap-12">
        <div className="space-y-4">
          <p className="text-xs uppercase tracking-[0.2em] text-lime-400 font-semibold">Sculpt · Curation</p>
          <h1 className="text-5xl font-black tracking-tight">Help us name workouts.</h1>
          <p className="text-lg text-zinc-400 leading-relaxed">
            We have <span className="text-zinc-100 font-semibold">{total ?? '…'}</span> exercises pulled from an open
            database, but the names are awkward. Hop in, rename the weird ones, and the Sculpt app gets smarter the
            moment you tap save.
          </p>
        </div>

        {total ? (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-zinc-500 uppercase tracking-wider">
              <span>Progress</span>
              <span>{approved ?? 0} of {total} approved · {pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-zinc-900 overflow-hidden">
              <div className="h-full bg-lime-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : null}

        <Link
          href="/review"
          className="self-start inline-flex items-center gap-3 rounded-full bg-lime-400 px-6 py-3 font-semibold text-zinc-950 transition hover:bg-lime-300"
        >
          Start curating →
        </Link>

        <div className="text-sm text-zinc-500 space-y-2 pt-8 border-t border-zinc-900">
          <p>What you can do here:</p>
          <ul className="space-y-1 text-zinc-400">
            <li>✓ Approve exercises that already look right.</li>
            <li>✏ Rename anything awkward (e.g. "Barbell Bench Press - Medium Grip" → "Bench Press").</li>
            <li>➕ Add aliases you'd type when searching ("RDL", "OHP", "BB row").</li>
          </ul>
        </div>

        <p className="text-xs text-zinc-600">
          <Link href="/leaderboard" className="text-zinc-400 hover:text-zinc-100 underline">leaderboard</Link>
        </p>
      </div>
    </main>
  );
}
