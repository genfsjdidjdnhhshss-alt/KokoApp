import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { LinearGradientFallback } from '@/components/ui/Atmosphere';
import { useAuth } from '@/context/AuthContext';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

export default function UploadScreen() {
  const { profile } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const onUpload = async () => {
    if (!title.trim() || !videoUrl.trim()) {
      Alert.alert('Faltan datos', 'Título y URL del video son requeridos.');
      return;
    }
    setLoading(true);
    if (!isSupabaseConfigured) {
      setLoading(false);
      Alert.alert(
        'Stub listo',
        'En modo demo el upload queda registrado localmente. Conecta Supabase Storage para producción.',
      );
      setTitle('');
      setDescription('');
      setVideoUrl('');
      return;
    }

    const { error } = await supabase.from('videos').insert({
      user_id: profile?.id ?? '',
      title: title.trim(),
      description: description.trim() || null,
      video_url: videoUrl.trim(),
    });
    setLoading(false);
    if (error) Alert.alert('Error', error.message);
    else {
      Alert.alert('Publicado', 'Tu video ya está en el feed.');
      setTitle('');
      setDescription('');
      setVideoUrl('');
    }
  };

  return (
    <Screen padded>
      <LinearGradientFallback />
      <View style={styles.wrap}>
        <Text style={styles.brand}>Subir a Koko</Text>
        <Text style={styles.sub}>
          Stub de publicación. Pega una URL vertical o integra el picker de cámara después.
        </Text>
        <TextInput
          placeholder="Título"
          placeholderTextColor={colors.textDim}
          value={title}
          onChangeText={setTitle}
          style={styles.input}
        />
        <TextInput
          placeholder="Descripción"
          placeholderTextColor={colors.textDim}
          value={description}
          onChangeText={setDescription}
          style={[styles.input, styles.area]}
          multiline
        />
        <TextInput
          autoCapitalize="none"
          placeholder="URL del video (mp4)"
          placeholderTextColor={colors.textDim}
          value={videoUrl}
          onChangeText={setVideoUrl}
          style={styles.input}
        />
        <Button label="Publicar" onPress={onUpload} loading={loading} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', gap: spacing.md },
  brand: { fontFamily: fonts.display, fontSize: 34, color: colors.text },
  sub: { fontFamily: fonts.body, color: colors.textMuted, marginBottom: spacing.md },
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
  area: { minHeight: 100, paddingTop: 14, textAlignVertical: 'top' },
});
