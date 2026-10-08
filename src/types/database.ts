/** Filas mínimas usadas por el feed. Espejo de supabase/schema.sql */

export type Profile = {
  id: string;
  username: string;
  avatar_url: string | null;
};

export type Video = {
  id: string;
  user_id: string;
  title: string | null;
  description: string | null;
  video_url: string;
  created_at: string;
  profile?: Profile | null;
};
