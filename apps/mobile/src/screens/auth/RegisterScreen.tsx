import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { COLORS, SPACING } from '../../theme';

const RegisterScreen: React.FC = () => {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!email || !password || !name) {
      Alert.alert('入力エラー', '必須項目を入力してください');
      return;
    }
    if (password.length < 8) {
      Alert.alert('パスワードエラー', 'パスワードは8文字以上で入力してください');
      return;
    }
    setLoading(true);
    try {
      await register({
        email: email.trim(),
        password,
        name: name.trim(),
        householdName: householdName.trim() || undefined,
      });
    } catch (e: any) {
      Alert.alert('登録失敗', e?.response?.data?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View>
          <TextField label="お名前 *" value={name} onChangeText={setName} />
          <TextField
            label="メールアドレス *"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextField
            label="パスワード（8文字以上） *"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <TextField
            label="家庭名（任意。空欄なら自動命名）"
            value={householdName}
            onChangeText={setHouseholdName}
          />
          <Button title="登録してログイン" onPress={onSubmit} loading={loading} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { padding: SPACING.xl, backgroundColor: COLORS.paper, flexGrow: 1 },
});

export default RegisterScreen;
