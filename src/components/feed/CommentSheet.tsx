import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { fetchComments, postComment } from '@/services/social';
import type { Comment } from '@/types/database';
import { Button } from '@/components/ui/Button';

type Props = {
  visible: boolean;
  videoId: string | null;
  userId: string;
  onClose: () => void;
};

export function CommentSheet({ visible, videoId, userId, onClose }: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible || !videoId) return;
    fetchComments(videoId).then(setComments);
  }, [visible, videoId]);

  const send = async () => {
    if (!videoId) return;
    setSending(true);
    const created = await postComment(videoId, userId, body);
    if (created) {
      setComments((prev) => [...prev, created]);
      setBody('');
    }
    setSending(false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.title}>Comentarios</Text>
        <FlatList
          data={comments}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingBottom: 12, gap: 12 }}
          ListEmptyComponent={
            <Text style={styles.empty}>Sé el primero en comentar.</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.user}>@{item.profile?.username ?? 'usuario'}</Text>
              <Text style={styles.body}>{item.body}</Text>
            </View>
          )}
        />
        <View style={styles.composer}>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Escribe un comentario…"
            placeholderTextColor={colors.textDim}
            style={styles.input}
          />
          <Button label="Enviar" onPress={send} loading={sending} style={{ minWidth: 96 }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    maxHeight: '55%',
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  title: {
    fontFamily: fonts.displaySemi,
    color: colors.text,
    fontSize: 18,
    marginBottom: spacing.md,
  },
  empty: { fontFamily: fonts.body, color: colors.textDim },
  row: { gap: 2 },
  user: { fontFamily: fonts.bodyBold, color: colors.accent, fontSize: 12 },
  body: { fontFamily: fonts.body, color: colors.text, fontSize: 14 },
  composer: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 },
  input: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 12,
    fontFamily: fonts.body,
  },
});
