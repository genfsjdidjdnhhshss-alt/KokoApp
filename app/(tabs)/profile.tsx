import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { LinearGradientFallback } from '@/components/ui/Atmosphere';
import { useAuth } from '@/context/AuthContext';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

export default function ProfileScreen() {
  const { profile, demoMode, signOut } = useAuth();
  const router = useRouter();

  return (
    <Screen padded>
      <LinearGradientFallback />
      <View style={styles.wrap}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(profile?.display_name ?? profile?.username ?? 'K')
              .slice(0, 1)
              .toUpperCase()}
          </Text>
        </View>
        <Text style={styles.name}>{profile?.display_name ?? 'Invitado'}</Text>
        <Text style={styles.handle}>@{profile?.username ?? 'koko'}</Text>
        {demoMode ? <Text style={styles.badge}>Modo demo</Text> : null}
        <Text style={styles.bio}>{profile?.bio ?? 'Sin bio todavía.'}</Text>

        <View style={styles.stats}>
          <Stat label="Seguidores" value={profile?.follower_count ?? 0} />
          <Stat label="Siguiendo" value={profile?.following_count ?? 0} />
        </View>

        <Button
          label="Cerrar sesión"
          variant="secondary"
          onPress={async () => {
            await signOut();
            router.replace('/(auth)/login');
          }}
        />
      </View>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.accentSoft,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarText: {
    fontFamily: fonts.display,
    fontSize: 40,
    color: colors.accent,
  },
  name: { fontFamily: fonts.display, fontSize: 28, color: colors.text },
  handle: { fontFamily: fonts.bodyMedium, color: colors.accent, fontSize: 15 },
  badge: {
    marginTop: 4,
    fontFamily: fonts.bodyMedium,
    color: colors.kozmo,
    backgroundColor: colors.kozmoSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.sm,
    overflow: 'hidden',
    fontSize: 12,
  },
  bio: {
    fontFamily: fonts.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginVertical: spacing.md,
    maxWidth: 280,
  },
  stats: { flexDirection: 'row', gap: spacing.xl, marginBottom: spacing.xl },
  stat: { alignItems: 'center' },
  statValue: { fontFamily: fonts.displaySemi, color: colors.text, fontSize: 22 },
  statLabel: { fontFamily: fonts.body, color: colors.textDim, fontSize: 12 },
});
