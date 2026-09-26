import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { MaintenanceStatus, Notice } from '../api/notices';
import { useNotices } from '../hooks/useNoticesFeed';
import { COLORS, FONTS, RADIUS, SPACING } from '../theme';

export const MAINTENANCE_LABELS: Record<MaintenanceStatus, string> = {
  scheduled: 'メンテナンス予定', in_progress: 'メンテナンス中', extended: 'メンテナンス延長中',
  completed: 'メンテナンス完了', cancelled: 'メンテナンス中止',
};
export function formatNoticeDate(value: string): string {
  return new Date(value).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function maintenanceLabel(notice: Notice, stale: boolean) {
  const label = MAINTENANCE_LABELS[notice.maintenance!.status];
  return stale && ['scheduled', 'in_progress', 'extended'].includes(notice.maintenance!.status) ? `${label}（最終取得時点）` : label;
}
export function NoticeBanner() {
  const { status, maintenanceBanners, isStale, lastSuccessAt } = useNotices();
  if (status !== 'ready' || maintenanceBanners.length === 0) return null;
  return <View style={styles.container}>{maintenanceBanners.map((notice) => <View key={notice.notice_id} style={styles.item}>
    <Text style={styles.label}>{maintenanceLabel(notice, isStale)}</Text>
    <Text style={styles.title}>{notice.title_ja}</Text><Text style={styles.text}>{notice.message_ja}</Text>
    {notice.maintenance?.expected_end_at ? <Text style={styles.text}>終了予定: {formatNoticeDate(notice.maintenance.expected_end_at)}</Text> : null}
    {notice.maintenance?.status === 'scheduled' && notice.maintenance.starts_at ? <Text style={styles.text}>開始予定: {formatNoticeDate(notice.maintenance.starts_at)}</Text> : null}
    {isStale ? <Text style={styles.text}>お知らせを更新できていません（最終取得: {lastSuccessAt ? formatNoticeDate(lastSuccessAt.toISOString()) : '不明'}）。表示中の状態は最新でない可能性があります</Text> : null}
  </View>)}</View>;
}
const styles = StyleSheet.create({ container: { backgroundColor: COLORS.warnSoft, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.warn, padding: SPACING.md, marginBottom: SPACING.xl }, item: { gap: SPACING.xs }, label: { fontFamily: FONTS.bold, fontSize: 13, color: COLORS.warn }, title: { fontFamily: FONTS.bold, fontSize: 15, color: COLORS.ink }, text: { fontFamily: FONTS.body, fontSize: 13, lineHeight: 19, color: COLORS.inkSub } });
