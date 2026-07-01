import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { changePassword } from '../../api/auth';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { Card } from '../../components/Card';
import { COLORS, FONTS, SPACING } from '../../theme';

export default function ChangePasswordScreen() {
  const navigation = useNavigation<any>();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!current || !next || !confirm) {
      Alert.alert('入力エラー', 'すべての欄を入力してください');
      return;
    }
    if (next.length < 8) {
      Alert.alert('入力エラー', '新しいパスワードは8文字以上で入力してください');
      return;
    }
    if (next !== confirm) {
      Alert.alert('入力エラー', '新しいパスワード（確認）が一致しません');
      return;
    }
    setLoading(true);
    try {
      await changePassword(current, next);
      Alert.alert('変更完了', 'パスワードを変更しました', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      Alert.alert('エラー', e?.response?.data?.message ?? '変更に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={{ padding: SPACING.lg }}>
        <Card>
          <Text style={styles.note}>
            あなたのアカウントのパスワードを変更します。家族それぞれのアカウントで個別に設定できます。
          </Text>
        </Card>
        <TextField
          label="現在のパスワード"
          value={current}
          onChangeText={setCurrent}
          secureTextEntry
        />
        <TextField
          label="新しいパスワード（8文字以上）"
          value={next}
          onChangeText={setNext}
          secureTextEntry
        />
        <TextField
          label="新しいパスワード（確認）"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
        />
        <Button title="パスワードを変更する" onPress={submit} loading={loading} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
  note: { fontFamily: FONTS.medium, fontSize: 13, color: COLORS.inkSub, lineHeight: 20 },
});
