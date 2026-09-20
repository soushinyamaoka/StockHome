import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { COLORS, FONTS, RADIUS, SPACING } from '../theme';

interface BatchStatusBannerProps {
  lastBatchRun: {
    status: 'success' | 'failure';
    ranAt: string;
    ageHours: number;
  } | null;
}

function formatJstTime(ranAt: string): string {
  return new Date(ranAt).toLocaleTimeString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

export function BatchStatusBanner({ lastBatchRun }: BatchStatusBannerProps) {
  if (!lastBatchRun) return null;

  const isFailure = lastBatchRun.status === 'failure';
  const isStale = lastBatchRun.status === 'success' && lastBatchRun.ageHours > 26;
  if (!isFailure && !isStale) return null;

  const time = formatJstTime(lastBatchRun.ranAt);
  const message = isFailure
    ? `夜間バッチが失敗しました（${time}実行）`
    : `バッチの実行が確認できません（前回${time}）`;

  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.warnSoft,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.warn,
    padding: SPACING.md,
    marginBottom: SPACING.xl,
  },
  message: { fontFamily: FONTS.bold, fontSize: 14, color: COLORS.warn },
});
