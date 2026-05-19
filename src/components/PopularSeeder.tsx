'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MiniSearch from 'minisearch';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

const PATTERNS = ['Push', 'Pull', 'Squat', 'Hinge', 'Carry', 'Core'] as const;
type Pattern = typeof PATTERNS[number];

// Loose mapping from primary_muscles → suggested pattern. Used only to
// pre-pick a sensible default `category`/primary muscle when adding new.
const PATTERN_DEFAULT_MUSCLES: Record<Pattern, string[]> = {
  Push: ['chest'],
  Pull: ['lats'],
  Squat: ['quadriceps'],
  Hinge: ['hamstrings'],
  Carry: ['forearms'],
  Core: ['abdominals'],
};

const NAME_KEY = 'sculpt-curate.name';
const RANK_STEP = 5;
const MAX_RANK_POPULARITY = 100;

interface Exercise {
  id: string;
  source_id: string | null;
  canonical_name: string;
  original_name: string | null;
  primary_muscles: string[];
  secondary_muscles: string[];
  equipment: string | null;
  category: string | null;
  image_url: string | null;
  is_approved: boolean;
  is_low_relevancy: boolean;
  popularity: number;
}

interface Alias {
  exercise_id: string;
  alias: string;
}

interface Seed {
  id: string;
  pattern: string;
  name: string;
  rank: number;
  contributor_name: string | null;
  created_at: string;
}

interface SeedMatch {
  seed_id: string;
  exercise_id: string;
  match_quality: 'perfect' | 'similar' | 'irrelevant';
}

interface Props {
  initialExercises: Exercise[];
  initialAliases: Alias[];
  initialSeeds: Seed[];
  initialMatches: SeedMatch[];
}

interface IndexDoc {
  id: string;
  name: string;
  aliases: string;
  muscles: string;
  equipment: string;
}

// Popularity number derived from the seed's rank within its pattern.
// Rank 1 → 100, rank 20 → 5, capped at 0.
function popularityForRank(rank: number): number {
  return Math.max(0, MAX_RANK_POPULARITY - (rank - 1) * RANK_STEP);
}

export function PopularSeeder({
  initialExercises, initialAliases, initialSeeds, initialMatches,
}: Props) {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [exercises, setExercises] = useState<Exercise[]>(initialExercises);
  const [aliases, setAliases] = useState<Alias[]>(initialAliases);
  const [seeds, setSeeds] = useState<Seed[]>(initialSeeds);
  const [matches, setMatches] = useState<SeedMatch[]>(initialMatches);
  const [pattern, setPattern] = useState<Pattern>('Push');
  const [name, setName] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [activeSeed, setActiveSeed] = useState<Seed | null>(null);
  const [candidateIds, setCandidateIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  // When a user clicks Perfect on a card, we open this picker so they can
  // choose which name becomes the canonical (and which become aliases).
  const [pendingPerfect, setPendingPerfect] = useState<Exercise | null>(null);
  const [primaryChoice, setPrimaryChoice] = useState<'seed' | 'current' | 'custom'>('seed');
  const [customName, setCustomName] = useState('');

  // ─── Contributor name (localStorage) ─────────────────────────────
  useEffect(() => {
    const stored = window.localStorage.getItem(NAME_KEY);
    if (stored) setName(stored);
  }, []);

  // ─── MiniSearch index ────────────────────────────────────────────
  const aliasMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of aliases) {
      const list = m.get(a.exercise_id) ?? [];
      list.push(a.alias);
      m.set(a.exercise_id, list);
    }
    return m;
  }, [aliases]);

  const index = useMemo(() => {
    const ms = new MiniSearch<IndexDoc>({
      fields: ['name', 'aliases', 'muscles', 'equipment'],
      storeFields: ['id', 'name'],
      searchOptions: {
        boost: { name: 4, aliases: 3, muscles: 2, equipment: 1 },
        fuzzy: 0.2,
        prefix: true,
        // OR-combine across tokens. AND was too strict for catalog names
        // with extra words like "Barbell Bench Press - Medium Grip".
        // We re-sort hits so docs that contain all tokens still rank top.
      },
    });
    ms.addAll(
      exercises.map<IndexDoc>((e) => ({
        id: e.id,
        name: e.canonical_name + (e.original_name && e.original_name !== e.canonical_name ? ' ' + e.original_name : ''),
        aliases: (aliasMap.get(e.id) ?? []).join(' '),
        muscles: [...e.primary_muscles, ...e.secondary_muscles].join(' '),
        equipment: e.equipment ?? '',
      }))
    );
    return ms;
  }, [exercises, aliasMap]);

  // Mirror the mobile app's ranking exactly so what you see here matches
  // what the user sees in the picker. MiniSearch base score, plus:
  //   + popularity × 0.4   (the dominant signal for staple lifts)
  //   + 8 if approved
  //   − 60 if low-relevancy
  //   + 1000 for exact canonical match (always wins)
  //   + 50 if canonical starts with the query (prefix preference)
  // Then a substring fallback so obvious literal matches never disappear.
  const exerciseById = useMemo(
    () => new Map(exercises.map((e) => [e.id, e])),
    [exercises]
  );

  const searchCandidates = useCallback(
    (query: string, excludeIds: Set<string>): string[] => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const tokens = q.split(/\s+/).filter(Boolean);

      // Gather candidates with base scores from MiniSearch + literal fallback.
      const base = new Map<string, number>();
      for (const h of index.search(query)) {
        const id = h.id as string;
        if (excludeIds.has(id)) continue;
        base.set(id, h.score);
      }
      for (const e of exercises) {
        if (excludeIds.has(e.id) || base.has(e.id)) continue;
        const haystack = (e.canonical_name + ' ' + (e.original_name ?? '')).toLowerCase();
        if (tokens.every((t) => haystack.includes(t))) {
          base.set(e.id, 1); // small floor so it competes once boosted
        }
      }

      // Apply the mobile-app-style adjustments.
      const ranked: { id: string; score: number }[] = [];
      for (const [id, baseScore] of base) {
        const ex = exerciseById.get(id);
        if (!ex) continue;
        let s = baseScore;
        s += (ex.popularity ?? 0) * 0.4;
        if (ex.is_approved) s += 8;
        if (ex.is_low_relevancy) s -= 60;

        const name = ex.canonical_name.toLowerCase();
        if (name === q) s += 1000;
        else if (name.startsWith(q)) s += 50;

        ranked.push({ id, score: s });
      }
      ranked.sort((a, b) => b.score - a.score);
      return ranked.slice(0, 12).map((r) => r.id);
    },
    [exercises, exerciseById, index]
  );

  // ─── Derived per-pattern state ───────────────────────────────────
  const seedsForPattern = useMemo(() => {
    return seeds
      .filter((s) => s.pattern === pattern)
      .sort((a, b) => a.rank - b.rank);
  }, [seeds, pattern]);

  const matchesBySeed = useMemo(() => {
    const m = new Map<string, SeedMatch[]>();
    for (const sm of matches) {
      const list = m.get(sm.seed_id) ?? [];
      list.push(sm);
      m.set(sm.seed_id, list);
    }
    return m;
  }, [matches]);

  const candidates = useMemo(() => {
    if (!candidateIds) return null;
    return candidateIds
      .map((id) => exerciseById.get(id))
      .filter((e): e is Exercise => e != null);
  }, [candidateIds, exerciseById]);

  // ─── Actions ─────────────────────────────────────────────────────
  const saveName = () => {
    const v = nameDraft.trim();
    if (!v) return;
    window.localStorage.setItem(NAME_KEY, v);
    setName(v);
  };

  const findMatches = useCallback(async () => {
    const q = searchDraft.trim();
    if (!q || !name) return;
    setBusy(true);
    try {
      // Insert/find the seed first so we have an id to attach matches to.
      const existing = seedsForPattern.find((s) => s.name.toLowerCase() === q.toLowerCase());
      let seed = existing;
      if (!seed) {
        const nextRank = (seedsForPattern[seedsForPattern.length - 1]?.rank ?? 0) + 1;
        const { data, error } = await supabase
          .from('popularity_seeds')
          .insert({ pattern, name: q, rank: nextRank, contributor_name: name })
          .select()
          .single();
        if (error || !data) {
          alert('Could not save seed: ' + (error?.message ?? 'unknown'));
          return;
        }
        seed = data as Seed;
        setSeeds((prev) => [...prev, seed!]);
      }
      setActiveSeed(seed);
      const decided = new Set(matchesBySeed.get(seed.id)?.map((m) => m.exercise_id) ?? []);
      const ids = searchCandidates(q, decided);
      setCandidateIds(ids);
      setSearchDraft('');
    } finally {
      setBusy(false);
    }
  }, [searchDraft, name, pattern, seedsForPattern, supabase, index, matchesBySeed]);

  const decide = async (exercise: Exercise, quality: SeedMatch['match_quality']) => {
    if (!activeSeed || busy) return;
    // Perfect: open the naming picker rather than committing immediately.
    if (quality === 'perfect') {
      setPendingPerfect(exercise);
      // Default the primary to the user's typed seed text unless it's
      // already the canonical name.
      const seedIsAlready = exercise.canonical_name.toLowerCase() === activeSeed.name.toLowerCase();
      setPrimaryChoice(seedIsAlready ? 'current' : 'seed');
      setCustomName('');
      return;
    }
    setBusy(true);
    try {
      const seed = activeSeed;
      const popularityForSeed = popularityForRank(seed.rank);

      if (quality === 'similar') {
        // Add the seed name as an alias, half-popularity, approved.
        const halfPop = Math.round(popularityForSeed / 2);
        const newPopularity = Math.max(exercise.popularity ?? 0, halfPop);
        await supabase
          .from('curated_exercises')
          .update({
            is_approved: true,
            approved_at: new Date().toISOString(),
            popularity: newPopularity,
          })
          .eq('id', exercise.id);
        await supabase
          .from('exercise_aliases')
          .upsert(
            { exercise_id: exercise.id, alias: seed.name, contributor_name: name },
            { onConflict: 'exercise_id,alias' }
          );
        setAliases((prev) => [...prev, { exercise_id: exercise.id, alias: seed.name }]);
        setExercises((prev) =>
          prev.map((e) =>
            e.id === exercise.id ? { ...e, is_approved: true, popularity: newPopularity } : e
          )
        );
      }
      // 'irrelevant' just records the rejection; no exercise update.

      await supabase.from('seed_matches').upsert(
        {
          seed_id: seed.id,
          exercise_id: exercise.id,
          match_quality: quality,
          contributor_name: name,
        },
        { onConflict: 'seed_id,exercise_id' }
      );
      setMatches((prev) => [
        ...prev.filter((m) => !(m.seed_id === seed.id && m.exercise_id === exercise.id)),
        { seed_id: seed.id, exercise_id: exercise.id, match_quality: quality },
      ]);

      // Drop this candidate from the visible list.
      setCandidateIds((prev) => (prev ?? []).filter((id) => id !== exercise.id));
    } finally {
      setBusy(false);
    }
  };

  const cancelPerfect = () => {
    setPendingPerfect(null);
    setCustomName('');
  };

  const confirmPerfect = async () => {
    if (!activeSeed || !pendingPerfect || busy) return;
    const seed = activeSeed;
    const exercise = pendingPerfect;

    // Compute chosen primary + collected aliases.
    const seedName = seed.name;
    const currentName = exercise.canonical_name;
    const custom = customName.trim();

    let primary: string;
    if (primaryChoice === 'seed') primary = seedName;
    else if (primaryChoice === 'current') primary = currentName;
    else primary = custom;

    if (!primary.trim()) {
      alert('Pick or type a name to use as the primary.');
      return;
    }

    // Everything else (that isn't the chosen primary) becomes an alias.
    const aliasCandidates = [seedName, currentName, custom]
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => s.toLowerCase() !== primary.toLowerCase());
    const uniqueAliases = [...new Set(aliasCandidates.map((s) => s))];

    setBusy(true);
    try {
      const popularityForSeed = popularityForRank(seed.rank);
      const newPopularity = Math.max(exercise.popularity ?? 0, popularityForSeed);

      // Update the catalog row.
      await supabase
        .from('curated_exercises')
        .update({
          canonical_name: primary,
          is_approved: true,
          approved_at: new Date().toISOString(),
          popularity: newPopularity,
          rename_count: primary === currentName ? exercise.popularity ?? 0 : 1,
        })
        .eq('id', exercise.id);

      // Save aliases (upsert to dedupe).
      for (const alias of uniqueAliases) {
        await supabase
          .from('exercise_aliases')
          .upsert(
            { exercise_id: exercise.id, alias, contributor_name: name },
            { onConflict: 'exercise_id,alias' }
          );
      }

      // Local state updates.
      setExercises((prev) =>
        prev.map((e) =>
          e.id === exercise.id
            ? { ...e, canonical_name: primary, is_approved: true, popularity: newPopularity }
            : e
        )
      );
      setAliases((prev) => [
        ...prev,
        ...uniqueAliases.map((alias) => ({ exercise_id: exercise.id, alias })),
      ]);

      await supabase.from('seed_matches').upsert(
        {
          seed_id: seed.id,
          exercise_id: exercise.id,
          match_quality: 'perfect',
          contributor_name: name,
        },
        { onConflict: 'seed_id,exercise_id' }
      );
      setMatches((prev) => [
        ...prev.filter((m) => !(m.seed_id === seed.id && m.exercise_id === exercise.id)),
        { seed_id: seed.id, exercise_id: exercise.id, match_quality: 'perfect' },
      ]);

      setCandidateIds((prev) => (prev ?? []).filter((id) => id !== exercise.id));
    } finally {
      setBusy(false);
      setPendingPerfect(null);
      setCustomName('');
    }
  };

  const addAsNew = async () => {
    if (!activeSeed || busy) return;
    const seed = activeSeed;
    if (!window.confirm(`Add "${seed.name}" as a brand-new exercise under ${pattern}?`)) return;
    setBusy(true);
    try {
      const popularityForSeed = popularityForRank(seed.rank);
      const defaultMuscles = PATTERN_DEFAULT_MUSCLES[pattern as Pattern];
      const { data, error } = await supabase
        .from('curated_exercises')
        .insert({
          canonical_name: seed.name,
          primary_muscles: defaultMuscles,
          secondary_muscles: [],
          category: 'lift',
          is_approved: true,
          approved_at: new Date().toISOString(),
          popularity: popularityForSeed,
        })
        .select()
        .single();
      if (error || !data) {
        alert('Could not add: ' + (error?.message ?? 'unknown'));
        return;
      }
      const created = data as Exercise;
      setExercises((prev) => [...prev, created]);
      await supabase
        .from('seed_matches')
        .upsert(
          { seed_id: seed.id, exercise_id: created.id, match_quality: 'perfect', contributor_name: name },
          { onConflict: 'seed_id,exercise_id' }
        );
      setMatches((prev) => [
        ...prev,
        { seed_id: seed.id, exercise_id: created.id, match_quality: 'perfect' },
      ]);
      setCandidateIds(null);
      setActiveSeed(null);
    } finally {
      setBusy(false);
    }
  };

  const removeSeed = async (seed: Seed) => {
    if (!window.confirm(`Remove "${seed.name}" from ${pattern}? Existing matches are kept on the catalog rows but the seed disappears.`)) return;
    await supabase.from('popularity_seeds').delete().eq('id', seed.id);
    setSeeds((prev) => prev.filter((s) => s.id !== seed.id));
  };

  // ─── Name prompt (one time) ──────────────────────────────────────
  if (!name) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 space-y-6">
        <h2 className="text-2xl font-bold">What's your name?</h2>
        <p className="text-sm text-zinc-400">For the leaderboard. Stored on this device only.</p>
        <div className="flex gap-2">
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveName()}
            placeholder="e.g. Ryan"
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-zinc-100 focus:outline-none focus:border-lime-400/50"
          />
          <button
            onClick={saveName}
            disabled={!nameDraft.trim()}
            className="rounded-lg bg-lime-400 hover:bg-lime-300 text-zinc-950 font-semibold px-5 disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Seed popular exercises</h1>
        <p className="text-sm text-zinc-500">
          Pick a movement pattern. Type the exercises you'd consider most popular
          in order. For each one, the system suggests catalog matches — mark
          them <span className="text-lime-400">Perfect</span>,{' '}
          <span className="text-amber-400">Similar</span>, or{' '}
          <span className="text-red-400">Not relevant</span>. Your typing order
          becomes the popularity ranking inside that pattern.
        </p>
      </div>

      {/* Pattern tabs */}
      <div className="flex flex-wrap gap-2">
        {PATTERNS.map((p) => {
          const isActive = p === pattern;
          const count = seeds.filter((s) => s.pattern === p).length;
          return (
            <button
              key={p}
              onClick={() => {
                setPattern(p);
                setActiveSeed(null);
                setCandidateIds(null);
                setSearchDraft('');
              }}
              className={`rounded-full px-4 py-2 text-sm font-semibold border transition ${
                isActive
                  ? 'bg-lime-400 text-zinc-950 border-lime-400'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
              }`}
            >
              {p} <span className={`ml-1 text-xs ${isActive ? 'text-zinc-700' : 'text-zinc-500'}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Seeded list for this pattern */}
      <section className="space-y-2">
        <h2 className="text-xs uppercase tracking-[0.2em] text-lime-400 font-semibold">
          {pattern} — {seedsForPattern.length} seeded
        </h2>
        {seedsForPattern.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing yet. Add one below.</p>
        ) : (
          <div className="space-y-1">
            {seedsForPattern.map((seed) => {
              const seedMatches = matchesBySeed.get(seed.id) ?? [];
              const isActive = activeSeed?.id === seed.id;
              return (
                <div
                  key={seed.id}
                  className={`rounded-lg border ${isActive ? 'border-lime-400/40 bg-zinc-900/60' : 'border-zinc-900 hover:bg-zinc-900/40'} px-3 py-2`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500 font-mono w-6 text-right">{seed.rank}</span>
                    <span className="flex-1 text-sm font-semibold text-zinc-100">{seed.name}</span>
                    <span className="text-xs text-zinc-500">
                      pop {popularityForRank(seed.rank)}
                    </span>
                    <button
                      onClick={() => removeSeed(seed)}
                      className="text-xs text-zinc-600 hover:text-red-400 transition"
                    >
                      remove
                    </button>
                  </div>
                  {seedMatches.length > 0 && (
                    <ul className="mt-1 ml-9 space-y-0.5">
                      {seedMatches.map((sm) => {
                        const ex = exerciseById.get(sm.exercise_id);
                        if (!ex) return null;
                        const cls =
                          sm.match_quality === 'perfect'
                            ? 'text-lime-400'
                            : sm.match_quality === 'similar'
                            ? 'text-amber-400'
                            : 'text-zinc-600 line-through';
                        const glyph =
                          sm.match_quality === 'perfect' ? '★' : sm.match_quality === 'similar' ? '~' : '✗';
                        return (
                          <li key={sm.exercise_id} className={`text-xs ${cls}`}>
                            {glyph} {ex.canonical_name}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Add-next input */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-[0.2em] text-lime-400 font-semibold">
          Add next popular {pattern.toLowerCase()} exercise
        </h2>
        <div className="flex gap-2">
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && findMatches()}
            placeholder="e.g. Bench Press, OHP, Cable Fly…"
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-zinc-100 focus:outline-none focus:border-lime-400/50"
          />
          <button
            onClick={findMatches}
            disabled={!searchDraft.trim() || busy}
            className="rounded-lg bg-lime-400 hover:bg-lime-300 text-zinc-950 font-semibold px-5 disabled:opacity-40"
          >
            Find matches
          </button>
        </div>
      </section>

      {/* Perfect-match naming picker (modal) */}
      {pendingPerfect && activeSeed && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
          onClick={cancelPerfect}
        >
          <div
            className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-lime-400 font-semibold mb-1">
                Perfect match
              </p>
              <h3 className="text-lg font-bold text-zinc-100">
                Pick the primary name
              </h3>
              <p className="text-xs text-zinc-500 mt-1">
                The others become aliases so search still finds them.
              </p>
            </div>

            <div className="space-y-2">
              <label
                className={`flex items-start gap-3 cursor-pointer rounded-lg px-3 py-2 border ${
                  primaryChoice === 'seed' ? 'border-lime-400 bg-lime-400/5' : 'border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <input
                  type="radio"
                  name="primary"
                  checked={primaryChoice === 'seed'}
                  onChange={() => setPrimaryChoice('seed')}
                  className="mt-1 accent-lime-400"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-100 break-words">{activeSeed.name}</p>
                  <p className="text-xs text-zinc-500">what you just typed</p>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 cursor-pointer rounded-lg px-3 py-2 border ${
                  primaryChoice === 'current' ? 'border-lime-400 bg-lime-400/5' : 'border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <input
                  type="radio"
                  name="primary"
                  checked={primaryChoice === 'current'}
                  onChange={() => setPrimaryChoice('current')}
                  className="mt-1 accent-lime-400"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-100 break-words">{pendingPerfect.canonical_name}</p>
                  <p className="text-xs text-zinc-500">current canonical</p>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 cursor-pointer rounded-lg px-3 py-2 border ${
                  primaryChoice === 'custom' ? 'border-lime-400 bg-lime-400/5' : 'border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <input
                  type="radio"
                  name="primary"
                  checked={primaryChoice === 'custom'}
                  onChange={() => setPrimaryChoice('custom')}
                  className="mt-1 accent-lime-400"
                />
                <div className="flex-1 min-w-0">
                  <input
                    value={customName}
                    onChange={(e) => {
                      setCustomName(e.target.value);
                      if (e.target.value.trim()) setPrimaryChoice('custom');
                    }}
                    placeholder="Type a different name…"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:border-lime-400/50"
                  />
                  <p className="text-xs text-zinc-500 mt-0.5">something else entirely</p>
                </div>
              </label>
            </div>

            {/* Preview of what the aliases will be */}
            {(() => {
              const primary =
                primaryChoice === 'seed' ? activeSeed.name
                : primaryChoice === 'current' ? pendingPerfect.canonical_name
                : customName.trim();
              const aliasPreview = [activeSeed.name, pendingPerfect.canonical_name, customName.trim()]
                .filter(Boolean)
                .filter((s) => s.toLowerCase() !== primary.toLowerCase())
                .filter((s, i, arr) => arr.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i);
              if (aliasPreview.length === 0) return null;
              return (
                <div className="text-xs text-zinc-500 border-t border-zinc-800 pt-3">
                  Aliases will be:{' '}
                  {aliasPreview.map((a, i) => (
                    <span key={a}>
                      {i > 0 && ', '}
                      <span className="text-zinc-300">{a}</span>
                    </span>
                  ))}
                </div>
              );
            })()}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={cancelPerfect}
                className="rounded-lg border border-zinc-800 hover:border-zinc-700 px-4 py-2 text-sm text-zinc-300"
              >
                Cancel
              </button>
              <button
                onClick={confirmPerfect}
                disabled={busy || (primaryChoice === 'custom' && !customName.trim())}
                className="rounded-lg bg-lime-400 hover:bg-lime-300 text-zinc-950 px-4 py-2 text-sm font-semibold disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Candidate matches */}
      {activeSeed && candidates && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs uppercase tracking-[0.2em] text-lime-400 font-semibold">
              Matches for "{activeSeed.name}"
            </h2>
            <button
              onClick={() => { setActiveSeed(null); setCandidateIds(null); }}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              done
            </button>
          </div>
          {candidates.length === 0 ? (
            <div className="rounded-lg border border-zinc-900 p-6 text-center space-y-3">
              <p className="text-sm text-zinc-400">
                No catalog matches for "{activeSeed.name}".
              </p>
              <p className="text-xs text-zinc-600">
                Searched {exercises.length} catalog entries. If you expected a
                match, double-check the spelling or just add it as a new entry.
              </p>
              <button
                onClick={addAsNew}
                disabled={busy}
                className="rounded-full bg-lime-400 hover:bg-lime-300 text-zinc-950 font-semibold px-5 py-2 disabled:opacity-40"
              >
                Add "{activeSeed.name}" as a new exercise →
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {candidates.map((ex) => (
                  <div
                    key={ex.id}
                    className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col"
                  >
                    {ex.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ex.image_url} alt="" className="aspect-square object-cover bg-zinc-950" />
                    ) : (
                      <div className="aspect-square bg-zinc-950" />
                    )}
                    <div className="px-3 py-2 flex-1">
                      <p className="text-sm font-semibold text-zinc-100">{ex.canonical_name}</p>
                      <p className="text-xs text-zinc-500 mt-0.5 capitalize">
                        {ex.primary_muscles.join(', ') || '—'}
                      </p>
                      <p className="text-[10px] text-zinc-600 mt-1 tracking-wide uppercase">
                        {ex.is_approved && <span className="text-lime-400">approved</span>}
                        {ex.is_approved && ex.popularity > 0 && ' · '}
                        {ex.popularity > 0 && <span className="text-zinc-400">pop {ex.popularity}</span>}
                        {ex.is_low_relevancy && <span className="text-amber-400">low rel</span>}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 divide-x divide-zinc-800 border-t border-zinc-800">
                      <button
                        disabled={busy}
                        onClick={() => decide(ex, 'perfect')}
                        className="py-2 text-xs text-lime-400 hover:bg-lime-400/10 disabled:opacity-40"
                      >
                        ✓ Perfect
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => decide(ex, 'similar')}
                        className="py-2 text-xs text-amber-400 hover:bg-amber-400/10 disabled:opacity-40"
                      >
                        ~ Similar
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => decide(ex, 'irrelevant')}
                        className="py-2 text-xs text-zinc-500 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                      >
                        ✗ Not
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-3 text-center">
                <button
                  onClick={addAsNew}
                  disabled={busy}
                  className="text-xs text-zinc-500 hover:text-lime-400 underline"
                >
                  None of these — add "{activeSeed.name}" as a new exercise
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
