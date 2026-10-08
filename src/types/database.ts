/** Supabase schema types — mirrors supabase/schema.sql */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  follower_count: number;
  following_count: number;
  created_at: string;
}

export interface Video {
  id: string;
  user_id: string;
  title: string | null;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  duration_ms: number | null;
  like_count: number;
  comment_count: number;
  view_count: number;
  created_at: string;
  profile?: Profile | null;
  liked_by_me?: boolean;
}

export interface Like {
  id: string;
  user_id: string;
  video_id: string;
  created_at: string;
}

export interface Comment {
  id: string;
  user_id: string;
  video_id: string;
  body: string;
  created_at: string;
  profile?: Profile | null;
}

export interface Follow {
  id: string;
  follower_id: string;
  following_id: string;
  created_at: string;
}

export interface KozmoScore {
  id: string;
  user_id: string;
  game_id: KozmoGameId;
  score: number;
  meta: Json | null;
  created_at: string;
}

export type KozmoGameId =
  | 'rush'
  | 'colosseum'
  | 'magnet'
  | 'tower'
  | 'bomba';

type Tables = {
  profiles: {
    Row: Profile;
    Insert: {
      id: string;
      username: string;
      display_name?: string | null;
      avatar_url?: string | null;
      bio?: string | null;
      follower_count?: number;
      following_count?: number;
      created_at?: string;
    };
    Update: Partial<Profile>;
    Relationships: [];
  };
  videos: {
    Row: Video;
    Insert: {
      id?: string;
      user_id: string;
      title?: string | null;
      description?: string | null;
      video_url: string;
      thumbnail_url?: string | null;
      duration_ms?: number | null;
      like_count?: number;
      comment_count?: number;
      view_count?: number;
      created_at?: string;
    };
    Update: Partial<Omit<Video, 'profile' | 'liked_by_me'>>;
    Relationships: [];
  };
  likes: {
    Row: Like;
    Insert: {
      id?: string;
      user_id: string;
      video_id: string;
      created_at?: string;
    };
    Update: Partial<Like>;
    Relationships: [];
  };
  comments: {
    Row: Comment;
    Insert: {
      id?: string;
      user_id: string;
      video_id: string;
      body: string;
      created_at?: string;
    };
    Update: Partial<Omit<Comment, 'profile'>>;
    Relationships: [];
  };
  follows: {
    Row: Follow;
    Insert: {
      id?: string;
      follower_id: string;
      following_id: string;
      created_at?: string;
    };
    Update: Partial<Follow>;
    Relationships: [];
  };
  kozmo_scores: {
    Row: KozmoScore;
    Insert: {
      id?: string;
      user_id: string;
      game_id: KozmoGameId;
      score: number;
      meta?: Json | null;
      created_at?: string;
    };
    Update: Partial<KozmoScore>;
    Relationships: [];
  };
};

export type Database = {
  public: {
    Tables: Tables;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      kozmo_game_id: KozmoGameId;
    };
    CompositeTypes: Record<string, never>;
  };
};
