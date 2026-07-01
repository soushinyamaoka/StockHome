import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS, FONTS, RADIUS, SPACING } from '../theme';

export interface ChipOption {
  value: string;
  label: string;
}

interface Props {
  label?: string;
  options: ChipOption[];
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  allowClear?: boolean;
}

// ハンコを押すように選ぶチップ。選択中は朱の淡い面＋墨の縁取り
export const ChipSelector: React.FC<Props> = ({
  label,
  options,
  value,
  onChange,
  allowClear,
}) => {
  const chip = (key: string, text: string, active: boolean, onPress: () => void) => (
    <TouchableOpacity
      key={key}
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{text}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {/* 横スクロールではなく折返しで全選択肢を表示する */}
      <View style={styles.chipWrap}>
        {allowClear && chip('__all__', 'すべて', !value, () => onChange(null))}
        {options.map((opt) =>
          chip(opt.value, opt.label, value === opt.value, () => onChange(opt.value))
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginBottom: SPACING.md },
  label: {
    fontFamily: FONTS.bold,
    fontSize: 13,
    color: COLORS.inkSub,
    marginBottom: SPACING.xs,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    borderColor: COLORS.border,
    borderWidth: 1.5,
    backgroundColor: COLORS.surface,
    marginRight: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  chipActive: { backgroundColor: COLORS.accentSoft, borderColor: COLORS.accentDeep },
  chipText: { fontFamily: FONTS.medium, color: COLORS.inkSub, fontSize: 13 },
  chipTextActive: { fontFamily: FONTS.bold, color: COLORS.accentDeep },
});
