import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { COLORS, FONTS, RADIUS, SHADOW, SPACING } from '../../theme';
import type { AuthStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Login'>;

// 表紙: 生成りの紙にロゴと朱印。家庭の手帳をひらく入り口
const LoginScreen: React.FC = () => {
  const { login } = useAuth();
  const navigation = useNavigation<Nav>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!email || !password) {
      Alert.alert('入力エラー', 'メールアドレスとパスワードを入力してください');
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (e: any) {
      Alert.alert('ログイン失敗', e?.response?.data?.message ?? String(e));
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
        {/* ロゴ: Fraunces の表札 ＋ 朱印 */}
        <View style={styles.logoArea}>
          <View style={styles.hanko}>
            <Text style={styles.hankoText}>在{'\n'}庫</Text>
          </View>
          <Text style={styles.title}>StockHome</Text>
          <Text style={styles.subtitle}>わが家の消耗品ノート</Text>
          <View style={styles.rule} />
        </View>

        <View style={styles.sheet}>
          <TextField
            label="メールアドレス"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@example.com"
          />
          <TextField
            label="パスワード"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
          />
          <Button title="ノートをひらく" onPress={onSubmit} loading={loading} />
          <TouchableOpacity
            style={{ marginTop: SPACING.lg, alignItems: 'center' }}
            onPress={() => navigation.navigate('Register')}
          >
            <Text style={styles.registerLink}>新しい家庭ノートをつくる</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: SPACING.xl,
    paddingTop: SPACING.xxl * 2.2,
    backgroundColor: COLORS.paper,
    flexGrow: 1,
  },
  logoArea: { alignItems: 'center', marginBottom: SPACING.xl },
  hanko: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: COLORS.accent,
    borderWidth: 2,
    borderColor: COLORS.accentDeep,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-6deg' }],
    marginBottom: SPACING.md,
  },
  hankoText: {
    fontFamily: FONTS.black,
    fontSize: 14,
    lineHeight: 16,
    color: '#FFFDF6',
    textAlign: 'center',
  },
  title: {
    fontFamily: FONTS.displayBlack,
    fontSize: 40,
    color: COLORS.ink,
    letterSpacing: -1,
  },
  subtitle: {
    fontFamily: FONTS.medium,
    fontSize: 13,
    color: COLORS.inkSub,
    marginTop: SPACING.xs,
    letterSpacing: 2,
  },
  rule: {
    width: 120,
    borderBottomWidth: 1.5,
    borderBottomColor: COLORS.border,
    borderStyle: 'dashed',
    marginTop: SPACING.lg,
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
    ...SHADOW.card,
  },
  registerLink: {
    fontFamily: FONTS.bold,
    color: COLORS.indigo,
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});

export default LoginScreen;
