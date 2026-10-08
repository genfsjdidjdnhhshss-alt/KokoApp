import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Video as VideoRow } from '@/types/database';
import { colors, fonts, spacing } from '@/theme/tokens';

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get('window');

type Props = {
  item: VideoRow;
  isActive: boolean;
  onLike: () => void;
  onComment: () => void;
  onFollow: () => void;
  following?: boolean;
};

export function VideoCard({
  item,
  isActive,
  onLike,
  onComment,
  onFollow,
  following,
}: Props) {
  const videoRef = useRef<Video>(null);
  const insets = useSafeAreaInsets();
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    (async () => {
      if (!videoRef.current) return;
      if (isActive) {
        await videoRef.current.playAsync();
      } else {
        await videoRef.current.pauseAsync();
        await videoRef.current.setPositionAsync(0);
      }
    })();
  }, [isActive]);

  const onStatus = (_status: AVPlaybackStatus) => {
    // loop handled via isLooping
  };

  return (
    <View style={[styles.page, { height: SCREEN_H }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setMuted((m) => !m)}>
        <Video
          ref={videoRef}
          style={StyleSheet.absoluteFill}
          source={{ uri: item.video_url }}
          resizeMode={ResizeMode.COVER}
          isLooping
          shouldPlay={isActive}
          isMuted={muted}
          onPlaybackStatusUpdate={onStatus}
        />
        <View style={styles.scrim} />
      </Pressable>

      <View style={[styles.meta, { bottom: insets.bottom + 88 }]}>
        <Text style={styles.user}>@{item.profile?.username ?? 'koko'}</Text>
        <Text style={styles.title} numberOfLines={2}>
          {item.title ?? item.description ?? 'Sin título'}
        </Text>
        <Text style={styles.desc} numberOfLines={2}>
          {item.description}
        </Text>
      </View>

      <View style={[styles.rail, { bottom: insets.bottom + 100 }]}>
        <Action
          icon={item.liked_by_me ? 'heart' : 'heart-outline'}
          color={item.liked_by_me ? colors.danger : colors.white}
          label={String(item.like_count)}
          onPress={onLike}
        />
        <Action icon="chatbubble-ellipses-outline" label={String(item.comment_count)} onPress={onComment} />
        <Action
          icon={following ? 'person-remove-outline' : 'person-add-outline'}
          label={following ? 'Siguiendo' : 'Seguir'}
          onPress={onFollow}
        />
        <Action
          icon={muted ? 'volume-mute' : 'volume-high'}
          label={muted ? 'Mute' : 'Audio'}
          onPress={() => setMuted((m) => !m)}
        />
      </View>
    </View>
  );
}

function Action({
  icon,
  label,
  onPress,
  color = colors.white,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  color?: string;
}) {
  return (
    <Pressable onPress={onPress} style={styles.action}>
      <Ionicons name={icon} size={28} color={color} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    width: SCREEN_W,
    backgroundColor: colors.black,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  meta: {
    position: 'absolute',
    left: spacing.lg,
    right: 84,
  },
  user: {
    fontFamily: fonts.bodyBold,
    color: colors.accent,
    fontSize: 14,
    marginBottom: 6,
  },
  title: {
    fontFamily: fonts.displaySemi,
    color: colors.text,
    fontSize: 18,
    marginBottom: 4,
  },
  desc: {
    fontFamily: fonts.body,
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  rail: {
    position: 'absolute',
    right: spacing.md,
    alignItems: 'center',
    gap: 18,
  },
  action: {
    alignItems: 'center',
    gap: 4,
  },
  actionLabel: {
    fontFamily: fonts.bodyMedium,
    color: colors.white,
    fontSize: 11,
  },
});
