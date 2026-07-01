import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS, FONTS, SPACING } from '../theme';

interface Props {
  text: string;
  /** テープの色 */
  tape?: string;
}

// マスキングテープで貼られた付箋メモ。品目のメモ・家族への伝言に使う
export const TapeMemo: React.FC<Props> = ({ text, tape = COLORS.tapeYellow }) => (
  <View style={styles.wrap}>
    <View style={[styles.tape, { backgroundColor: tape }]} />
    <View style={styles.paper}>
      <Text style={styles.text}>{text}</Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  wrap: { marginTop: SPACING.md, alignItems: 'stretch' },
  tape: {
    position: 'absolute',
    top: -5,
    alignSelf: 'center',
    width: 64,
    height: 14,
    borderRadius: 2,
    transform: [{ rotate: '-3deg' }],
    zIndex: 1,
  },
  paper: {
    backgroundColor: '#FDF6DC',
    borderWidth: 1,
    borderColor: '#EADFB8',
    borderRadius: 4,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    transform: [{ rotate: '-0.4deg' }],
  },
  text: { fontFamily: FONTS.medium, fontSize: 12.5, color: COLORS.ink, lineHeight: 19 },
});
