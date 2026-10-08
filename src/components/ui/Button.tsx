import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type ViewStyle,
} from 'react-native';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'kozmo';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
};

const bg: Record<Variant, string> = {
  primary: colors.accent,
  secondary: colors.surface,
  ghost: 'transparent',
  danger: colors.danger,
  kozmo: colors.kozmo,
};

const fg: Record<Variant, string> = {
  primary: colors.bg,
  secondary: colors.text,
  ghost: colors.accent,
  danger: colors.white,
  kozmo: colors.bg,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: bg[variant], opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        variant === 'ghost' && styles.ghost,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg[variant]} />
      ) : (
        <Text style={[styles.label, { color: fg[variant] }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  ghost: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    letterSpacing: 0.2,
  },
});
