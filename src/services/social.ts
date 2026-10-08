import { DEMO_COMMENTS, DEMO_VIDEOS } from '@/lib/demoData';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { Comment, Video } from '@/types/database';

export async function fetchFeed(limit = 20): Promise<Video[]> {
  if (!isSupabaseConfigured) {
    return DEMO_VIDEOS;
  }

  const { data, error } = await supabase
    .from('videos')
    .select('*, profile:profiles(*)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data?.length) {
    return DEMO_VIDEOS;
  }
  return data as unknown as Video[];
}

export async function toggleLike(
  videoId: string,
  userId: string,
  currentlyLiked: boolean,
): Promise<{ liked: boolean; delta: number }> {
  if (!isSupabaseConfigured) {
    return { liked: !currentlyLiked, delta: currentlyLiked ? -1 : 1 };
  }

  if (currentlyLiked) {
    await supabase.from('likes').delete().eq('video_id', videoId).eq('user_id', userId);
    return { liked: false, delta: -1 };
  }

  await supabase.from('likes').insert({ video_id: videoId, user_id: userId });
  return { liked: true, delta: 1 };
}

export async function fetchComments(videoId: string): Promise<Comment[]> {
  if (!isSupabaseConfigured) {
    return DEMO_COMMENTS.filter((c) => c.video_id === videoId);
  }

  const { data, error } = await supabase
    .from('comments')
    .select('*, profile:profiles(*)')
    .eq('video_id', videoId)
    .order('created_at', { ascending: true });

  if (error || !data) {
    return DEMO_COMMENTS.filter((c) => c.video_id === videoId);
  }
  return data as unknown as Comment[];
}

export async function postComment(
  videoId: string,
  userId: string,
  body: string,
): Promise<Comment | null> {
  const trimmed = body.trim();
  if (!trimmed) return null;

  if (!isSupabaseConfigured) {
    return {
      id: `local-${Date.now()}`,
      user_id: userId,
      video_id: videoId,
      body: trimmed,
      created_at: new Date().toISOString(),
    };
  }

  const { data, error } = await supabase
    .from('comments')
    .insert({ video_id: videoId, user_id: userId, body: trimmed })
    .select('*, profile:profiles(*)')
    .single();

  if (error || !data) return null;
  return data as unknown as Comment;
}

export async function toggleFollow(
  followerId: string,
  followingId: string,
  currentlyFollowing: boolean,
): Promise<boolean> {
  if (!isSupabaseConfigured) {
    return !currentlyFollowing;
  }

  if (currentlyFollowing) {
    await supabase
      .from('follows')
      .delete()
      .eq('follower_id', followerId)
      .eq('following_id', followingId);
    return false;
  }

  await supabase.from('follows').insert({
    follower_id: followerId,
    following_id: followingId,
  });
  return true;
}

export async function submitKozmoScore(
  userId: string,
  gameId: string,
  score: number,
  meta?: Record<string, unknown>,
) {
  if (!isSupabaseConfigured) return { ok: true, local: true };
  const { error } = await supabase.from('kozmo_scores').insert({
    user_id: userId,
    game_id: gameId as 'rush' | 'colosseum' | 'magnet' | 'tower' | 'bomba',
    score,
    meta: meta ?? null,
  });
  return { ok: !error, local: false, error: error?.message };
}
