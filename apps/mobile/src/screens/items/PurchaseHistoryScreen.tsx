import React, { useLayoutEffect } from 'react';
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
import { useNavigation, useRoute } from '@react-navigation/native';
import { VENDOR_LABELS, type ExternalVendor } from '@stockhome/shared';

import { deletePurchase, fetchItem, fetchPurchases } from '../../api/items';
import type { PurchaseDto } from '../../api/types';
import { Card } from '../../components/Card';
import { COLORS, FONTS, RADIUS, SPACING } from '../../theme';

function yen(n: number | null): string {
  if (n == null) return '—';
  return `¥${n.toLocaleString()}`;
}

export default function PurchaseHistoryScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const itemId: string = route.params.itemId;
  const queryClient = useQueryClient();

  const { data: itemData } = useQuery({
    queryKey: ['item', itemId],
    queryFn: () => fetchItem(itemId),
  });
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['purchases', itemId],
    queryFn: () => fetchPurchases(itemId),
  });

  useLayoutEffect(() => {
    if (itemData?.item) {
      navigation.setOptions({ title: `${itemData.item.itemName} の履歴` });
    }
  }, [navigation, itemData]);

  const deleteMutation = useMutation({
    mutationFn: deletePurchase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases', itemId] });
      queryClient.invalidateQueries({ queryKey: ['stocks'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });

  const confirmDelete = (p: PurchaseDto) => {
    Alert.alert('削除確認', `${p.purchasedAt} の購入記録（${p.qty}）を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => deleteMutation.mutate(p.id) },
    ]);
  };

  const stats = data?.priceStats;
  const unit = itemData?.item.unit ?? '';

  const sourceLabel = (p: PurchaseDto): string => {
    if (p.source === 'gmail') {
      return VENDOR_LABELS[p.externalVendor as ExternalVendor] ?? 'メール取込';
    }
    return p.source === 'manual' ? '手動' : p.source;
  };

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl }}
      data={data?.purchases ?? []}
      keyExtractor={(p) => p.id}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      ListHeaderComponent={
        stats && stats.count > 0 ? (
          <Card style={styles.statsCard}>
            <Text style={styles.statsTitle}>価格統計（1箱の単価）</Text>
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{yen(stats.latest)}</Text>
                <Text style={styles.statLabel}>最新</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{yen(stats.avg)}</Text>
                <Text style={styles.statLabel}>平均</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{yen(stats.min)}</Text>
                <Text style={styles.statLabel}>最安</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{yen(stats.max)}</Text>
                <Text style={styles.statLabel}>最高</Text>
              </View>
            </View>
          </Card>
        ) : null
      }
      renderItem={({ item: p }) => (
        <Card style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowDate}>
              {p.purchasedAt}　{p.qty}
              {unit}
              {p.price != null ? `　${yen(p.price)}` : ''}
            </Text>
            <Text style={styles.rowSub}>
              {sourceLabel(p)}
              {p.purchasedByUserName ? ` / ${p.purchasedByUserName}` : ''}
              {p.countedInInventory ? '' : ' / 在庫未反映'}
            </Text>
            {p.note ? <Text style={styles.rowNote}>{p.note}</Text> : null}
          </View>
          <TouchableOpacity onPress={() => confirmDelete(p)}>
            <Ionicons name="trash-outline" size={18} color={COLORS.inkFaint} />
          </TouchableOpacity>
        </Card>
      )}
      ListEmptyComponent={
        <Text style={styles.empty}>{isLoading ? '読み込み中...' : '購入履歴がありません'}</Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
  statsCard: { borderRadius: RADIUS.lg, borderWidth: 1.5, borderColor: COLORS.borderInk },
  statsTitle: { fontFamily: FONTS.bold, fontSize: 13, color: COLORS.inkSub, marginBottom: SPACING.sm },
  statsRow: { flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontFamily: FONTS.display, fontSize: 16, color: COLORS.ink },
  statLabel: { fontFamily: FONTS.medium, fontSize: 10, color: COLORS.inkFaint, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: RADIUS.md },
  rowDate: { fontFamily: FONTS.bold, fontSize: 14, color: COLORS.ink },
  rowSub: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkSub, marginTop: 2 },
  rowNote: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkFaint, marginTop: 2 },
  empty: { fontFamily: FONTS.medium, textAlign: 'center', color: COLORS.inkFaint, marginTop: SPACING.xxl },
});
