import React from 'react';
import {
  Alert,
  AppState,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchDashboard } from '../api/misc';
import { createPurchase, deletePurchase } from '../api/items';
import type { StockEntry } from '../api/types';
import { Section } from '../components/Section';
import { Button } from '../components/Button';
import { DaysCounter } from '../components/DaysCounter';
import { ErrorState } from '../components/ErrorState';
import { BatchStatusBanner } from '../components/BatchStatusBanner';
import { NoticeBanner } from '../components/NoticeBanner';
import { NoticeUnreadCard } from '../components/NoticeUnreadCard';
import { OfflineNotice } from '../components/OfflineNotice';
import { useAuth } from '../hooks/useAuth';
import { COLORS, FONTS, RADIUS, SHADOW, SPACING } from '../theme';
import { remainQtyLabel, isSnoozed } from '../lib/stockUtils';
import { buildQuickPurchaseInput, quickPurchaseMessage } from '../lib/quickPurchase';

type UndoPurchase = { purchaseId: string; itemId: string; message: string };

function todayLabel(): string {
  const d = new Date();
  const youbi = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日（${youbi}）`;
}

export default function DashboardScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [undo, setUndo] = React.useState<UndoPurchase | null>(null);
  const undoTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTargetRef = React.useRef<UndoPurchase | null>(null);
  const openNotices = () => navigation.navigate('OperatorNotices');
  const { data, dataUpdatedAt, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboard,
  });

  const clearUndoTimer = React.useCallback(() => {
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
  }, []);

  React.useEffect(() => clearUndoTimer, [clearUndoTimer]);

  const invalidatePurchaseQueries = React.useCallback((itemId: string) => {
    void queryClient.invalidateQueries({ queryKey: ['stocks'] });
    void queryClient.invalidateQueries({ queryKey: ['items'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['purchases', itemId] });
  }, [queryClient]);

  const purchaseMutation = useMutation({
    mutationFn: (entry: StockEntry) => createPurchase(buildQuickPurchaseInput(entry.item)),
    onSuccess: ({ purchase }, entry) => {
      const itemId = entry.item.id;
      invalidatePurchaseQueries(itemId);
      clearUndoTimer();
      const nextUndo = {
        purchaseId: purchase.id,
        itemId,
        message: quickPurchaseMessage(entry.item.itemName, buildQuickPurchaseInput(entry.item).qty, entry.item.unit),
      };
      setUndo(nextUndo);
      undoTimer.current = setTimeout(() => {
        setUndo(null);
        undoTimer.current = null;
      }, 6000);
    },
    onError: (error: any) => {
      Alert.alert('エラー', error?.response?.data?.message ?? '記録に失敗しました');
    },
  });

  const undoMutation = useMutation({
    mutationFn: (purchaseId: string) => deletePurchase(purchaseId),
    onSuccess: (_result, purchaseId) => {
      const target = undoTargetRef.current;
      if (target?.purchaseId === purchaseId) {
        invalidatePurchaseQueries(target.itemId);
        if (undo?.purchaseId === purchaseId) setUndo(null);
      }
      clearUndoTimer();
    },
    onError: (error: any) => {
      undoTargetRef.current = null;
      clearUndoTimer();
      setUndo(null);
      Alert.alert('エラー', error?.response?.data?.message ?? '取り消しに失敗しました。購入履歴から削除してください');
    },
  });

  // 他tabから戻ってきた時（画面focus）に最新状態を取得し直す
  useFocusEffect(
    React.useCallback(() => {
      refetch();
    }, [refetch])
  );

  // appがバックグラウンドから復帰した時（画面はfocus済みのまま）にも取得し直す
  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refetch();
    });
    return () => subscription.remove();
  }, [refetch]);

  const alerts = data?.alerts ?? [];
  const alertTotal = data?.alertTotal ?? alerts.length;
  const moreAlerts = Math.max(0, alertTotal - alerts.length);

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        paddingTop: insets.top + SPACING.lg,
        padding: SPACING.lg,
        paddingBottom: undo ? SPACING.xxl + 64 : SPACING.xxl,
      }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={COLORS.accent} />}
    >
      {/* 表紙ヘッダー: 日付と挨拶。手帳の今日のページをひらいた気分に */}
      <View style={styles.hero}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroDate}>{todayLabel()}</Text>
          <Text style={styles.heroTitle}>
            {user?.name}さんの{'\n'}おうち在庫ノート
          </Text>
        </View>
        <View style={styles.heroStamp}>
          <Text style={styles.heroStampText}>Stock{'\n'}Home</Text>
        </View>
      </View>

      <NoticeBanner onPress={openNotices} />
      <NoticeUnreadCard onPress={openNotices} />
      {isError && data ? <OfflineNotice updatedAt={dataUpdatedAt} onRetry={refetch} /> : null}

      {/* きょうの数字（3項目の帯） */}
      <View style={styles.statsStrip}>
        <View style={styles.stat}>
          <Text style={[styles.statNum, alertTotal > 0 && { color: COLORS.accent }]}>
            {data ? alertTotal : '–'}
          </Text>
          <Text style={styles.statLabel}>きれそう</Text>
        </View>
        <View style={styles.statDivider} />
        <TouchableOpacity
          style={styles.stat}
          onPress={() => navigation.navigate('CandidatesTab', { screen: 'CandidateList' })}
        >
          <Text style={[styles.statNum, (data?.pendingCandidates ?? 0) > 0 && { color: COLORS.indigo }]}>
            {data?.pendingCandidates ?? '–'}
          </Text>
          <Text style={styles.statLabel}>取込便</Text>
        </TouchableOpacity>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statNum}>{data?.totalActiveItems ?? '–'}</Text>
          <Text style={styles.statLabel}>登録品目</Text>
        </View>
      </View>

      {/* きれそうな消耗品（上位5件。総数は alertTotal） */}
      <BatchStatusBanner lastBatchRun={data?.lastBatchRun ?? null} />

      <Section title="そろそろ切れそう" count={alertTotal}>
        {isError && !data ? (
          <ErrorState onRetry={refetch} />
        ) : isLoading ? (
          <Text style={styles.muted}>読み込み中…</Text>
        ) : alerts.length === 0 ? (
          <View style={styles.okBox}>
            <Text style={styles.okEmoji}>◎</Text>
            <Text style={styles.okText}>在庫はみんな足りています</Text>
          </View>
        ) : (
          alerts.map((entry) => {
            const { item, snapshot, runtimeState } = entry;
            const isRecorded = undo?.itemId === item.id;
            return (
              <View key={item.id} style={styles.alertCard}>
                <TouchableOpacity
                  style={styles.alertMain}
                  activeOpacity={0.75}
                  onPress={() => navigation.navigate('StocksTab', {
                    screen: 'StockList',
                    params: { highlightItemId: item.id },
                  })}
                >
                <DaysCounter snapshot={snapshot} size="compact" />
                <View style={{ flex: 1, marginLeft: SPACING.md }}>
                  <Text style={styles.alertName} numberOfLines={1}>
                    {item.itemName}
                  </Text>
                  <Text style={styles.alertSub}>
                    のこり {remainQtyLabel(snapshot, item.unit)}
                    {isSnoozed(runtimeState) ? '・スヌーズ中' : ''}
                  </Text>
                </View>
                </TouchableOpacity>
                <View style={styles.quickPurchaseButton} accessibilityLabel={`${item.itemName}を買ったとして記録`}>
                  <Button
                    title={isRecorded ? '記録済み' : '買った'}
                    variant="primary"
                    small
                    icon={<Ionicons name="basket" size={14} color="#FFFDF6" />}
                    onPress={() => purchaseMutation.mutate(entry)}
                    disabled={purchaseMutation.isPending || undoMutation.isPending || isRecorded}
                    loading={purchaseMutation.isPending && purchaseMutation.variables?.item.id === item.id}
                  />
                </View>
              </View>
            );
          })
        )}
        {moreAlerts > 0 ? (
          <TouchableOpacity
            style={styles.moreLink}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('StocksTab', { screen: 'StockList' })}
          >
            <Text style={styles.moreText}>ほか {moreAlerts} 件をぜんぶ見る</Text>
            <Ionicons name="arrow-forward" size={14} color={COLORS.indigo} />
          </TouchableOpacity>
        ) : null}
      </Section>

      {/* クイック操作 */}
      <Section title="きょうの用事">
        <Button
          title="買ったよ！を記録する"
          icon={<Ionicons name="basket" size={18} color="#FFFDF6" />}
          onPress={() => navigation.navigate('ItemsTab', { screen: 'PurchaseForm', params: {} })}
        />
        <View style={{ height: SPACING.md }} />
        <View style={styles.quickRow}>
          <View style={{ flex: 1 }}>
            <Button
              title="消耗品を追加"
              variant="outline"
              small
              onPress={() => navigation.navigate('ItemsTab', { screen: 'ItemForm', params: {} })}
            />
          </View>
          <View style={{ width: SPACING.sm }} />
          <View style={{ flex: 1 }}>
            <Button
              title="取込便を見る"
              variant="outline"
              small
              onPress={() => navigation.navigate('CandidatesTab', { screen: 'CandidateList' })}
            />
          </View>
        </View>
      </Section>
    </ScrollView>
    {undo ? (
      <View style={styles.undoBar}>
        <Text style={styles.undoMessage} numberOfLines={2}>{undo.message}</Text>
        <TouchableOpacity
          onPress={() => {
            clearUndoTimer();
            undoTargetRef.current = undo;
            undoMutation.mutate(undo.purchaseId);
          }}
          disabled={undoMutation.isPending}
          style={styles.undoButton}
        >
          <Text style={styles.undoButtonText}>{undoMutation.isPending ? '取消中…' : '取り消す'}</Text>
        </TouchableOpacity>
      </View>
    ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
  hero: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: SPACING.xl },
  heroDate: {
    fontFamily: FONTS.medium,
    fontSize: 13,
    color: COLORS.inkSub,
    letterSpacing: 1,
    marginBottom: SPACING.xs,
  },
  heroTitle: {
    fontFamily: FONTS.black,
    fontSize: 24,
    lineHeight: 34,
    color: COLORS.ink,
  },
  heroStamp: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '8deg' }],
    marginTop: SPACING.sm,
  },
  heroStampText: {
    fontFamily: FONTS.display,
    fontSize: 12,
    lineHeight: 14,
    color: COLORS.accent,
    textAlign: 'center',
  },
  statsStrip: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.borderInk,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.md,
    marginBottom: SPACING.xl,
    ...SHADOW.card,
  },
  stat: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, backgroundColor: COLORS.border, marginVertical: SPACING.xs },
  statNum: { fontFamily: FONTS.display, fontSize: 26, color: COLORS.ink },
  statLabel: { fontFamily: FONTS.medium, fontSize: 11, color: COLORS.inkSub, marginTop: 2 },
  muted: { fontFamily: FONTS.medium, color: COLORS.inkFaint },
  okBox: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    backgroundColor: COLORS.okSoft,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.ok,
    borderStyle: 'dashed',
  },
  okEmoji: { fontFamily: FONTS.black, fontSize: 28, color: COLORS.ok },
  okText: { fontFamily: FONTS.bold, fontSize: 14, color: COLORS.ok, marginTop: SPACING.xs },
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderLeftWidth: 5,
    borderLeftColor: COLORS.accent,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...SHADOW.card,
  },
  alertMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  quickPurchaseButton: { marginLeft: SPACING.sm },
  undoBar: {
    position: 'absolute',
    left: SPACING.lg,
    right: SPACING.lg,
    bottom: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.ink,
    borderRadius: RADIUS.md,
    paddingLeft: SPACING.md,
    ...SHADOW.card,
  },
  undoMessage: { flex: 1, fontFamily: FONTS.medium, color: COLORS.surface },
  undoButton: { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md },
  undoButtonText: { fontFamily: FONTS.bold, color: COLORS.accentSoft },
  alertName: { fontFamily: FONTS.bold, fontSize: 15, color: COLORS.ink },
  alertSub: { fontFamily: FONTS.medium, fontSize: 12, color: COLORS.inkSub, marginTop: 2 },
  quickRow: { flexDirection: 'row' },
  moreLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: SPACING.sm,
  },
  moreText: { fontFamily: FONTS.bold, fontSize: 13, color: COLORS.indigo },
});
