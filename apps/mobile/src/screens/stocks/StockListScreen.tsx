import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Linking,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';

import { fetchStocks, setSnooze } from '../../api/items';
import type { StockEntry } from '../../api/types';
import { DaysCounter } from '../../components/DaysCounter';
import { StampBadge } from '../../components/StampBadge';
import { COLORS, FONTS, RADIUS, SHADOW, SPACING } from '../../theme';
import { remainQtyLabel, isSnoozed, shortDate, showSnoozeSheet } from '../../lib/stockUtils';

export default function StockListScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const highlightItemId: string | undefined = route.params?.highlightItemId;
  const [alertOnly, setAlertOnly] = useState(false);
  const listRef = useRef<FlatList<StockEntry>>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['stocks'],
    queryFn: fetchStocks,
  });

  const snoozeMutation = useMutation({
    mutationFn: ({ itemId, action }: { itemId: string; action: any }) => setSnooze(itemId, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stocks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const stocks = (data?.stocks ?? []).filter((s) => !alertOnly || s.snapshot?.alertNeeded);

  // ハイライト指定があれば該当位置までスクロール
  useEffect(() => {
    if (!highlightItemId || stocks.length === 0) return;
    const idx = stocks.findIndex((s) => s.item.id === highlightItemId);
    if (idx >= 0) {
      setTimeout(() => listRef.current?.scrollToIndex({ index: idx, animated: true }), 300);
    }
  }, [highlightItemId, stocks.length]);

  const renderItem = ({ item: entry }: { item: StockEntry }) => {
    const { item, snapshot, runtimeState } = entry;
    const alert = snapshot?.alertNeeded ?? false;
    const snoozed = isSnoozed(runtimeState);
    const highlighted = item.id === highlightItemId;

    return (
      <View
        style={[
          styles.card,
          alert && styles.cardAlert,
          highlighted && styles.cardHighlight,
        ]}
      >
        <View style={styles.cardMain}>
          <DaysCounter snapshot={snapshot} unknown={item.isInventoryUnknown} size="hero" />

          <View style={styles.cardBody}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={2}>
                {item.itemName}
              </Text>
            </View>
            <Text style={styles.detail}>
              のこり {remainQtyLabel(snapshot, item.unit)}
              ・切れる日 {shortDate(snapshot?.predictedOutOfStockDate ?? null)}
            </Text>
            <Text style={styles.detailSub}>
              最終購入 {shortDate(snapshot?.latestPurchaseDate ?? null)}
            </Text>
            <View style={styles.badgeRow}>
              {alert ? <StampBadge label="そろそろ" color={COLORS.accent} tilt /> : null}
              {snoozed ? <StampBadge label="スヌーズ中" color={COLORS.indigo} /> : null}
            </View>
          </View>
        </View>

        {/* 第一アクション「買った」を大きく。残りは小さな道具 */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.buyButton}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('PurchaseForm', { itemId: item.id })}
          >
            <Ionicons name="basket" size={15} color="#FFFDF6" />
            <Text style={styles.buyButtonText}>買った！</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.tool}
            onPress={() => navigation.navigate('StockCorrection', { itemId: item.id })}
          >
            <Ionicons name="create-outline" size={15} color={COLORS.inkSub} />
            <Text style={styles.toolText}>なおす</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tool}
            onPress={() =>
              showSnoozeSheet(item.itemName, snoozed, (action) =>
                snoozeMutation.mutate({ itemId: item.id, action })
              )
            }
          >
            <Ionicons name="moon-outline" size={15} color={COLORS.inkSub} />
            <Text style={styles.toolText}>あとで</Text>
          </TouchableOpacity>
          {item.purchaseUrl ? (
            <TouchableOpacity style={styles.tool} onPress={() => Linking.openURL(item.purchaseUrl!)}>
              <Ionicons name="cart-outline" size={15} color={COLORS.indigo} />
              <Text style={[styles.toolText, { color: COLORS.indigo }]}>注文</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {item.alternatives.length > 0 ? (
          <View style={styles.altWrap}>
            {item.alternatives.map((alt, i) => (
              <TouchableOpacity
                key={i}
                disabled={!alt.url}
                onPress={() => alt.url && Linking.openURL(alt.url)}
              >
                <Text style={[styles.altText, alt.url && { color: COLORS.indigo }]}>
                  ↳ 代わりに {alt.name}
                  {alt.note ? `（${alt.note}）` : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* 絞り込みトグル（ハンコ風チップ） */}
      <View style={styles.toolbar}>
        <TouchableOpacity
          style={[styles.filterChip, alertOnly && styles.filterChipActive]}
          onPress={() => setAlertOnly((v) => !v)}
          activeOpacity={0.7}
        >
          <Ionicons
            name={alertOnly ? 'flame' : 'flame-outline'}
            size={14}
            color={alertOnly ? COLORS.accentDeep : COLORS.inkSub}
          />
          <Text style={[styles.filterText, alertOnly && styles.filterTextActive]}>
            きれそうだけ
          </Text>
        </TouchableOpacity>
      </View>
      <FlatList
        ref={listRef}
        data={stocks}
        keyExtractor={(s) => s.item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.xxl }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={COLORS.accent} />}
        onScrollToIndexFailed={() => {}}
        ListEmptyComponent={
          <Text style={styles.empty}>{isLoading ? '読み込み中…' : '品目がありません'}</Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    backgroundColor: COLORS.surface,
  },
  filterChipActive: { borderColor: COLORS.accentDeep, backgroundColor: COLORS.accentSoft },
  filterText: { fontFamily: FONTS.medium, fontSize: 12, color: COLORS.inkSub },
  filterTextActive: { fontFamily: FONTS.bold, color: COLORS.accentDeep },
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    ...SHADOW.card,
  },
  cardAlert: { borderColor: COLORS.accent, borderWidth: 1.5 },
  cardHighlight: { borderColor: COLORS.indigo, borderWidth: 2 },
  cardMain: { flexDirection: 'row' },
  cardBody: { flex: 1, marginLeft: SPACING.md },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { fontFamily: FONTS.bold, fontSize: 16, color: COLORS.ink, flexShrink: 1 },
  detail: { fontFamily: FONTS.medium, fontSize: 12.5, color: COLORS.inkSub, marginTop: SPACING.xs },
  detailSub: { fontFamily: FONTS.body, fontSize: 11.5, color: COLORS.inkFaint, marginTop: 1 },
  badgeRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    borderStyle: 'dashed',
    gap: SPACING.md,
  },
  buyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.accent,
    borderWidth: 1.5,
    borderColor: COLORS.borderInk,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 7,
  },
  buyButtonText: { fontFamily: FONTS.bold, fontSize: 13, color: '#FFFDF6' },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  toolText: { fontFamily: FONTS.medium, fontSize: 12, color: COLORS.inkSub },
  altWrap: { marginTop: SPACING.sm },
  altText: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkSub, marginTop: 2 },
  empty: { fontFamily: FONTS.medium, textAlign: 'center', color: COLORS.inkFaint, marginTop: SPACING.xxl },
});
