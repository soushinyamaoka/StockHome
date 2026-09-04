import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS, FONTS, RADIUS, SPACING } from '../theme';

interface PricePoint {
  purchasedAt: string;
  price: number;
}

interface Props {
  /** purchasedAt 昇順（古い→新しい）、price != null のもののみを渡す */
  points: PricePoint[];
}

const MAX_BARS = 12;
const BAR_MAX_HEIGHT = 40;
const BAR_MIN_HEIGHT = 6;

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

// 価格推移の簡易スパークライン（棒グラフ）。外部チャートライブラリは使わず
// Viewの組み合わせで実装。直近 MAX_BARS 件のみ表示し、最新値を強調する
export function PriceSparkline({ points }: Props) {
  if (points.length < 2) return null;

  const recent = points.slice(-MAX_BARS);
  const prices = recent.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>価格の推移</Text>
        <Text style={styles.subtitle}>直近{recent.length}件</Text>
      </View>
      <View style={styles.barRow}>
        {recent.map((p, i) => {
          const ratio = range > 0 ? (p.price - min) / range : 0.5;
          const height = BAR_MIN_HEIGHT + ratio * (BAR_MAX_HEIGHT - BAR_MIN_HEIGHT);
          const isLatest = i === recent.length - 1;
          return (
            <View key={`${p.purchasedAt}-${i}`} style={styles.barCol}>
              <View style={[styles.bar, { height }, isLatest && styles.barLatest]} />
            </View>
          );
        })}
      </View>
      <View style={styles.rangeRow}>
        <Text style={styles.rangeText}>{yen(min)}</Text>
        <Text style={styles.rangeText}>{yen(max)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: SPACING.md, paddingTop: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border, borderStyle: 'dashed' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.sm },
  title: { fontFamily: FONTS.bold, fontSize: 12, color: COLORS.inkSub },
  subtitle: { fontFamily: FONTS.medium, fontSize: 11, color: COLORS.inkFaint },
  barRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: BAR_MAX_HEIGHT,
    gap: 4,
  },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: BAR_MAX_HEIGHT },
  bar: {
    width: '100%',
    maxWidth: 16,
    backgroundColor: COLORS.indigoSoft,
    borderRadius: RADIUS.sm / 2,
  },
  barLatest: { backgroundColor: COLORS.indigo },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.xs },
  rangeText: { fontFamily: FONTS.medium, fontSize: 10, color: COLORS.inkFaint },
});
