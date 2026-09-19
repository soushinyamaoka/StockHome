import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { COLORS, FONTS, RADIUS, SPACING } from '../theme';

interface ErrorStateProps {
  onRetry: () => void;
}

export function ErrorState({ onRetry }: ErrorStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>読み込めませんでした</Text>
      <TouchableOpacity style={styles.retryButton} onPress={onRetry} activeOpacity={0.75}>
        <Text style={styles.retryText}>再試行</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    backgroundColor: COLORS.warnSoft,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.warn,
    borderStyle: 'dashed',
  },
  message: { fontFamily: FONTS.bold, fontSize: 14, color: COLORS.warn },
  retryButton: {
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.warn,
  },
  retryText: { fontFamily: FONTS.bold, fontSize: 13, color: COLORS.surface },
});
