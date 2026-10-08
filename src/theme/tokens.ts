/**
 * Koko design tokens — charcoal/ink base with electric mint accent.
 * Intentionally avoids purple-gradient / cream-serif AI defaults.
 */
export const colors = {
  bg: '#0A0C10',
  bgElevated: '#12151C',
  bgSoft: '#1A1F2A',
  surface: '#1E2430',
  border: '#2A3140',
  borderSoft: '#232836',
  text: '#F2F4F7',
  textMuted: '#8B93A7',
  textDim: '#5C6578',
  accent: '#2EE6A6',
  accentDim: '#1A9E70',
  accentSoft: 'rgba(46, 230, 166, 0.14)',
  danger: '#FF5C6A',
  dangerSoft: 'rgba(255, 92, 106, 0.16)',
  warn: '#FFB020',
  info: '#4DB7FF',
  kozmo: '#FF8A3D',
  kozmoSoft: 'rgba(255, 138, 61, 0.16)',
  overlay: 'rgba(6, 8, 12, 0.72)',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

export const fonts = {
  display: 'Syne_700Bold',
  displaySemi: 'Syne_600SemiBold',
  body: 'DMSans_400Regular',
  bodyMedium: 'DMSans_500Medium',
  bodyBold: 'DMSans_700Bold',
} as const;

export const theme = { colors, spacing, radii, fonts } as const;
export type Theme = typeof theme;
