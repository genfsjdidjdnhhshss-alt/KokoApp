import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Screen } from '@/components/ui/Screen';
import { LinearGradientFallback } from '@/components/ui/Atmosphere';
import { KOZMO_GAMES } from '@/constants/kozmo';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

export default function KozmoHubScreen() {
  const router = useRouter();

  return (
    <Screen>
      <LinearGradientFallback />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>KOZMO</Text>
        <Text style={styles.sub}>
          Hub de minijuegos dentro de Koko. Elige una arena y sube tu score.
        </Text>
        <View style={styles.list}>
          {KOZMO_GAMES.map((game, index) => (
            <Animated.View
              key={game.id}
              entering={FadeInDown.delay(index * 80).springify()}
            >
              <Pressable
                onPress={() => router.push(game.route)}
                style={({ pressed }) => [
                  styles.row,
                  { borderColor: game.accent, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <View style={[styles.dot, { backgroundColor: game.accent }]} />
                <View style={styles.meta}>
                  <Text style={styles.title}>{game.title}</Text>
                  <Text style={styles.tag}>{game.tagline}</Text>
                  <Text style={styles.mech}>{game.mechanic}</Text>
                </View>
                <Text style={[styles.play, { color: game.accent }]}>PLAY</Text>
              </Pressable>
            </Animated.View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  brand: {
    fontFamily: fonts.display,
    fontSize: 48,
    color: colors.kozmo,
    letterSpacing: 3,
  },
  sub: {
    fontFamily: fonts.body,
    color: colors.textMuted,
    fontSize: 15,
    marginBottom: spacing.xl,
    maxWidth: 320,
  },
  list: { gap: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  meta: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.displaySemi, color: colors.text, fontSize: 18 },
  tag: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 13 },
  mech: { fontFamily: fonts.bodyMedium, color: colors.textDim, fontSize: 11 },
  play: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1 },
});
