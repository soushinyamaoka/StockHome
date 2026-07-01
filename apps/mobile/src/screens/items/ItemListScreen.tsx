import React, { useLayoutEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';

import { deleteItem, fetchItems, toggleItemNotification } from '../../api/items';
import type { ItemWithStock } from '../../api/types';
import { DaysCounter } from '../../components/DaysCounter';
import { StampBadge } from '../../components/StampBadge';
import { TapeMemo } from '../../components/TapeMemo';
import { COLORS, FONTS, RADIUS, SHADOW, SPACING } from '../../theme';
import { remainQtyLabel, shortDate } from '../../lib/stockUtils';

export default function ItemListScreen() {
  const navigation = useNavigation<any>();
  const [showInactive, setShowInactive] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['items', showInactive],
    queryFn: () => fetchItems(showInactive),
  });

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('ItemForm', {})}
          style={styles.headerAdd}
        >
          <Ionicons name="add" size={20} color="#FFFDF6" />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['items'] });
    queryClient.invalidateQueries({ queryKey: ['stocks'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const notifMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      toggleItemNotification(id, enabled),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteItem,
    onSuccess: invalidate,
  });

  const confirmDelete = (item: ItemWithStock) => {
    Alert.alert('削除確認', `「${item.itemName}」をずかんから外しますか？\n（過去の記録は残ります）`, [
      { text: 'やめる', style: 'cancel' },
      { text: '外す', style: 'destructive', onPress: () => deleteMutation.mutate(item.id) },
    ]);
  };

  const renderItem = ({ item }: { item: ItemWithStock }) => (
    <View style={[styles.card, !item.isActive && { opacity: 0.55 }]}>
      <View style={styles.cardMain}>
        <DaysCounter snapshot={item.snapshot} unknown={item.isInventoryUnknown} size="compact" />
        <View style={styles.cardBody}>
          <Text style={styles.name} numberOfLines={2}>
            {item.itemName}
          </Text>
          <Text style={styles.sub}>
            {item.category || '未分類'}・のこり {remainQtyLabel(item.snapshot, item.unit)}
            ・切れる日 {shortDate(item.snapshot?.predictedOutOfStockDate ?? null)}
          </Text>
          <View style={styles.badgeRow}>
            {!item.isActive ? <StampBadge label="削除済み" color={COLORS.accentDeep} filled /> : null}
            {item.isInventoryUnknown ? <StampBadge label="在庫不明" color={COLORS.inkFaint} /> : null}
          </View>
        </View>
      </View>

      {item.itemMemo ? <TapeMemo text={item.itemMemo} /> : null}

      {item.alternatives.length > 0 ? (
        <View style={{ marginTop: SPACING.sm }}>
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

      <View style={styles.actionRow}>
        <View style={styles.notifWrap}>
          <Ionicons
            name={item.notificationEnabled ? 'notifications' : 'notifications-off-outline'}
            size={14}
            color={item.notificationEnabled ? COLORS.warn : COLORS.inkFaint}
          />
          <Switch
            value={item.notificationEnabled}
            onValueChange={(v) => notifMutation.mutate({ id: item.id, enabled: v })}
            trackColor={{ true: COLORS.warnSoft, false: COLORS.paperDeep }}
            thumbColor={item.notificationEnabled ? COLORS.warn : COLORS.inkFaint}
            disabled={!item.isActive}
            style={styles.switch}
          />
        </View>
        <TouchableOpacity
          style={styles.tool}
          onPress={() => navigation.navigate('PurchaseHistory', { itemId: item.id })}
        >
          <Ionicons name="receipt-outline" size={15} color={COLORS.inkSub} />
          <Text style={styles.toolText}>きろく</Text>
        </TouchableOpacity>
        {item.purchaseUrl ? (
          <TouchableOpacity style={styles.tool} onPress={() => Linking.openURL(item.purchaseUrl!)}>
            <Ionicons name="cart-outline" size={15} color={COLORS.indigo} />
            <Text style={[styles.toolText, { color: COLORS.indigo }]}>注文</Text>
          </TouchableOpacity>
        ) : null}
        {item.isActive ? (
          <>
            <TouchableOpacity
              style={styles.tool}
              onPress={() => navigation.navigate('ItemForm', { itemId: item.id })}
            >
              <Ionicons name="pencil-outline" size={15} color={COLORS.inkSub} />
              <Text style={styles.toolText}>編集</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tool} onPress={() => confirmDelete(item)}>
              <Ionicons name="trash-outline" size={15} color={COLORS.accentDeep} />
            </TouchableOpacity>
          </>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <TouchableOpacity
          style={[styles.filterChip, showInactive && styles.filterChipActive]}
          onPress={() => setShowInactive((v) => !v)}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterText, showInactive && styles.filterTextActive]}>
            外したものも見る
          </Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.xxl }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={COLORS.accent} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {isLoading ? '読み込み中…' : 'まだ何もありません。右上の＋から最初の消耗品を登録しましょう。'}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
  headerAdd: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.accent,
    borderWidth: 1.5,
    borderColor: COLORS.borderInk,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    ...SHADOW.card,
  },
  cardMain: { flexDirection: 'row' },
  cardBody: { flex: 1, marginLeft: SPACING.md },
  name: { fontFamily: FONTS.bold, fontSize: 15, color: COLORS.ink },
  sub: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkSub, marginTop: 3 },
  badgeRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xs },
  altText: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkSub, marginTop: 2 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.md,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    borderStyle: 'dashed',
    gap: SPACING.lg,
  },
  notifWrap: { flexDirection: 'row', alignItems: 'center' },
  switch: { transform: [{ scale: 0.8 }], marginLeft: -4 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  toolText: { fontFamily: FONTS.medium, fontSize: 12, color: COLORS.inkSub },
  empty: {
    fontFamily: FONTS.medium,
    textAlign: 'center',
    color: COLORS.inkFaint,
    marginTop: SPACING.xxl,
    lineHeight: 22,
  },
});
