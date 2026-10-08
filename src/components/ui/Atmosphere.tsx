import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/theme/tokens';

/** Soft atmospheric layers without relying on expo-linear-gradient. */
export function LinearGradientFallback() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.base} />
      <View style={styles.blobA} />
      <View style={styles.blobB} />
      <View style={styles.noise} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
  },
  blobA: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    top: -60,
    right: -40,
    backgroundColor: 'rgba(46, 230, 166, 0.12)',
  },
  blobB: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    bottom: 80,
    left: -50,
    backgroundColor: 'rgba(255, 138, 61, 0.10)',
  },
  noise: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    borderWidth: 0,
    opacity: 0.4,
  },
});
