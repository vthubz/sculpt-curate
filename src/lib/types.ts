export interface CuratedExercise {
  id: string;
  source_id: string | null;
  canonical_name: string;
  original_name: string | null;
  primary_muscles: string[];
  secondary_muscles: string[];
  equipment: string | null;
  category: string | null;
  movement_pattern: string | null;
  image_url: string | null;
  is_approved: boolean;
  is_hidden: boolean;
  is_low_relevancy: boolean;
  approved_at: string | null;
  approved_by: string | null;
  rename_count: number;
  created_at: string;
  updated_at: string;
}

export interface ExerciseAlias {
  id: string;
  exercise_id: string;
  alias: string;
  contributor_id: string | null;
  vote_score: number;
  is_removed: boolean;
  created_at: string;
}
