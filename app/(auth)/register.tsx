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

export default function RegisterScreen() {
  const { signUpWithEmail } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onRegister = async () => {
    setLoading(true);
    setMessage(null);
    const { error } = await signUpWithEmail(email.trim(), password, username.trim());
    setLoading(false);
    if (error) setMessage(error);
    else router.replace('/(tabs)');
  };

  return (
    <Screen>
      <LinearGradientFallback />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.wrap}
      >
        <Text style={styles.brand}>Únete a Koko</Text>
        <Text style={styles.sub}>Crea tu perfil y entra al feed.</Text>
        <View style={styles.form}>
          <TextInput
            autoCapitalize="none"
            placeholder="Usuario"
            placeholderTextColor={colors.textDim}
            value={username}
            onChangeText={setUsername}
            style={styles.input}
          />
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
          <Button label="Crear cuenta" onPress={onRegister} loading={loading} />
        </View>
        <Link href="/(auth)/login" style={styles.link}>
          Ya tengo cuenta
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
    fontSize: 36,
    color: colors.text,
  },
  sub: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 15 },
  form: { gap: spacing.md, marginTop: spacing.md },
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
  },
});
