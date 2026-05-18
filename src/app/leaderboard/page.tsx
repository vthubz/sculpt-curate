import Link from 'next/link';
import { createSupabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

interface Row {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  approvals: number;
  renames: number;
  aliases_added: number;
  total_actions: number;
  last_active: string | null;
}

export default async function LeaderboardPage() {
  const supabase = await createSupabaseServer();
  const { data } = await supabase
    .from('curation_leaderboard')
    .select('*')
    .limit(50);

  const rows = (data ?? []) as Row[];

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-900 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-xs uppercase tracking-[0.2em] text-lime-400 font-semibold">
          Sculpt · Curation
        </Link>
        <Link href="/review" className="text-xs text-zinc-400 hover:text-zinc-100">
          Review →
        </Link>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-12 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Top curators</h1>
          <p className="text-sm text-zinc-500 mt-1">Thanks for making the app smarter.</p>
        </div>

        {rows.length === 0 ? (
          <p className="text-zinc-500 text-sm">No one's contributed yet.</p>
        ) : (
          <div className="rounded-2xl border border-zinc-800 overflow-hidden divide-y divide-zinc-900">
            {rows.map((r, i) => (
              <div key={r.user_id} className="flex items-center gap-4 px-5 py-4">
                <span className="w-6 text-zinc-500 font-mono text-sm">{i + 1}</span>
                {r.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.avatar_url} alt="" className="w-9 h-9 rounded-full" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 text-sm font-semibold">
                    {(r.display_name ?? 'U').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-zinc-100 font-semibold truncate">{r.display_name ?? 'User'}</p>
                  <p className="text-xs text-zinc-500">
                    {r.approvals} approved · {r.renames} renamed · {r.aliases_added} aliases
                  </p>
                </div>
                <span className="text-lime-400 font-bold tabular-nums">{r.total_actions}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
