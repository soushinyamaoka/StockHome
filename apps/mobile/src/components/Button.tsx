import React, { useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, FONTS, RADIUS, SPACING } from '../theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** primary: 朱色の主ボタン / secondary: 紙面 / danger: 朱の縁取り / outline: 墨の縁取り */
  variant?: 'primary' | 'secondary' | 'danger' | 'outline';
  icon?: React.ReactNode;
  /** 小さめ（カード内のアクション用） */
  small?: boolean;
}

// 活版印刷のような「縁取り＋下にずれた台座」のボタン。
// 押すと沈み込む（台座に届く）ことで紙の道具らしい手応えを出す。
export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  loading,
  disabled,
  variant = 'primary',
  icon,
  small,
}) => {
  const pressAnim = useRef(new Animated.Value(0)).current;

  const palette = {
    primary: { bg: COLORS.accent, fg: '#FFFDF6', border: COLORS.borderInk },
    danger: { bg: COLORS.surface, fg: COLORS.accentDeep, border: COLORS.accentDeep },
    secondary: { bg: COLORS.surfaceWarm, fg: COLORS.ink, border: COLORS.border },
    outline: { bg: COLORS.surface, fg: COLORS.ink, border: COLORS.borderInk },
  }[variant];

  const animate = (to: number) =>
    Animated.timing(pressAnim, { toValue: to, duration: 80, useNativeDriver: true }).start();

  const translateY = pressAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 2] });

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      onPressIn={() => animate(1)}
      onPressOut={() => animate(0)}
    >
      <View style={small ? styles.baseSmall : styles.base}>
        <Animated.View
          style={[
            styles.button,
            small && styles.buttonSmall,
            {
              backgroundColor: palette.bg,
              borderColor: palette.border,
              transform: [{ translateY }],
            },
            (disabled || loading) && { opacity: 0.5 },
          ]}
        >
          {loading ? (
            <ActivityIndicator color={palette.fg} />
          ) : (
            <View style={styles.row}>
              {icon ? <View style={{ marginRight: SPACING.sm }}>{icon}</View> : null}
              <Text style={[styles.label, small && styles.labelSmall, { color: palette.fg }]}>
                {title}
              </Text>
            </View>
          )}
        </Animated.View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  // ボタンの下に覗く「台座」
  base: {
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.borderInk,
    paddingBottom: 3,
  },
  baseSmall: {
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.borderInk,
    paddingBottom: 2,
  },
  button: {
    borderRadius: RADIUS.pill,
    borderWidth: 1.5,
    paddingVertical: SPACING.md + 2,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: FONTS.bold, fontSize: 15, letterSpacing: 0.5 },
  labelSmall: { fontSize: 13 },
});
