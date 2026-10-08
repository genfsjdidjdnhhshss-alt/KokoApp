import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, spacing } from '@/theme/tokens';
import { Button } from '@/components/ui/Button';

type Props = {
  title: string;
  accent: string;
  score: number;
  running: boolean;
  gameOver: boolean;
  onRestart: () => void;
  hudExtra?: React.ReactNode;
  children: React.ReactNode;
};

export function GameShell({
  title,
  accent,
  score,
  running,
  gameOver,
  onRestart,
  hudExtra,
  children,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <View style={[styles.hud, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.hudCenter}>
          <Text style={[styles.title, { color: accent }]}>{title}</Text>
          <Text style={styles.score}>Score {score}</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>
      {hudExtra}
      <View style={styles.stage}>{children}</View>
      {gameOver && (
        <View style={styles.overlay}>
          <Text style={styles.overTitle}>Game Over</Text>
          <Text style={styles.overScore}>Puntaje: {score}</Text>
          <Button label="Otra ronda" onPress={onRestart} variant="kozmo" />
          <Button label="Volver al hub" onPress={() => router.back()} variant="ghost" />
        </View>
      )}
      {!running && !gameOver && (
        <View style={styles.overlay}>
          <Text style={styles.overTitle}>Listo</Text>
          <Button label="Jugar" onPress={onRestart} variant="kozmo" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  hud: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    zIndex: 2,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  hudCenter: { flex: 1, alignItems: 'center' },
  title: { fontFamily: fonts.displaySemi, fontSize: 16 },
  score: { fontFamily: fonts.bodyMedium, color: colors.textMuted, fontSize: 13 },
  stage: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
    zIndex: 5,
  },
  overTitle: {
    fontFamily: fonts.display,
    color: colors.text,
    fontSize: 32,
  },
  overScore: {
    fontFamily: fonts.body,
    color: colors.textMuted,
    fontSize: 16,
    marginBottom: 8,
  },
});
