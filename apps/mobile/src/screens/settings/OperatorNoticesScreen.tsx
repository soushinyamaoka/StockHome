import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from '../../components/Card';
import { formatNoticeDate, MAINTENANCE_LABELS } from '../../components/NoticeBanner';
import { useNotices } from '../../hooks/useNoticesFeed';
import type { Notice } from '../../api/notices';
import { COLORS, FONTS, SPACING } from '../../theme';

export default function OperatorNoticesScreen() {
  const { status, visibleNotices, isStale, lastSuccessAt, markRead, readIds } = useNotices();
  const [unreadAtFocus, setUnreadAtFocus] = useState<ReadonlySet<string>>(new Set());
  const visibleRef = useRef(visibleNotices); visibleRef.current = visibleNotices;
  const readRef = useRef(readIds); readRef.current = readIds;
  useFocusEffect(useCallback(() => {
    const current = visibleRef.current;
    const unread = new Set(current.filter((n) => !readRef.current.has(n.notice_id)).map((n) => n.notice_id));
    setUnreadAtFocus(unread);
    markRead(current.map((n) => n.notice_id));
  }, [markRead]));
  const ordered = [...visibleNotices].sort((a, b) => Number(unreadAtFocus.has(b.notice_id)) - Number(unreadAtFocus.has(a.notice_id)) || Date.parse(b.visible_from) - Date.parse(a.visible_from));
  const label = (notice: Notice) => notice.kind === 'feature' ? 'お知らせ' : MAINTENANCE_LABELS[notice.maintenance!.status];
  return <ScrollView style={styles.container} contentContainerStyle={styles.content}>
    {status === 'loading' ? <Text style={styles.muted}>読み込み中…</Text> : status === 'unavailable' ? <Text style={styles.muted}>お知らせを取得できませんでした。通信環境を確認して、しばらくしてから開き直してください</Text> : <>
      {isStale ? <Text style={styles.stale}>お知らせを更新できていません（最終取得: {lastSuccessAt ? formatNoticeDate(lastSuccessAt.toISOString()) : '不明'}）。表示中の内容は最新でない可能性があります</Text> : null}
      {ordered.length === 0 ? <Text style={styles.muted}>お知らせはありません</Text> : ordered.map((notice) => <Card key={notice.notice_id} style={[styles.card, unreadAtFocus.has(notice.notice_id) && styles.unread]}>
        <Text style={styles.kind}>{label(notice)}</Text><Text style={styles.title}>{notice.title_ja}</Text><Text style={styles.body}>{notice.message_ja}</Text>
        {notice.action_ja ? <Text style={styles.body}>{notice.action_ja}</Text> : null}
        {notice.maintenance ? <View style={styles.details}>
          {notice.maintenance.starts_at ? <Text style={styles.detail}>開始予定: {formatNoticeDate(notice.maintenance.starts_at)}</Text> : null}
          {notice.maintenance.expected_end_at ? <Text style={styles.detail}>終了予定: {formatNoticeDate(notice.maintenance.expected_end_at)}</Text> : null}
          {notice.maintenance.next_update_at ? <Text style={styles.detail}>次回更新予定: {formatNoticeDate(notice.maintenance.next_update_at)}</Text> : null}
          {notice.maintenance.affected_features_ja ? <Text style={styles.detail}>影響する機能: {notice.maintenance.affected_features_ja.join('、')}</Text> : null}
          {notice.maintenance.data_loss_expected === true ? <Text style={styles.detail}>データが失われる可能性があります</Text> : null}
        </View> : null}
      </Card>)}
    </>}
  </ScrollView>;
}
const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: COLORS.paper }, content: { padding: SPACING.lg, gap: SPACING.md }, card: { borderLeftWidth: 5, borderLeftColor: 'transparent' }, unread: { borderLeftColor: COLORS.accent }, kind: { fontFamily: FONTS.bold, fontSize: 12, color: COLORS.indigo, marginBottom: SPACING.xs }, title: { fontFamily: FONTS.bold, fontSize: 16, color: COLORS.ink }, body: { fontFamily: FONTS.body, fontSize: 14, lineHeight: 21, color: COLORS.inkSub, marginTop: SPACING.xs }, details: { marginTop: SPACING.sm, gap: SPACING.xs }, detail: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkFaint }, muted: { fontFamily: FONTS.medium, color: COLORS.inkFaint }, stale: { fontFamily: FONTS.medium, color: COLORS.warn, lineHeight: 20 } });
