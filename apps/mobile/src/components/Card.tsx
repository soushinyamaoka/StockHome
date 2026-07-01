import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { COLORS, RADIUS, SHADOW, SPACING } from '../theme';

// 紙のカード。温かい縁取り＋柔らかい影
export const Card: React.FC<ViewProps> = ({ style, children, ...rest }) => (
  <View {...rest} style={[styles.card, style]}>
    {children}
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    ...SHADOW.card,
  },
});
