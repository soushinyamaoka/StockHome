import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNotices } from '../hooks/useNoticesFeed';
import { selectHomeUnreadNotices } from '../lib/noticesLogic';
import { COLORS, FONTS, RADIUS, SPACING } from '../theme';

export function NoticeUnreadCard({ onPress }: { onPress: () => void }) {
  const { status, visibleNotices, maintenanceBanners, readIds } = useNotices();
  const notices = selectHomeUnreadNotices(visibleNotices, maintenanceBanners, readIds);
  if (status !== 'ready' || notices.length === 0) return null;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.75}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`運営からのお知らせ 未読${notices.length}件`}
    >
      <Ionicons name="megaphone-outline" size={20} color={COLORS.indigo} />
      <View style={styles.content}>
        <View style={styles.heading}>
          <Text style={styles.label}>運営からのお知らせ</Text>
          <Text style={styles.count}>未読 {notices.length}件</Text>
        </View>
        <Text style={styles.title} numberOfLines={1}>{notices[0].title_ja}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={COLORS.indigo} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.indigoSoft,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.indigo,
    padding: SPACING.md,
    marginBottom: SPACING.xl,
  },
  content: { flex: 1, gap: SPACING.xs },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.xs },
  label: { flex: 1, fontFamily: FONTS.bold, fontSize: 14, color: COLORS.indigo },
  count: { fontFamily: FONTS.bold, fontSize: 12, color: COLORS.indigo },
  title: { fontFamily: FONTS.medium, fontSize: 13, color: COLORS.inkSub },
});
