import React from 'react';
import { FlatList, RefreshControl, StyleSheet, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  NOTIFICATION_REASON_LABELS,
  type NotificationReason,
} from '@stockhome/shared';

import { fetchNotifications } from '../../api/misc';
import { Card } from '../../components/Card';
import { COLORS, FONTS, RADIUS, SPACING } from '../../theme';

export default function NotificationLogScreen() {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => fetchNotifications(100),
  });

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl }}
      data={data?.notifications ?? []}
      keyExtractor={(n) => n.id}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      renderItem={({ item: n }) => (
        <Card style={styles.card}>
          <Text style={styles.date}>
            {new Date(n.createdAt).toLocaleString('ja-JP', {
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {'　'}
            <Text style={styles.reason}>
              {NOTIFICATION_REASON_LABELS[n.notificationReason as NotificationReason] ??
                n.notificationReason}
            </Text>
          </Text>
          <Text style={styles.message}>{n.message}</Text>
        </Card>
      )}
      ListEmptyComponent={
        <Text style={styles.empty}>
          {isLoading ? '読み込み中...' : '通知履歴はまだありません'}
        </Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
  card: { borderRadius: RADIUS.md, paddingVertical: SPACING.md },
  date: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkFaint },
  reason: { fontFamily: FONTS.bold, color: COLORS.warn },
  message: { fontFamily: FONTS.medium, fontSize: 14, color: COLORS.ink, marginTop: SPACING.xs },
  empty: { fontFamily: FONTS.medium, textAlign: 'center', color: COLORS.inkFaint, marginTop: SPACING.xxl },
});
