'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import type { CuratedExercise } from '@/lib/types';

const NAME_KEY = 'sculpt-curate.name';

interface Props {
  initial: CuratedExercise[];
}

export function ReviewQueue({ initial }: Props) {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [queue, setQueue] = useState<CuratedExercise[]>(initial);
  const [busy, setBusy] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [aliasDraft, setAliasDraft] = useState('');
  const [stats, setStats] = useState({ session: 0 });

  // Free-text display name stored in localStorage. Asked once.
  const [name, setName] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(NAME_KEY) : null;
    if (stored) setName(stored);
  }, []);

  const saveName = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    window.localStorage.setItem(NAME_KEY, trimmed);
    setName(trimmed);
  };

  const current = queue[0] ?? null;
  const renameRef = useRef<HTMLInputElement>(null);
  const aliasRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRenameDraft(current?.canonical_name ?? '');
    setAliasDraft('');
  }, [current?.id, current?.canonical_name]);

  const fetchMore = useCallback(async () => {
    const { data } = await supabase
      .from('curated_exercises')
      .select('*')
      .eq('is_approved', false)
      .eq('is_hidden', false)
      .order('rename_count', { ascending: true })
      .order('canonical_name', { ascending: true })
      .limit(25);
    setQueue(data ?? []);
  }, [supabase]);

  const next = useCallback(() => setQueue((q) => q.slice(1)), []);

  const logAction = async (exerciseId: string, action: string, before: unknown, after: unknown) => {
    await supabase.from('curation_actions').insert({
      exercise_id: exerciseId,
      contributor_name: name,
      action,
      before_value: before ?? null,
      after_value: after ?? null,
    });
  };

  const approve = async () => {
    if (!current || busy) return;
    setBusy(true);
    await supabase
      .from('curated_exercises')
      .update({ is_approved: true, approved_at: new Date().toISOString() })
      .eq('id', current.id);
    await logAction(current.id, 'approved', { name: current.canonical_name }, null);
    setStats((s) => ({ session: s.session + 1 }));
    next();
    if (queue.length <= 3) await fetchMore();
    setBusy(false);
  };

  const rename = async () => {
    if (!current || busy) return;
    const newName = renameDraft.trim();
    if (!newName || newName === current.canonical_name) {
      approve();
      return;
    }
    setBusy(true);
    await supabase
      .from('curated_exercises')
      .update({
        canonical_name: newName,
        rename_count: current.rename_count + 1,
        is_approved: true,
        approved_at: new Date().toISOString(),
      })
      .eq('id', current.id);
    await logAction(current.id, 'renamed', { name: current.canonical_name }, { name: newName });
    setStats((s) => ({ session: s.session + 1 }));
    next();
    if (queue.length <= 3) await fetchMore();
    setBusy(false);
  };

  const addAlias = async () => {
    if (!current || busy) return;
    const alias = aliasDraft.trim();
    if (!alias) return;
    setBusy(true);
    const { error } = await supabase.from('exercise_aliases').insert({
      exercise_id: current.id,
      alias,
      contributor_name: name,
    });
    if (!error) {
      await logAction(current.id, 'aliased', null, { alias });
      setAliasDraft('');
      aliasRef.current?.focus();
    }
    setBusy(false);
  };

  const skip = () => {
    if (!current || busy) return;
    setQueue((q) => [...q.slice(1), q[0]]);
  };

  const hide = async () => {
    if (!current || busy) return;
    if (!confirm(`Hide "${current.canonical_name}" from the Sculpt app? (duplicate, junk, etc.)`)) return;
    setBusy(true);
    await supabase.from('curated_exercises').update({ is_hidden: true }).eq('id', current.id);
    await logAction(current.id, 'hidden', { name: current.canonical_name }, null);
    setStats((s) => ({ session: s.session + 1 }));
    next();
    if (queue.length <= 3) await fetchMore();
    setBusy(false);
  };

  const markLowRelevancy = async () => {
    if (!current || busy) return;
    setBusy(true);
    // Approve + flag as low relevancy. Stays in the app but ranked low.
    await supabase
      .from('curated_exercises')
      .update({
        is_low_relevancy: true,
        is_approved: true,
        approved_at: new Date().toISOString(),
      })
      .eq('id', current.id);
    await logAction(current.id, 'low_relevancy', { name: current.canonical_name }, null);
    setStats((s) => ({ session: s.session + 1 }));
    next();
    if (queue.length <= 3) await fetchMore();
    setBusy(false);
  };

  useEffect(() => {
    if (!name) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') {
        if (e.key === 'Enter' && (e.target as HTMLInputElement) === renameRef.current) {
          e.preventDefault(); rename();
        }
        if (e.key === 'Enter' && (e.target as HTMLInputElement) === aliasRef.current) {
          e.preventDefault(); addAlias();
        }
        return;
      }
      if (e.key === 'j' || e.key === 'Enter') { e.preventDefault(); approve(); }
      else if (e.key === 'e') { e.preventDefault(); renameRef.current?.focus(); }
      else if (e.key === 'a') { e.preventDefault(); aliasRef.current?.focus(); }
      else if (e.key === 's') { e.preventDefault(); skip(); }
      else if (e.key === 'l') { e.preventDefault(); markLowRelevancy(); }
      else if (e.key === 'h') { e.preventDefault(); hide(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, queue.length, name]);

  // ─── Name prompt (one-time, stored in localStorage) ───
  if (!name) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 space-y-6">
        <h2 className="text-2xl font-bold">What's your name?</h2>
        <p className="text-sm text-zinc-400">
          So you get credit on the leaderboard. Just a label — no account, no email. Stored on this device only.
        </p>
        <div className="flex gap-2">
          <input
            ref={nameRef}
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveName(); }}
            placeholder="e.g. Ryan"
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-zinc-100 focus:outline-none focus:border-lime-400/50"
          />
          <button
            disabled={!nameDraft.trim()}
            onClick={saveName}
            className="rounded-lg bg-lime-400 hover:bg-lime-300 text-zinc-950 font-semibold px-5 disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="max-w-xl mx-auto px-6 py-24 text-center space-y-4">
        <p className="text-5xl">🎉</p>
        <h2 className="text-2xl font-bold">Queue is empty.</h2>
        <p className="text-zinc-400">Every unapproved exercise has been touched. Come back tomorrow.</p>
        <p className="text-xs text-zinc-500 pt-4">
          You handled <span className="text-lime-400 font-semibold">{stats.session}</span> this session.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-6 py-12 space-y-8">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>Signed as <span className="text-zinc-300 font-semibold">{name}</span> · {stats.session} this session</span>
        <span>{queue.length} in queue</span>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <ExerciseImages url={current.image_url} alt={current.canonical_name} />

        <div className="p-6 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Currently named</p>
            <p className="text-xl font-bold">{current.canonical_name}</p>
            {current.original_name && current.original_name !== current.canonical_name && (
              <p className="text-xs text-zinc-500 mt-1">original: {current.original_name}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 text-xs">
            {current.category && (
              <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-zinc-300">{current.category}</span>
            )}
            {current.equipment && (
              <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-zinc-300">{current.equipment}</span>
            )}
            {current.primary_muscles.map((m) => (
              <span key={m} className="rounded-full bg-lime-400/10 text-lime-300 px-2.5 py-1 capitalize">
                {m}
              </span>
            ))}
            {current.secondary_muscles.map((m) => (
              <span key={m} className="rounded-full bg-zinc-800/50 text-zinc-400 px-2.5 py-1 capitalize">
                {m}
              </span>
            ))}
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-zinc-500">Rename ✏</label>
            <div className="flex gap-2">
              <input
                ref={renameRef}
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                placeholder="Type a cleaner name…"
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-lime-400/50"
              />
              <button
                disabled={busy}
                onClick={rename}
                className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 text-sm font-semibold disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-zinc-500">
              Add an alias <span className="text-zinc-600">(e.g. "RDL", "BB bench", "OHP")</span>
            </label>
            <div className="flex gap-2">
              <input
                ref={aliasRef}
                value={aliasDraft}
                onChange={(e) => setAliasDraft(e.target.value)}
                placeholder="What else do you call this?"
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-lime-400/50"
              />
              <button
                disabled={busy || !aliasDraft.trim()}
                onClick={addAlias}
                className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 text-sm font-semibold disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-zinc-800 grid grid-cols-4 divide-x divide-zinc-800">
          <button
            disabled={busy}
            onClick={hide}
            className="py-4 text-sm text-zinc-500 hover:text-red-400 disabled:opacity-40 transition"
          >
            <span className="font-semibold">Hide</span>
            <span className="block text-[10px] text-zinc-600 mt-0.5">H</span>
          </button>
          <button
            disabled={busy}
            onClick={markLowRelevancy}
            className="py-4 text-sm text-zinc-500 hover:text-amber-400 disabled:opacity-40 transition"
          >
            <span className="font-semibold">Low rel.</span>
            <span className="block text-[10px] text-zinc-600 mt-0.5">L</span>
          </button>
          <button
            disabled={busy}
            onClick={skip}
            className="py-4 text-sm text-zinc-400 hover:text-zinc-100 disabled:opacity-40 transition"
          >
            <span className="font-semibold">Skip</span>
            <span className="block text-[10px] text-zinc-600 mt-0.5">S</span>
          </button>
          <button
            disabled={busy}
            onClick={approve}
            className="py-4 text-sm bg-lime-400/10 text-lime-300 hover:bg-lime-400/20 disabled:opacity-40 transition"
          >
            <span className="font-semibold">Looks good ✓</span>
            <span className="block text-[10px] text-lime-500/70 mt-0.5">J / ↵</span>
          </button>
        </div>
      </div>

      <p className="text-xs text-center text-zinc-600">
        Shortcuts: <kbd className="bg-zinc-900 px-1 rounded">E</kbd> rename ·{' '}
        <kbd className="bg-zinc-900 px-1 rounded">A</kbd> alias ·{' '}
        <kbd className="bg-zinc-900 px-1 rounded">J</kbd> approve ·{' '}
        <kbd className="bg-zinc-900 px-1 rounded">L</kbd> low rel ·{' '}
        <kbd className="bg-zinc-900 px-1 rounded">S</kbd> skip ·{' '}
        <kbd className="bg-zinc-900 px-1 rounded">H</kbd> hide
      </p>
    </div>
  );
}

// ─── Side-by-side image pair ────────────────────────────────────────
// free-exercise-db ships every exercise with two photos ending in /0.jpg
// and /1.jpg (a start + finish frame). We show both so the curator has
// the full picture — matches the mobile app's two-frame loop.
function ExerciseImages({ url, alt }: { url: string | null; alt: string }) {
  if (!url) {
    return (
      <div className="aspect-video bg-zinc-950 flex items-center justify-center text-zinc-700 text-sm">
        no image
      </div>
    );
  }
  const secondary = url.replace(/\/0\.jpg$/, '/1.jpg');
  const hasSecondary = secondary !== url;
  if (!hasSecondary) {
    return (
      <div className="aspect-video bg-zinc-950 flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={alt} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 bg-zinc-950 gap-px">
      <div className="aspect-square flex items-center justify-center bg-zinc-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`${alt} start`} className="max-h-full max-w-full object-contain" />
      </div>
      <div className="aspect-square flex items-center justify-center bg-zinc-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={secondary} alt={`${alt} finish`} className="max-h-full max-w-full object-contain" />
      </div>
    </div>
  );
}
