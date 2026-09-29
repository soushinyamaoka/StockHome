import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS, FONTS, RADIUS, SPACING } from '../theme';
import { formatCachedAt } from '../lib/offlineNotice';

interface OfflineNoticeProps {
  updatedAt: number;
  onRetry: () => void;
}

export function OfflineNotice({ updatedAt, onRetry }: OfflineNoticeProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>通信できないため、{formatCachedAt(updatedAt)} 時点の内容を表示しています</Text>
      <TouchableOpacity style={styles.retryButton} onPress={onRetry} activeOpacity={0.75}>
        <Text style={styles.retryText}>再試行</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    marginBottom: SPACING.md, padding: SPACING.md,
    backgroundColor: COLORS.warnSoft, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.warn,
  },
  message: { flex: 1, fontFamily: FONTS.medium, fontSize: 12, color: COLORS.warn },
  retryButton: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill, backgroundColor: COLORS.warn },
  retryText: { fontFamily: FONTS.bold, fontSize: 12, color: COLORS.surface },
});
