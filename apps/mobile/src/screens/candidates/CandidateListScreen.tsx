import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import {
  CANDIDATE_STATUS_LABELS,
  VENDOR_LABELS,
  type CandidateStatus,
  type ExternalVendor,
} from '@stockhome/shared';

import { confirmCandidate, fetchCandidates, ignoreCandidate } from '../../api/misc';
import { fetchItems } from '../../api/items';
import type { CandidateDto } from '../../api/types';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { ItemPicker } from '../../components/ItemPicker';
import { StampBadge } from '../../components/StampBadge';
import { COLORS, FONTS, RADIUS, SPACING } from '../../theme';

export default function CandidateListScreen() {
  const navigation = useNavigation<any>();
  const [includeResolved, setIncludeResolved] = useState(false);
  // 候補ごとに選択中の品目を保持
  const [selections, setSelections] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['candidates', includeResolved],
    queryFn: () => fetchCandidates(includeResolved),
  });
  const { data: itemsData } = useQuery({ queryKey: ['items'], queryFn: () => fetchItems() });
  const items = itemsData?.items ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['candidates'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['stocks'] });
    queryClient.invalidateQueries({ queryKey: ['items'] });
  };

  const confirmMutation = useMutation({
    mutationFn: ({ id, matchedItemId }: { id: string; matchedItemId: string }) =>
      confirmCandidate(id, matchedItemId),
    onSuccess: () => {
      invalidate();
      Alert.alert('確定完了', '購入履歴に反映しました');
    },
    onError: (e: any) => {
      Alert.alert('エラー', e?.response?.data?.message ?? '確定に失敗しました');
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: ignoreCandidate,
    onSuccess: invalidate,
  });

  const isResolved = (status: string) =>
    !['detected', 'ordered', 'shipped'].includes(status);

  const renderItem = ({ item: c }: { item: CandidateDto }) => {
    const statusColor = COLORS.candidate[c.candidateStatus] ?? COLORS.inkFaint;
    const resolved = isResolved(c.candidateStatus);
    const matchedItem = c.matchedItemId ? items.find((i) => i.id === c.matchedItemId) : null;

    return (
      <Card style={styles.card}>
        <View style={styles.headerRow}>
          <StampBadge
            label={VENDOR_LABELS[c.vendor as ExternalVendor] ?? c.vendor}
            color={statusColor}
            filled
          />
          <StampBadge
            label={CANDIDATE_STATUS_LABELS[c.candidateStatus as CandidateStatus] ?? c.candidateStatus}
            color={statusColor}
            tilt
          />
          <Text style={styles.date}>{c.mailDate.slice(0, 10)}</Text>
        </View>

        <Text style={styles.itemName}>{c.itemNameRaw || '(商品名不明)'}</Text>
        <Text style={styles.sub}>
          {c.detectedQty != null ? `数量: ${c.detectedQty}` : ''}
          {c.detectedPrice != null ? `　単価: ¥${c.detectedPrice.toLocaleString()}` : ''}
        </Text>
        {c.rawSubject ? (
          <Text style={styles.subject} numberOfLines={1}>
            {c.rawSubject}
          </Text>
        ) : null}
        {c.parseResult ? <Text style={styles.parseResult}>{c.parseResult}</Text> : null}

        {/* 確定/自動確定済み: 購入履歴・在庫への反映状況を見える化 */}
        {c.reflection ? (
          <View style={styles.reflectBox}>
            <Text style={styles.reflectItem}>
              → {c.reflection.matchedItemName}
              {!c.reflection.matchedItemActive ? '（削除済み）' : ''}
            </Text>
            <Text style={styles.reflectSub}>
              {c.reflection.qty}
              {c.reflection.unit ?? ''} を登録
              {c.reflection.countedInInventory
                ? '・在庫反映済み'
                : `・在庫反映待ち（${c.reflection.inventoryEffectiveAt ?? '日付未定'}〜）`}
            </Text>
          </View>
        ) : matchedItem ? (
          <Text style={styles.matched}>→ {matchedItem.itemName}</Text>
        ) : null}

        {!resolved ? (
          <View style={styles.actions}>
            <ItemPicker
              label="紐付ける品目"
              items={items}
              value={selections[c.id] ?? null}
              onChange={(itemId) => setSelections((s) => ({ ...s, [c.id]: itemId }))}
            />
            <View style={styles.buttonRow}>
              <View style={{ flex: 1 }}>
                <Button
                  title="確定する"
                  onPress={() => {
                    const matchedItemId = selections[c.id];
                    if (!matchedItemId) {
                      Alert.alert('入力エラー', '紐付ける品目を選択してください');
                      return;
                    }
                    confirmMutation.mutate({ id: c.id, matchedItemId });
                  }}
                  loading={confirmMutation.isPending}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="無視"
                  variant="secondary"
                  onPress={() =>
                    Alert.alert('無視確認', 'この候補を無視しますか？', [
                      { text: 'キャンセル', style: 'cancel' },
                      { text: '無視する', onPress: () => ignoreMutation.mutate(c.id) },
                    ])
                  }
                />
              </View>
            </View>
            {/* 紐付ける品目がまだ無い場合: 商品名を引き継いで新規登録へ */}
            <TouchableOpacity
              style={styles.newItemLink}
              activeOpacity={0.7}
              onPress={() =>
                navigation.navigate('ItemsTab', {
                  screen: 'ItemForm',
                  params: { prefillName: c.itemNameRaw ?? '' },
                })
              }
            >
              <Ionicons name="add-circle-outline" size={16} color={COLORS.indigo} />
              <Text style={styles.newItemText}>新しい消耗品として登録する</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <TouchableOpacity
          style={[styles.filterChip, includeResolved && styles.filterChipActive]}
          onPress={() => setIncludeResolved((v) => !v)}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterText, includeResolved && styles.filterTextActive]}>
            処理済みも見る
          </Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={data?.candidates ?? []}
        keyExtractor={(c) => c.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {isLoading
              ? '読み込み中…'
              : '届いている取込便はありません。\nAmazon・マツキヨの注文メールが届くと、\n自動でここに並びます（6時間ごと）。'}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
  },
  filterChip: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    backgroundColor: COLORS.surface,
  },
  filterChipActive: { borderColor: COLORS.borderInk, backgroundColor: COLORS.paperDeep },
  filterText: { fontFamily: FONTS.medium, fontSize: 12, color: COLORS.inkSub },
  filterTextActive: { fontFamily: FONTS.bold, color: COLORS.ink },
  card: { borderRadius: RADIUS.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  date: { marginLeft: 'auto', fontFamily: FONTS.medium, fontSize: 12, color: COLORS.inkFaint },
  itemName: { fontFamily: FONTS.bold, fontSize: 15, color: COLORS.ink, marginTop: SPACING.sm },
  sub: { fontFamily: FONTS.medium, fontSize: 13, color: COLORS.inkSub, marginTop: 2 },
  subject: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.inkFaint, marginTop: 2 },
  parseResult: { fontFamily: FONTS.medium, fontSize: 11, color: COLORS.warn, marginTop: 2 },
  matched: { fontFamily: FONTS.bold, fontSize: 13, color: COLORS.ok, marginTop: SPACING.xs },
  reflectBox: {
    marginTop: SPACING.sm,
    backgroundColor: COLORS.okSoft,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.ok,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  reflectItem: { fontFamily: FONTS.bold, fontSize: 13, color: COLORS.ok },
  reflectSub: { fontFamily: FONTS.medium, fontSize: 11.5, color: COLORS.inkSub, marginTop: 1 },
  actions: {
    marginTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    borderStyle: 'dashed',
    paddingTop: SPACING.md,
  },
  buttonRow: { flexDirection: 'row', gap: SPACING.sm },
  newItemLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: SPACING.md,
  },
  newItemText: {
    fontFamily: FONTS.bold,
    fontSize: 13,
    color: COLORS.indigo,
    textDecorationLine: 'underline',
  },
  empty: {
    fontFamily: FONTS.medium,
    textAlign: 'center',
    color: COLORS.inkFaint,
    marginTop: SPACING.xxl,
    lineHeight: 22,
  },
});
