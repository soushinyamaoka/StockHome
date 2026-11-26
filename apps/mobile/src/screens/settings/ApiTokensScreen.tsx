import React, { useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createApiToken, fetchApiTokens, revokeApiToken, updateApiToken, type ApiTokenDto } from '../../api/apiTokens';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Section } from '../../components/Section';
import { StampBadge } from '../../components/StampBadge';
import { TextPromptModal } from '../../components/TextPromptModal';
import { useAuth } from '../../hooks/useAuth';
import { COLORS, FONTS, RADIUS, SPACING } from '../../theme';

function formatLastUsed(lastUsedAt: string | null): string {
  if (!lastUsedAt) return 'まだ使われていません';
  return `最後に使われた日時 ${new Date(lastUsedAt).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

// 外部連携（Museなど）。トークンは1人1つずつ本人が発行し、管理者は家族全員の分を見て切り替え・取り消しができる
export default function ApiTokensScreen() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['apiTokens'], queryFn: fetchApiTokens });
  const [naming, setNaming] = useState(false);
  // 発行直後に1回だけ表示するトークン本体
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['apiTokens'] });
  const onError = (fallback: string) => (e: any) => Alert.alert('エラー', e?.response?.data?.message ?? fallback);

  const createMutation = useMutation({
    mutationFn: (name: string) => createApiToken({ name }),
    onSuccess: (result) => {
      invalidate();
      setNaming(false);
      setIssued({ name: result.apiToken.name, token: result.token });
    },
    onError: onError('発行できませんでした'),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, allowWrite }: { id: string; allowWrite: boolean }) => updateApiToken(id, { allowWrite }),
    onSuccess: invalidate,
    onError: onError('切り替えられませんでした'),
  });
  const revokeMutation = useMutation({
    mutationFn: revokeApiToken,
    onSuccess: invalidate,
    onError: onError('取り消せませんでした'),
  });

  const toggleWrite = (t: ApiTokenDto) => {
    if (t.allowWrite) {
      updateMutation.mutate({ id: t.id, allowWrite: false });
      return;
    }
    Alert.alert(
      '書き込みを許可',
      `「${t.name}」から、消耗品・購入記録・置き場所などを登録・変更できるようになります。よろしいですか？`,
      [
        { text: 'やめる', style: 'cancel' },
        { text: '許可する', onPress: () => updateMutation.mutate({ id: t.id, allowWrite: true }) },
      ]
    );
  };

  const confirmRevoke = (t: ApiTokenDto) => {
    Alert.alert('取り消し', `「${t.name}」のトークンを取り消しますか？取り消すとすぐに使えなくなり、元に戻せません。`, [
      { text: 'やめる', style: 'cancel' },
      { text: '取り消す', style: 'destructive', onPress: () => revokeMutation.mutate(t.id) },
    ]);
  };

  const copyIssued = async () => {
    if (!issued) return;
    await Clipboard.setStringAsync(issued.token);
    Alert.alert('コピーしました', '連携先の入力画面に貼り付けてください。');
  };

  const closeIssued = () => {
    Alert.alert('閉じる', 'このトークンは二度と表示できません。連携先に貼り付けましたか？', [
      { text: 'まだ', style: 'cancel' },
      { text: '閉じる', onPress: () => setIssued(null) },
    ]);
  };

  const tokens = data?.tokens ?? [];
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl }}>
      <Text style={styles.intro}>
        Museなど、アプリ以外のサービスからStockHomeを使うための鍵です。期限はなく、取り消すまで使えます。
        はじめは読み取りだけで、書き込みはトークンごとに許可できます。
      </Text>

      <Section title={isAdmin ? '家族のトークン' : 'あなたのトークン'} count={tokens.length}>
        {tokens.map((t) => (
          <Card key={t.id} style={styles.tokenCard}>
            <View style={styles.nameRow}>
              <Text style={styles.tokenName}>{t.name}</Text>
              <StampBadge label={t.isMine ? 'あなた' : t.owner.name} color={t.isMine ? COLORS.indigo : COLORS.inkSub} />
            </View>
            <Text style={styles.sub}>{t.tokenPrefix}…</Text>
            <Text style={styles.sub}>{formatLastUsed(t.lastUsedAt)}</Text>
            <View style={styles.actions}>
              <View style={styles.tool}>
                <Text style={styles.toolText}>{t.allowWrite ? '書き込みも可' : '読み取りだけ'}</Text>
                <Switch
                  value={t.allowWrite}
                  onValueChange={() => toggleWrite(t)}
                  disabled={updateMutation.isPending}
                  trackColor={{ true: COLORS.warnSoft, false: COLORS.paperDeep }}
                  thumbColor={t.allowWrite ? COLORS.warn : COLORS.inkFaint}
                  style={styles.switch}
                />
              </View>
              <TouchableOpacity style={styles.tool} onPress={() => confirmRevoke(t)}>
                <Ionicons name="close-circle-outline" size={15} color={COLORS.accentDeep} />
                <Text style={[styles.toolText, { color: COLORS.accentDeep }]}>取り消す</Text>
              </TouchableOpacity>
            </View>
          </Card>
        ))}
        {isLoading ? <Text style={styles.muted}>読み込み中…</Text> : null}
        {!isLoading && tokens.length === 0 ? <Text style={styles.muted}>まだトークンはありません。</Text> : null}
      </Section>

      <Button
        title="トークンを発行する"
        variant="outline"
        icon={<Ionicons name="key-outline" size={16} color={COLORS.ink} />}
        onPress={() => setNaming(true)}
      />
      <Text style={styles.note}>発行したトークンは、あなたとして動きます。家族の分は、それぞれのアプリから発行してください。</Text>

      <TextPromptModal
        visible={naming}
        title="連携先の名前"
        placeholder="例: Muse"
        submitLabel="発行する"
        loading={createMutation.isPending}
        onSubmit={(name) => createMutation.mutate(name)}
        onCancel={() => setNaming(false)}
      />

      <Modal visible={!!issued} transparent animationType="fade" onRequestClose={closeIssued}>
        <View style={styles.backdrop}>
          <View style={styles.issuedCard}>
            <Text style={styles.issuedTitle}>「{issued?.name}」のトークン</Text>
            <Text style={styles.issuedNote}>
              この画面を閉じると二度と表示できません。コピーして連携先の入力画面に貼り付けてください。チャットやメモには貼らないでください。
            </Text>
            <Text style={styles.tokenText} selectable>
              {issued?.token}
            </Text>
            <Button
              title="コピーする"
              icon={<Ionicons name="copy-outline" size={16} color="#FFFDF6" />}
              onPress={copyIssued}
            />
            <View style={{ height: SPACING.sm }} />
            <Button title="閉じる" variant="outline" small onPress={closeIssued} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
  intro: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.inkSub, lineHeight: 20, marginBottom: SPACING.lg },
  tokenCard: { marginBottom: SPACING.sm },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm },
  tokenName: { flex: 1, fontFamily: FONTS.bold, fontSize: 15, color: COLORS.ink },
  sub: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkSub, marginTop: 2 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.md,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    borderStyle: 'dashed',
  },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  toolText: { fontFamily: FONTS.medium, fontSize: 12, color: COLORS.inkSub },
  switch: { transform: [{ scale: 0.8 }] },
  muted: { fontFamily: FONTS.medium, color: COLORS.inkFaint },
  note: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkSub, lineHeight: 19, marginTop: SPACING.md },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  issuedCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg },
  issuedTitle: { fontFamily: FONTS.bold, fontSize: 15, color: COLORS.ink, marginBottom: SPACING.sm },
  issuedNote: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.warn, lineHeight: 19, marginBottom: SPACING.md },
  tokenText: {
    fontFamily: FONTS.medium,
    fontSize: 13,
    color: COLORS.ink,
    backgroundColor: COLORS.paperDeep,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
});
