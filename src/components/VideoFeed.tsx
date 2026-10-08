import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { ResizeMode, Video } from 'expo-av';
import { supabase } from '@/lib/supabase';
import type { Video as VideoRow } from '@/types/database';

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get('window');

type FeedItemProps = {
  item: VideoRow;
  isActive: boolean;
};

function FeedItem({ item, isActive }: FeedItemProps) {
  const ref = useRef<Video>(null);

  useEffect(() => {
    (async () => {
      if (!ref.current) return;
      if (isActive) {
        await ref.current.playAsync();
      } else {
        await ref.current.pauseAsync();
        await ref.current.setPositionAsync(0);
      }
    })();
  }, [isActive]);

  return (
    <View style={styles.page}>
      <Video
        ref={ref}
        style={StyleSheet.absoluteFill}
        source={{ uri: item.video_url }}
        resizeMode={ResizeMode.COVER}
        isLooping
        shouldPlay={isActive}
        useNativeControls={false}
      />
      <View style={styles.meta}>
        <Text style={styles.user}>@{item.profile?.username ?? 'koko'}</Text>
        {item.title ? <Text style={styles.title}>{item.title}</Text> : null}
        {item.description ? (
          <Text style={styles.desc} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function VideoFeed() {
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: queryError } = await supabase
      .from('videos')
      .select('id, user_id, title, description, video_url, created_at, profile:profiles(id, username, avatar_url)')
      .order('created_at', { ascending: false })
      .limit(30);

    if (queryError) {
      setError(queryError.message);
      setVideos([]);
      setActiveId(null);
    } else {
      const rows = (data ?? []) as unknown as VideoRow[];
      setVideos(rows);
      setActiveId(rows[0]?.id ?? null);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0]?.item as VideoRow | undefined;
      if (first?.id) setActiveId(first.id);
    },
  ).current;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <Text style={styles.hint}>
          Revisa EXPO_PUBLIC_SUPABASE_* y supabase/schema.sql
        </Text>
      </View>
    );
  }

  if (!videos.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>No hay videos en Supabase todavía.</Text>
      </View>
    );
  }

  return (
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
        <FeedItem item={item} isActive={item.id === activeId} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  page: {
    width: SCREEN_W,
    height: SCREEN_H,
    backgroundColor: '#000',
  },
  meta: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 48,
    gap: 4,
  },
  user: { color: '#fff', fontWeight: '700', fontSize: 14 },
  title: { color: '#fff', fontSize: 16, fontWeight: '600' },
  desc: { color: 'rgba(255,255,255,0.75)', fontSize: 14 },
  center: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  error: { color: '#ff6b6b', textAlign: 'center' },
  hint: { color: 'rgba(255,255,255,0.6)', textAlign: 'center' },
});
