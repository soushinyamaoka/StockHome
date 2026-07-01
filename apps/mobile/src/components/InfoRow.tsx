import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS, FONTS, SPACING } from '../theme';

interface Props {
  label: string;
  value?: string | number | null;
}

// 手帳の記入欄のような、点線区切りの行
export const InfoRow: React.FC<Props> = ({ label, value }) => {
  const display = value === null || value === undefined || value === '' ? '—' : String(value);
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={3}>
        {display}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingVertical: SPACING.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    borderStyle: 'dashed',
  },
  label: {
    width: 110,
    fontFamily: FONTS.medium,
    color: COLORS.inkSub,
    fontSize: 13,
    paddingTop: 2,
  },
  value: { flex: 1, fontFamily: FONTS.medium, color: COLORS.ink, fontSize: 14 },
});
