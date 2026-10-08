import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { LinearGradientFallback } from '@/components/ui/Atmosphere';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/context/AuthContext';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

export default function LoginScreen() {
  const { signInWithEmail, signInWithMagicLink, continueAsDemo } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onLogin = async () => {
    setLoading(true);
    setMessage(null);
    const { error } = await signInWithEmail(email.trim(), password);
    setLoading(false);
    if (error) setMessage(error);
    else router.replace('/(tabs)');
  };

  const onMagic = async () => {
    setLoading(true);
    setMessage(null);
    const { error } = await signInWithMagicLink(email.trim());
    setLoading(false);
    setMessage(error ?? 'Revisa tu correo para el magic link.');
  };

  return (
    <Screen>
      <LinearGradientFallback />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.wrap}
      >
        <Text style={styles.brand}>KOKO</Text>
        <Text style={styles.sub}>Video vertical · social · KOZMO</Text>

        <View style={styles.form}>
          <TextInput
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor={colors.textDim}
            value={email}
            onChangeText={setEmail}
            style={styles.input}
          />
          <TextInput
            secureTextEntry
            placeholder="Contraseña"
            placeholderTextColor={colors.textDim}
            value={password}
            onChangeText={setPassword}
            style={styles.input}
          />
          {message ? <Text style={styles.msg}>{message}</Text> : null}
          <Button label="Entrar" onPress={onLogin} loading={loading} />
          <Button label="Magic link" onPress={onMagic} variant="secondary" />
          <Button
            label="Continuar en modo demo"
            onPress={() => {
              continueAsDemo();
              router.replace('/(tabs)');
            }}
            variant="ghost"
          />
        </View>

        <Link href="/(auth)/register" style={styles.link}>
          Crear cuenta
        </Link>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    gap: spacing.lg,
  },
  brand: {
    fontFamily: fonts.display,
    fontSize: 56,
    color: colors.accent,
    letterSpacing: 4,
  },
  sub: {
    fontFamily: fonts.body,
    color: colors.textMuted,
    fontSize: 15,
    marginTop: -8,
  },
  form: { gap: spacing.md, marginTop: spacing.xl },
  input: {
    minHeight: 50,
    borderRadius: radii.md,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.body,
  },
  msg: { fontFamily: fonts.body, color: colors.warn, fontSize: 13 },
  link: {
    fontFamily: fonts.bodyMedium,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
