import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS, FONTS, SPACING } from '../theme';
import type { SnapshotDto } from '../api/types';

interface Props {
  snapshot: SnapshotDto | null;
  /** 在庫不明品目（カウンター無効表示） */
  unknown?: boolean;
  /** 大きさ: hero=在庫カードの主役 / compact=一覧の脇役 */
  size?: 'hero' | 'compact';
}

// 残り日数の「日めくり」カウンター。この画面の主役。
// 数字は Fraunces（表情のあるセリフ）で大きく、状態で色が変わる:
//   朱=切迫 / からし=注意 / 墨=じゅうぶん
export const DaysCounter: React.FC<Props> = ({ snapshot, unknown, size = 'hero' }) => {
  const hero = size === 'hero';
  const days = snapshot?.estimatedDaysLeft;

  if (unknown || days == null) {
    return (
      <View style={[styles.box, hero ? styles.boxHero : styles.boxCompact, styles.boxUnknown]}>
        <Text style={[styles.unknownText, { fontSize: hero ? 14 : 11 }]}>在庫{'\n'}不明</Text>
      </View>
    );
  }

  const rounded = Math.round(days);
  const color =
    snapshot!.alertNeeded ? COLORS.accent : rounded <= 14 ? COLORS.warn : COLORS.ink;

  return (
    <View style={[styles.box, hero ? styles.boxHero : styles.boxCompact, { borderColor: color }]}>
      <Text style={styles.caption}>あと</Text>
      <View style={styles.numRow}>
        <Text
          style={[styles.num, { color, fontSize: hero ? (rounded >= 100 ? 30 : 38) : 22 }]}
          numberOfLines={1}
        >
          {rounded}
        </Text>
        <Text style={[styles.unit, { color, fontSize: hero ? 14 : 11 }]}>日</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    borderWidth: 2,
    borderColor: COLORS.borderInk,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxHero: {
    width: 76,
    height: 76,
    borderRadius: 18,
  },
  boxCompact: {
    width: 52,
    height: 52,
    borderRadius: 13,
  },
  boxUnknown: {
    borderStyle: 'dashed',
    borderColor: COLORS.inkFaint,
    backgroundColor: COLORS.surfaceWarm,
  },
  caption: {
    fontFamily: FONTS.medium,
    fontSize: 10,
    color: COLORS.inkFaint,
    marginBottom: -4,
    marginTop: 2,
  },
  numRow: { flexDirection: 'row', alignItems: 'baseline' },
  num: { fontFamily: FONTS.display, letterSpacing: -1 },
  unit: { fontFamily: FONTS.bold, marginLeft: 1 },
  unknownText: {
    fontFamily: FONTS.bold,
    color: COLORS.inkFaint,
    textAlign: 'center',
    lineHeight: 16,
  },
});
