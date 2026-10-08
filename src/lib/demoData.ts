import type { Comment, Profile, Video } from '@/types/database';

/** Local demo content when Supabase is not configured. */

export const DEMO_PROFILE: Profile = {
  id: 'demo-user-1',
  username: 'paulrojas',
  display_name: 'Paul Rojas Ugarte',
  avatar_url: null,
  bio: 'Creador de Koko · KOZMO forever',
  follower_count: 1280,
  following_count: 214,
  created_at: new Date().toISOString(),
};

export const DEMO_CREATORS: Profile[] = [
  DEMO_PROFILE,
  {
    id: 'demo-user-2',
    username: 'luna_beats',
    display_name: 'Luna Beats',
    avatar_url: null,
    bio: 'Música y vibes nocturnas',
    follower_count: 8420,
    following_count: 190,
    created_at: new Date().toISOString(),
  },
  {
    id: 'demo-user-3',
    username: 'kozmo_pilot',
    display_name: 'KOZMO Pilot',
    avatar_url: null,
    bio: 'High scores only',
    follower_count: 3200,
    following_count: 88,
    created_at: new Date().toISOString(),
  },
];

/** Sample vertical clips — public domain / commons-style demo URLs. */
export const DEMO_VIDEOS: Video[] = [
  {
    id: 'v1',
    user_id: 'demo-user-2',
    title: 'Noche en la ciudad',
    description: 'Luces, ritmo y cero filtros #koko',
    video_url:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    thumbnail_url: null,
    duration_ms: 15000,
    like_count: 1240,
    comment_count: 48,
    view_count: 18200,
    created_at: new Date().toISOString(),
    profile: DEMO_CREATORS[1],
    liked_by_me: false,
  },
  {
    id: 'v2',
    user_id: 'demo-user-3',
    title: 'Warm-up KOZMO Rush',
    description: 'Antes de romper el leaderboard 🔥',
    video_url:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    thumbnail_url: null,
    duration_ms: 15000,
    like_count: 890,
    comment_count: 22,
    view_count: 9400,
    created_at: new Date().toISOString(),
    profile: DEMO_CREATORS[2],
    liked_by_me: true,
  },
  {
    id: 'v3',
    user_id: 'demo-user-1',
    title: 'Bienvenido a Koko',
    description: 'Vertical, social, y con juegos adentro.',
    video_url:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    thumbnail_url: null,
    duration_ms: 60000,
    like_count: 320,
    comment_count: 12,
    view_count: 4100,
    created_at: new Date().toISOString(),
    profile: DEMO_CREATORS[0],
    liked_by_me: false,
  },
];

export const DEMO_COMMENTS: Comment[] = [
  {
    id: 'c1',
    user_id: 'demo-user-3',
    video_id: 'v1',
    body: 'Esta vibra es pura Koko ✨',
    created_at: new Date().toISOString(),
    profile: DEMO_CREATORS[2],
  },
  {
    id: 'c2',
    user_id: 'demo-user-1',
    video_id: 'v1',
    body: '¿Alguien más va a KOZMO después?',
    created_at: new Date().toISOString(),
    profile: DEMO_CREATORS[0],
  },
];
