import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS, FONTS, SPACING } from '../theme';

interface Props {
  label: string;
  /** スタンプの色（縁と文字）。既定は墨 */
  color?: string;
  /** 塗りつぶし版（強い警告など） */
  filled?: boolean;
  /** わずかに傾けてハンコらしさを出す */
  tilt?: boolean;
}

// ゴム印風のバッジ。「在庫不明」「発送済」などの状態表示に使う
export const StampBadge: React.FC<Props> = ({ label, color = COLORS.borderInk, filled, tilt }) => (
  <View
    style={[
      styles.badge,
      { borderColor: color },
      filled && { backgroundColor: color },
      tilt && { transform: [{ rotate: '-2.5deg' }] },
    ]}
  >
    <Text style={[styles.text, { color: filled ? COLORS.surface : color }]}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1.5,
    borderRadius: 6,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 1,
    alignSelf: 'flex-start',
  },
  text: { fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 1 },
});
