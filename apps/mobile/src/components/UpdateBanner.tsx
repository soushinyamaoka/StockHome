import React, { useEffect, useRef } from 'react';
import { Alert, AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { COLORS, FONTS, RADIUS, SPACING } from '../theme';

// アプリに戻ってきたときの確認は、この間隔より短ければ省く
const RESUME_CHECK_INTERVAL_MS = 5 * 60 * 1000;

type UpdatesModule = typeof import('expo-updates');

// Expo Go（iPhone）と開発時はexpo-updatesを使えないため読み込まない（読み込むだけでネイティブ部分を要求する）。
// iPhoneでは設定画面の「アプリの版」で確認する
function loadUpdates(): UpdatesModule | null {
  if (__DEV__ || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null;
  try {
    const updates: UpdatesModule = require('expo-updates');
    return updates.isEnabled ? updates : null;
  } catch {
    return null;
  }
}

const Updates = loadUpdates();

// 新しい版をダウンロード済みなら、再起動ボタンを出す。
// EAS Updateは起動時に取得して次の起動で反映するため、利用者が開き直したか分からなくなりやすい
export function UpdateBanner() {
  return Updates ? <UpdateBannerContent updates={Updates} /> : null;
}

function UpdateBannerContent({ updates }: { updates: UpdatesModule }) {
  const { isUpdatePending, isRestarting } = updates.useUpdates();
  const lastCheckedAt = useRef(0);

  // 起動時の取得はexpo-updatesが自動で行う。ここではアプリに戻ってきたときにも確認する
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      const now = Date.now();
      if (now - lastCheckedAt.current < RESUME_CHECK_INTERVAL_MS) return;
      lastCheckedAt.current = now;
      try {
        const result = await updates.checkForUpdateAsync();
        if (result.isAvailable) await updates.fetchUpdateAsync();
      } catch {
        // 通信できないときは次に戻ってきたときに確認する
      }
    });
    return () => subscription.remove();
  }, [updates]);

  if (!isUpdatePending) return null;

  const restart = async () => {
    try {
      await updates.reloadAsync();
    } catch {
      Alert.alert('再起動できませんでした', 'アプリを一度終了して、開きなおしてください。');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.message}>アプリの新しい版を受け取りました</Text>
      <TouchableOpacity style={styles.button} onPress={restart} disabled={isRestarting} activeOpacity={0.75}>
        <Text style={styles.buttonText}>再起動</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    marginHorizontal: SPACING.md, marginBottom: SPACING.sm, padding: SPACING.md,
    backgroundColor: COLORS.indigoSoft, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.indigo,
  },
  message: { flex: 1, fontFamily: FONTS.medium, fontSize: 12, color: COLORS.indigo },
  button: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill, backgroundColor: COLORS.indigo },
  buttonText: { fontFamily: FONTS.bold, fontSize: 12, color: COLORS.surface },
});
