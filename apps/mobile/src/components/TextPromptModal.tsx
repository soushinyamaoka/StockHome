import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { TextField } from './TextField';
import { COLORS, FONTS, RADIUS, SPACING } from '../theme';

interface Props {
  visible: boolean;
  title: string;
  initialValue?: string;
  placeholder?: string;
  /** 空欄での決定を許す（メモを消す場合など） */
  allowEmpty?: boolean;
  submitLabel?: string;
  loading?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

// 1行の文字入力ダイアログ（Android には Alert.prompt が無いため自前で用意）
export const TextPromptModal: React.FC<Props> = ({
  visible,
  title,
  initialValue = '',
  placeholder,
  allowEmpty,
  submitLabel = '決定',
  loading,
  onSubmit,
  onCancel,
}) => {
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);
  const canSubmit = allowEmpty || value.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <TextField
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => canSubmit && onSubmit(value.trim())}
          />
          <View style={styles.buttons}>
            <View style={{ flex: 1 }}>
              <Button title="キャンセル" variant="outline" small onPress={onCancel} disabled={loading} />
            </View>
            <View style={{ width: SPACING.sm }} />
            <View style={{ flex: 1 }}>
              <Button
                title={submitLabel}
                small
                onPress={() => onSubmit(value.trim())}
                disabled={!canSubmit}
                loading={loading}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg },
  title: { fontFamily: FONTS.bold, fontSize: 15, color: COLORS.ink, marginBottom: SPACING.md },
  buttons: { flexDirection: 'row', marginTop: SPACING.sm },
});
