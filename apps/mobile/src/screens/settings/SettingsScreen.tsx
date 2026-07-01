import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';

import { fetchAppConfig, fetchUsers, runBatchManually, updateDeliveryBuffer } from '../../api/misc';
import { recalculateStocks } from '../../api/items';
import { Card } from '../../components/Card';
import { Section } from '../../components/Section';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../hooks/useAuth';
import { COLORS, FONTS, SPACING } from '../../theme';

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();

  const { data: usersData } = useQuery({ queryKey: ['users'], queryFn: fetchUsers });
  const { data: configData } = useQuery({ queryKey: ['appConfig'], queryFn: fetchAppConfig });

  const [bufferDays, setBufferDays] = useState('');
  useEffect(() => {
    if (configData && bufferDays === '') {
      setBufferDays(String(configData.deliveryBufferDays));
    }
  }, [configData]);

  const bufferMutation = useMutation({
    mutationFn: updateDeliveryBuffer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appConfig'] });
      Alert.alert('保存完了', '配送バッファ日数を更新しました');
    },
  });

  const recalcMutation = useMutation({
    mutationFn: recalculateStocks,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stocks'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      Alert.alert('完了', '在庫を数えなおしました');
    },
  });

  const batchMutation = useMutation({
    mutationFn: runBatchManually,
    onSuccess: (r) => {
      queryClient.invalidateQueries();
      Alert.alert(
        'バッチ完了',
        `アラート: ${r.alerts}件\nReadyGoキュー投入: ${r.queued ? 'あり（GASの夜間トリガーが配信）' : 'なし'}`
      );
    },
    onError: (e: any) => {
      Alert.alert('エラー', e?.response?.data?.message ?? 'バッチ実行に失敗しました');
    },
  });

  // GAS WebアプリのGmail設定ページ（app.json の extra.gmailSettingsUrl に設定）
  const gmailSettingsUrl = (Constants.expoConfig?.extra as any)?.gmailSettingsUrl as
    | string
    | undefined;

  const linkRow = (icon: any, label: string, onPress: () => void, color = COLORS.ink) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <View style={styles.linkRow}>
        <Ionicons name={icon} size={18} color={color} />
        <Text style={[styles.linkText, { color }]}>{label}</Text>
        <Ionicons name="chevron-forward" size={16} color={COLORS.inkFaint} />
      </View>
    </TouchableOpacity>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl }}
    >
      {/* プロフィール: 名札 */}
      <Card style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(user?.name ?? '?').slice(0, 1)}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: SPACING.md }}>
          <Text style={styles.userName}>{user?.name}</Text>
          <Text style={styles.userSub}>{user?.email}</Text>
          <Text style={styles.userSub}>
            {user?.householdName}・{user?.role === 'admin' ? '管理者' : 'メンバー'}
          </Text>
        </View>
      </Card>

      <Section title="アカウント">
        <Card>
          {linkRow('key-outline', 'パスワードを変更する', () =>
            navigation.navigate('ChangePassword')
          )}
          <View style={styles.divider} />
          {linkRow('notifications-outline', 'お知らせのきろく', () =>
            navigation.navigate('NotificationLog')
          )}
        </Card>
      </Section>

      <Section title="家族メンバー" count={usersData?.users.length}>
        <Card>
          {(usersData?.users ?? []).map((u, i) => (
            <View key={u.id}>
              {i > 0 ? <View style={styles.divider} /> : null}
              <View style={styles.userRow}>
                <View style={[styles.miniAvatar, !u.isActive && { opacity: 0.4 }]}>
                  <Text style={styles.miniAvatarText}>{u.name.slice(0, 1)}</Text>
                </View>
                <Text style={styles.userRowName}>{u.name}</Text>
                <Text style={styles.userRowRole}>{u.role === 'admin' ? '管理者' : 'メンバー'}</Text>
              </View>
            </View>
          ))}
          <View style={styles.divider} />
          {linkRow(
            'people-outline',
            user?.role === 'admin' ? '家族の追加・編集' : '家族メンバーを見る',
            () => navigation.navigate('Family')
          )}
        </Card>
      </Section>

      <Section title="メール取込（Gmail）">
        <Card>
          <Text style={styles.note}>
            Amazon・マツキヨの注文メールは、各自の Google アカウント側（Apps
            Script）が6時間ごとに読み取って届けてくれます。取込のON/OFFや検索条件はGASの設定ページから。
          </Text>
          {gmailSettingsUrl ? (
            <Button
              title="Gmail取込設定をひらく"
              variant="outline"
              small
              icon={<Ionicons name="open-outline" size={14} color={COLORS.ink} />}
              onPress={() => Linking.openURL(gmailSettingsUrl)}
            />
          ) : null}
        </Card>
        <TextField
          label="配送バッファ日数"
          value={bufferDays}
          onChangeText={setBufferDays}
          keyboardType="number-pad"
          helper="発送メールの日付＋この日数で在庫に数えはじめます"
        />
        <Button
          title="バッファ日数を保存"
          variant="outline"
          small
          onPress={() => {
            const n = Number(bufferDays);
            if (bufferDays === '' || Number.isNaN(n) || n < 0 || !Number.isInteger(n)) {
              Alert.alert('入力エラー', '0以上の整数で入力してください');
              return;
            }
            bufferMutation.mutate(n);
          }}
          loading={bufferMutation.isPending}
        />
      </Section>

      <Section title="おそうじ・点検">
        <Button
          title="在庫を数えなおす"
          variant="outline"
          small
          onPress={() => recalcMutation.mutate()}
          loading={recalcMutation.isPending}
        />
        {user?.role === 'admin' ? (
          <>
            <View style={{ height: SPACING.sm }} />
            <Button
              title="夜間バッチを今すぐ実行（通知テスト）"
              variant="outline"
              small
              onPress={() =>
                Alert.alert(
                  '確認',
                  '在庫計算と通知判定を実行します。アラート対象があれば ReadyGo（LINE通知）の配信キューに積まれます。よろしいですか？',
                  [
                    { text: 'やめる', style: 'cancel' },
                    { text: '実行', onPress: () => batchMutation.mutate() },
                  ]
                )
              }
              loading={batchMutation.isPending}
            />
          </>
        ) : null}
      </Section>

      <View style={{ height: SPACING.sm }} />
      <Button title="ログアウト" variant="danger" onPress={logout} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
  profile: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.accent,
    borderWidth: 1.5,
    borderColor: COLORS.borderInk,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-4deg' }],
  },
  avatarText: { fontFamily: FONTS.black, fontSize: 22, color: '#FFFDF6' },
  userName: { fontFamily: FONTS.bold, fontSize: 17, color: COLORS.ink },
  userSub: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkSub, marginTop: 1 },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    borderStyle: 'dashed',
    marginVertical: SPACING.xs,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm + 2,
  },
  linkText: { flex: 1, fontFamily: FONTS.bold, fontSize: 14 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm },
  miniAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.paperDeep,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniAvatarText: { fontFamily: FONTS.bold, fontSize: 13, color: COLORS.inkSub },
  userRowName: { flex: 1, fontFamily: FONTS.medium, fontSize: 14, color: COLORS.ink },
  userRowRole: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkFaint },
  note: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkSub, lineHeight: 19, marginBottom: SPACING.md },
});
