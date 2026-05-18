'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import type { CuratedExercise } from '@/lib/types';

interface Props {
  initial: CuratedExercise[];
  userId: string;
}

export function ReviewQueue({ initial, userId }: Props) {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [queue, setQueue] = useState<CuratedExercise[]>(initial);
  const [busy, setBusy] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [aliasDraft, setAliasDraft] = useState('');
  const [stats, setStats] = useState({ session: 0 });

  const current = queue[0] ?? null;
  const renameRef = useRef<HTMLInputElement>(null);
  const aliasRef = useRef<HTMLInputElement>(null);

  // Reset drafts when the next card slides in.
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
      contributor_id: userId,
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
      .update({
        is_approved: true,
        approved_at: new Date().toISOString(),
        approved_by: userId,
      })
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
      approve(); // No edit → treat as approval.
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
        approved_by: userId,
      })
      .eq('id', current.id);
    await logAction(
      current.id,
      'renamed',
      { name: current.canonical_name },
      { name: newName }
    );
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
      contributor_id: userId,
    });
    if (!error) {
      await logAction(current.id, 'aliased', null, { alias });
      setAliasDraft('');
      aliasRef.current?.focus();
    }
    setBusy(false);
  };

  const skip = async () => {
    if (!current || busy) return;
    // Move to the bottom so we still come back to it.
    setQueue((q) => [...q.slice(1), q[0]]);
  };

  const hide = async () => {
    if (!current || busy) return;
    if (!confirm(`Hide "${current.canonical_name}" from the Sculpt app? (e.g. it's a duplicate or junk)`)) return;
    setBusy(true);
    await supabase.from('curated_exercises').update({ is_hidden: true }).eq('id', current.id);
    await logAction(current.id, 'hidden', { name: current.canonical_name }, null);
    setStats((s) => ({ session: s.session + 1 }));
    next();
    if (queue.length <= 3) await fetchMore();
    setBusy(false);
  };

  // Keyboard shortcuts: j approves, e rename focus, a alias focus, s skip, h hide.
  useEffect(() => {
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
      else if (e.key === 'h') { e.preventDefault(); hide(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, queue.length]);

  if (!current) {
    return (
      <div className="max-w-xl mx-auto px-6 py-24 text-center space-y-4">
        <p className="text-5xl">🎉</p>
        <h2 className="text-2xl font-bold">Queue is empty.</h2>
        <p className="text-zinc-400">Every unapproved exercise has been touched. Come back tomorrow.</p>
        <p className="text-xs text-zinc-500 pt-4">
          You approved <span className="text-lime-400 font-semibold">{stats.session}</span> this session.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-6 py-12 space-y-8">
      {/* Session counter */}
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>This session: <span className="text-lime-400 font-semibold">{stats.session}</span></span>
        <span>{queue.length} in queue</span>
      </div>

      {/* The card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        {current.image_url ? (
          <div className="aspect-video bg-zinc-950 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.image_url} alt={current.canonical_name} className="max-h-full max-w-full object-contain" />
          </div>
        ) : (
          <div className="aspect-video bg-zinc-950 flex items-center justify-center text-zinc-700 text-sm">
            no image
          </div>
        )}

        <div className="p-6 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Currently named</p>
            <p className="text-xl font-bold">{current.canonical_name}</p>
            {current.original_name && current.original_name !== current.canonical_name && (
              <p className="text-xs text-zinc-500 mt-1">original: {current.original_name}</p>
            )}
          </div>

          {/* Tags */}
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

          {/* Rename */}
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

          {/* Aliases */}
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

        {/* Action bar */}
        <div className="border-t border-zinc-800 grid grid-cols-3 divide-x divide-zinc-800">
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
            <span className="block text-[10px] text-lime-500/70 mt-0.5">J / Enter</span>
          </button>
        </div>
      </div>

      <p className="text-xs text-center text-zinc-600">
        Shortcuts: <kbd className="bg-zinc-900 px-1 rounded">E</kbd> rename ·{' '}
        <kbd className="bg-zinc-900 px-1 rounded">A</kbd> alias ·{' '}
        <kbd className="bg-zinc-900 px-1 rounded">J</kbd> approve ·{' '}
        <kbd className="bg-zinc-900 px-1 rounded">S</kbd> skip ·{' '}
        <kbd className="bg-zinc-900 px-1 rounded">H</kbd> hide
      </p>
    </div>
  );
}
