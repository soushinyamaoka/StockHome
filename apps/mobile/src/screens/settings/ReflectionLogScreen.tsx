import React, { useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { fetchReflections } from '../../api/misc';
import type { ReflectionDto } from '../../api/types';
import { Card } from '../../components/Card';
import { StampBadge } from '../../components/StampBadge';
import { COLORS, FONTS, RADIUS, SPACING } from '../../theme';

type ReflectionFilter = 'all' | ReflectionDto['category'];

const FILTERS: { value: ReflectionFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'auto', label: '自動' },
  { value: 'manual', label: '手動' },
];

export default function ReflectionLogScreen() {
  const [filter, setFilter] = useState<ReflectionFilter>('all');
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['reflections'],
    queryFn: () => fetchReflections(100),
  });

  const reflections = (data?.reflections ?? []).filter(
    (reflection) => filter === 'all' || reflection.category === filter
  );

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        {FILTERS.map((option) => {
          const active = filter === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setFilter(option.value)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <FlatList
        data={reflections}
        keyExtractor={(reflection) => reflection.id}
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        renderItem={({ item: reflection }) => (
          <Card style={styles.card}>
            <View style={styles.headerRow}>
              <StampBadge
                label={reflection.category === 'auto' ? '自動' : '手動'}
                color={reflection.category === 'auto' ? COLORS.indigo : COLORS.ok}
                filled
              />
              <Text style={styles.date}>{reflection.occurredAt ?? '日付不明'}</Text>
            </View>
            <Text style={styles.itemName}>
              {reflection.itemNameRaw
                ? `${reflection.itemNameRaw} → ${reflection.matchedItemName}`
                : reflection.matchedItemName}
            </Text>
            <Text style={styles.qty}>
              {reflection.qty}
              {reflection.unit ?? ''} を登録
            </Text>
          </Card>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {isLoading
              ? '読み込み中…'
              : data?.reflections.length
                ? '該当する反映記録はありません'
                : 'まだ反映記録がありません'}
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
    gap: SPACING.sm,
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
  qty: { fontFamily: FONTS.medium, fontSize: 13, color: COLORS.inkSub, marginTop: SPACING.xs },
  empty: {
    fontFamily: FONTS.medium,
    textAlign: 'center',
    color: COLORS.inkFaint,
    marginTop: SPACING.xxl,
  },
});
