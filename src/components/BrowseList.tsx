'use client';
import { useMemo, useState } from 'react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

interface Exercise {
  id: string;
  canonical_name: string;
  original_name: string | null;
  primary_muscles: string[];
  secondary_muscles: string[];
  equipment: string | null;
  category: string | null;
  image_url: string | null;
  is_approved: boolean;
  is_low_relevancy: boolean;
  is_hidden: boolean;
  rename_count: number;
  popularity: number;
}

interface Alias {
  id: string;
  exercise_id: string;
  alias: string;
}

interface Props {
  initialExercises: Exercise[];
  initialAliases: Alias[];
}

export function BrowseList({ initialExercises, initialAliases }: Props) {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [exercises, setExercises] = useState<Exercise[]>(initialExercises);
  const [aliases, setAliases] = useState<Alias[]>(initialAliases);
  const [editing, setEditing] = useState<Exercise | null>(null);

  // Group aliases by exercise.
  const aliasesById = useMemo(() => {
    const m = new Map<string, Alias[]>();
    for (const a of aliases) {
      const list = m.get(a.exercise_id) ?? [];
      list.push(a);
      m.set(a.exercise_id, list);
    }
    return m;
  }, [aliases]);

  // Aggregate totals for the header.
  const totals = {
    all: exercises.length,
    approved: exercises.filter((e) => e.is_approved && !e.is_low_relevancy).length,
    lowRel: exercises.filter((e) => e.is_low_relevancy).length,
    unreviewed: exercises.filter((e) => !e.is_approved).length,
  };

  // Group by primary muscle (one row per (muscle, exercise) pair).
  const sectioned = useMemo(() => {
    const groups = new Map<string, Exercise[]>();
    for (const ex of exercises) {
      const muscles = ex.primary_muscles?.length ? ex.primary_muscles : ['unspecified'];
      for (const m of muscles) {
        const list = groups.get(m) ?? [];
        list.push(ex);
        groups.set(m, list);
      }
    }
    return [...groups.entries()]
      .map(([muscle, exs]) => {
        const sorted = [...exs].sort((a, b) => {
          if (a.is_low_relevancy !== b.is_low_relevancy) return a.is_low_relevancy ? 1 : -1;
          if (a.popularity !== b.popularity) return b.popularity - a.popularity;
          const aA = aliasesById.get(a.id)?.length ?? 0;
          const bA = aliasesById.get(b.id)?.length ?? 0;
          if (aA !== bA) return bA - aA;
          if (a.is_approved !== b.is_approved) return a.is_approved ? -1 : 1;
          return a.canonical_name.localeCompare(b.canonical_name);
        });
        return { muscle, exercises: sorted };
      })
      .sort((a, b) => b.exercises.length - a.exercises.length);
  }, [exercises, aliasesById]);

  return (
    <>
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-10">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">How the system sees them</h1>
          <p className="text-sm text-zinc-500">
            Organized by primary muscle. Within each group, popularity-tiered staples
            come first, then alias count, then approved status, then alphabetical.
            Low-relevancy sinks. <span className="text-zinc-300">Click any row to edit.</span>
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
                const aliasCount = aliasesById.get(ex.id)?.length ?? 0;
                const status = ex.is_low_relevancy
                  ? { label: 'low rel.', cls: 'text-amber-400' }
                  : ex.is_approved
                  ? { label: 'approved', cls: 'text-lime-400' }
                  : { label: 'unreviewed', cls: 'text-zinc-500' };
                return (
                  <button
                    key={`${muscle}-${ex.id}`}
                    onClick={() => setEditing(ex)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-900/60 transition text-left"
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
                        {aliasCount} {aliasCount === 1 ? 'alias' : 'aliases'}
                      </p>
                    </div>
                    <span className="text-zinc-700 text-sm">›</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {editing && (
        <EditModal
          exercise={editing}
          existingAliases={aliasesById.get(editing.id) ?? []}
          onClose={() => setEditing(null)}
          onSave={(updated, newAliases, removedAliasIds) => {
            setExercises((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
            setAliases((prev) => [
              ...prev.filter((a) => a.exercise_id !== updated.id || !removedAliasIds.includes(a.id)),
              ...newAliases,
            ]);
            setEditing(null);
          }}
          supabase={supabase}
        />
      )}
    </>
  );
}

// ─── Edit modal ──────────────────────────────────────────────────

function EditModal({
  exercise,
  existingAliases,
  onClose,
  onSave,
  supabase,
}: {
  exercise: Exercise;
  existingAliases: Alias[];
  onClose: () => void;
  onSave: (e: Exercise, newAliases: Alias[], removedAliasIds: string[]) => void;
  supabase: ReturnType<typeof createSupabaseBrowser>;
}) {
  const [canonical, setCanonical] = useState(exercise.canonical_name);
  const [popularity, setPopularity] = useState(String(exercise.popularity));
  const [muscles, setMuscles] = useState(exercise.primary_muscles.join(', '));
  const [isApproved, setIsApproved] = useState(exercise.is_approved);
  const [isLowRel, setIsLowRel] = useState(exercise.is_low_relevancy);
  const [isHidden, setIsHidden] = useState(exercise.is_hidden);
  // Aliases: existing ones + pending additions, with deletions tracked by id.
  const [aliasList, setAliasList] = useState<Alias[]>(existingAliases);
  const [removedAliasIds, setRemovedAliasIds] = useState<string[]>([]);
  const [newAliasDraft, setNewAliasDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const addAlias = () => {
    const v = newAliasDraft.trim();
    if (!v) return;
    if (aliasList.some((a) => a.alias.toLowerCase() === v.toLowerCase())) {
      setNewAliasDraft('');
      return;
    }
    // Temp id for unsaved aliases — replaced after the insert returns.
    setAliasList((prev) => [...prev, { id: `tmp-${Date.now()}`, exercise_id: exercise.id, alias: v }]);
    setNewAliasDraft('');
  };

  const removeAlias = (id: string) => {
    setAliasList((prev) => prev.filter((a) => a.id !== id));
    if (!id.startsWith('tmp-')) setRemovedAliasIds((prev) => [...prev, id]);
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const popNum = Number.isFinite(parseInt(popularity, 10)) ? parseInt(popularity, 10) : 0;
      const muscleList = muscles
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      const updated: Exercise = {
        ...exercise,
        canonical_name: canonical.trim() || exercise.canonical_name,
        popularity: popNum,
        primary_muscles: muscleList,
        is_approved: isApproved,
        is_low_relevancy: isLowRel,
        is_hidden: isHidden,
      };

      await supabase
        .from('curated_exercises')
        .update({
          canonical_name: updated.canonical_name,
          popularity: updated.popularity,
          primary_muscles: updated.primary_muscles,
          is_approved: updated.is_approved,
          is_low_relevancy: updated.is_low_relevancy,
          is_hidden: updated.is_hidden,
          approved_at: updated.is_approved ? new Date().toISOString() : null,
        })
        .eq('id', exercise.id);

      // Persist alias deletions.
      if (removedAliasIds.length > 0) {
        await supabase.from('exercise_aliases').delete().in('id', removedAliasIds);
      }

      // Persist alias additions.
      const additions = aliasList.filter((a) => a.id.startsWith('tmp-'));
      const insertedAliases: Alias[] = [];
      for (const a of additions) {
        const { data } = await supabase
          .from('exercise_aliases')
          .upsert(
            { exercise_id: exercise.id, alias: a.alias },
            { onConflict: 'exercise_id,alias' }
          )
          .select()
          .single();
        if (data) insertedAliases.push(data as Alias);
      }

      onSave(updated, insertedAliases, removedAliasIds);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-zinc-900 border border-zinc-800 rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between sticky top-0 bg-zinc-900 z-10">
          <p className="text-xs uppercase tracking-[0.2em] text-lime-400 font-semibold">Edit exercise</p>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-100 text-lg leading-none">
            ✕
          </button>
        </div>

        <div className="p-6 space-y-5">
          {exercise.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={exercise.image_url}
              alt=""
              className="w-full aspect-video object-contain rounded-lg bg-zinc-950 border border-zinc-800"
            />
          )}

          <Field label="Canonical name">
            <input
              value={canonical}
              onChange={(e) => setCanonical(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-lime-400/50"
            />
            {exercise.original_name && exercise.original_name !== canonical && (
              <p className="text-xs text-zinc-500 mt-1">original: {exercise.original_name}</p>
            )}
          </Field>

          <Field
            label="Aliases"
            hint="Other names users might type to find this exercise."
          >
            <div className="flex flex-wrap gap-1.5 mb-2">
              {aliasList.length === 0 ? (
                <span className="text-xs text-zinc-600">No aliases yet.</span>
              ) : (
                aliasList.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-200"
                  >
                    {a.alias}
                    <button
                      onClick={() => removeAlias(a.id)}
                      className="text-zinc-500 hover:text-red-400 -mr-1"
                    >
                      ✕
                    </button>
                  </span>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={newAliasDraft}
                onChange={(e) => setNewAliasDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addAlias())}
                placeholder="Add an alias…"
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-lime-400/50"
              />
              <button
                onClick={addAlias}
                disabled={!newAliasDraft.trim()}
                className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 text-sm font-semibold disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </Field>

          <Field label="Primary muscles" hint="Comma-separated. Lowercase.">
            <input
              value={muscles}
              onChange={(e) => setMuscles(e.target.value)}
              placeholder="chest, triceps"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-lime-400/50"
            />
          </Field>

          <Field label="Popularity (0–100)" hint="Higher = ranks higher in search.">
            <input
              type="number"
              min="0"
              max="100"
              value={popularity}
              onChange={(e) => setPopularity(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-lime-400/50"
            />
          </Field>

          <div className="space-y-2">
            <Toggle label="Approved" hint="Marks the exercise as well-labeled." value={isApproved} onChange={setIsApproved} />
            <Toggle label="Low relevancy" hint="Sinks this exercise in the app's search ranking." value={isLowRel} onChange={setIsLowRel} />
            <Toggle label="Hidden" hint="Removes from the app entirely." value={isHidden} onChange={setIsHidden} />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-zinc-800 flex justify-end gap-2 sticky bottom-0 bg-zinc-900">
          <button onClick={onClose} className="rounded-lg border border-zinc-800 hover:border-zinc-700 px-4 py-2 text-sm text-zinc-300">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-lime-400 hover:bg-lime-300 text-zinc-950 px-4 py-2 text-sm font-semibold disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs uppercase tracking-wider text-zinc-500 font-semibold">{label}</label>
      {children}
      {hint && <p className="text-xs text-zinc-600">{hint}</p>}
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="w-full flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-zinc-800/40 transition"
    >
      <div>
        <p className="text-sm text-zinc-100 font-semibold">{label}</p>
        {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      </div>
      <span
        className={`mt-0.5 inline-block w-9 h-5 rounded-full transition ${value ? 'bg-lime-400' : 'bg-zinc-700'}`}
      >
        <span
          className={`block w-4 h-4 rounded-full bg-white shadow transition mt-0.5 ${value ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
        />
      </span>
    </button>
  );
}
