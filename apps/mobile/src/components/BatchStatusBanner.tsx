import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { resolveBatchStatusMessage, type LastBatchRun } from '../lib/batchStatus';
import { COLORS, FONTS, RADIUS, SPACING } from '../theme';

interface BatchStatusBannerProps {
  lastBatchRun: LastBatchRun | null;
}

export function BatchStatusBanner({ lastBatchRun }: BatchStatusBannerProps) {
  const message = resolveBatchStatusMessage(lastBatchRun);
  if (!message) return null;

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
