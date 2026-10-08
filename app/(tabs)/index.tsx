import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  StyleSheet,
  View,
  type ViewToken,
} from 'react-native';
import { VideoCard } from '@/components/feed/VideoCard';
import { CommentSheet } from '@/components/feed/CommentSheet';
import { useAuth } from '@/context/AuthContext';
import { fetchFeed, toggleFollow, toggleLike } from '@/services/social';
import type { Video } from '@/types/database';
import { colors } from '@/theme/tokens';

const { height: SCREEN_H } = Dimensions.get('window');

export default function FeedScreen() {
  const { profile } = useAuth();
  const [videos, setVideos] = useState<Video[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [commentVideoId, setCommentVideoId] = useState<string | null>(null);
  const [following, setFollowing] = useState<Record<string, boolean>>({});
  const userId = profile?.id ?? 'demo-user-1';

  useEffect(() => {
    fetchFeed().then((rows) => {
      setVideos(rows);
      setActiveId(rows[0]?.id ?? null);
    });
  }, []);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0]?.item as Video | undefined;
      if (first?.id) setActiveId(first.id);
    },
  ).current;

  const onLike = useCallback(
    async (video: Video) => {
      const res = await toggleLike(video.id, userId, !!video.liked_by_me);
      setVideos((prev) =>
        prev.map((v) =>
          v.id === video.id
            ? {
                ...v,
                liked_by_me: res.liked,
                like_count: Math.max(0, v.like_count + res.delta),
              }
            : v,
        ),
      );
    },
    [userId],
  );

  const onFollow = useCallback(
    async (video: Video) => {
      const key = video.user_id;
      const current = !!following[key];
      const next = await toggleFollow(userId, key, current);
      setFollowing((prev) => ({ ...prev, [key]: next }));
    },
    [following, userId],
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={videos}
        keyExtractor={(item) => item.id}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={SCREEN_H}
        decelerationRate="fast"
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
        getItemLayout={(_, index) => ({
          length: SCREEN_H,
          offset: SCREEN_H * index,
          index,
        })}
        renderItem={({ item }) => (
          <VideoCard
            item={item}
            isActive={item.id === activeId}
            following={!!following[item.user_id]}
            onLike={() => onLike(item)}
            onComment={() => setCommentVideoId(item.id)}
            onFollow={() => onFollow(item)}
          />
        )}
      />
      <CommentSheet
        visible={!!commentVideoId}
        videoId={commentVideoId}
        userId={userId}
        onClose={() => setCommentVideoId(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
});
