import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme/tokens';

type Props = ViewProps & {
  edges?: ('top' | 'right' | 'bottom' | 'left')[];
  padded?: boolean;
};

export function Screen({ children, style, edges = ['top'], padded, ...rest }: Props) {
  return (
    <SafeAreaView edges={edges} style={styles.safe}>
      <View style={[styles.inner, padded && styles.padded, style]} {...rest}>
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, backgroundColor: colors.bg },
  padded: { paddingHorizontal: 20 },
});
