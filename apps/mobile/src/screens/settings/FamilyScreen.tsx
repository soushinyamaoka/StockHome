import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { USER_ROLES } from '@stockhome/shared';

import { createFamilyMember, fetchUsers, updateFamilyMember } from '../../api/misc';
import type { FamilyUser } from '../../api/types';
import { Card } from '../../components/Card';
import { Section } from '../../components/Section';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { ChipSelector } from '../../components/ChipSelector';
import { StampBadge } from '../../components/StampBadge';
import { useAuth } from '../../hooks/useAuth';
import { COLORS, FONTS, RADIUS, SPACING } from '../../theme';

const ROLE_LABEL: Record<string, string> = { admin: '管理者', member: 'メンバー' };

export default function FamilyScreen() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: fetchUsers });

  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<string | null>('member');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const createMutation = useMutation({
    mutationFn: createFamilyMember,
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      setEmail('');
      setName('');
      setPassword('');
      setRole('member');
      Alert.alert('追加完了', '家族メンバーを追加しました');
    },
    onError: (e: any) =>
      Alert.alert('エラー', e?.response?.data?.message ?? '追加に失敗しました'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; role?: string; isActive?: boolean }) =>
      updateFamilyMember(id, input),
    onSuccess: invalidate,
    onError: (e: any) =>
      Alert.alert('エラー', e?.response?.data?.message ?? '更新に失敗しました'),
  });

  const submit = () => {
    if (!email.trim() || !name.trim() || password.length < 8) {
      Alert.alert('入力エラー', 'メール・名前・8文字以上のパスワードを入力してください');
      return;
    }
    createMutation.mutate({
      email: email.trim(),
      name: name.trim(),
      password,
      role: role ?? 'member',
    });
  };

  const toggleRole = (m: FamilyUser) => {
    const next = m.role === 'admin' ? 'member' : 'admin';
    Alert.alert('ロール変更', `${m.name} を「${ROLE_LABEL[next]}」にしますか？`, [
      { text: 'やめる', style: 'cancel' },
      { text: '変更', onPress: () => updateMutation.mutate({ id: m.id, role: next }) },
    ]);
  };

  const toggleActive = (m: FamilyUser) => {
    updateMutation.mutate({ id: m.id, isActive: !m.isActive });
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={{ padding: SPACING.lg }}>
        <Section title="家族メンバー">
          {(data?.users ?? []).map((m) => {
            const isSelf = m.id === user?.id;
            return (
              <Card key={m.id} style={[styles.memberCard, !m.isActive && { opacity: 0.6 }]}>
                <View style={styles.memberRow}>
                  <View style={[styles.avatar, !m.isActive && { backgroundColor: COLORS.inkFaint }]}>
                    <Text style={styles.avatarText}>{m.name.slice(0, 1)}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: SPACING.md }}>
                    <View style={styles.nameRow}>
                      <Text style={styles.memberName}>{m.name}</Text>
                      {isSelf ? <StampBadge label="あなた" color={COLORS.indigo} /> : null}
                    </View>
                    <Text style={styles.memberEmail}>{m.email}</Text>
                  </View>
                  <StampBadge
                    label={ROLE_LABEL[m.role] ?? m.role}
                    color={m.role === 'admin' ? COLORS.accentDeep : COLORS.inkSub}
                    tilt
                  />
                </View>

                {isAdmin && !isSelf ? (
                  <View style={styles.memberActions}>
                    <TouchableOpacity style={styles.tool} onPress={() => toggleRole(m)}>
                      <Ionicons name="swap-horizontal" size={15} color={COLORS.inkSub} />
                      <Text style={styles.toolText}>
                        {m.role === 'admin' ? 'メンバーにする' : '管理者にする'}
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.tool}>
                      <Text style={styles.toolText}>{m.isActive ? '有効' : '無効'}</Text>
                      <Switch
                        value={m.isActive}
                        onValueChange={() => toggleActive(m)}
                        trackColor={{ true: COLORS.okSoft, false: COLORS.paperDeep }}
                        thumbColor={m.isActive ? COLORS.ok : COLORS.inkFaint}
                        style={styles.switch}
                      />
                    </View>
                  </View>
                ) : null}
              </Card>
            );
          })}
          {isLoading ? <Text style={styles.muted}>読み込み中…</Text> : null}
        </Section>

        {isAdmin ? (
          showForm ? (
            <Section title="新しい家族を追加">
              <TextField
                label="メールアドレス"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="family@example.com"
              />
              <TextField label="名前" value={name} onChangeText={setName} placeholder="例: たろう" />
              <TextField
                label="初期パスワード（8文字以上）"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                helper="本人がログイン後に「パスワード変更」で変えられます"
              />
              <ChipSelector
                label="ロール"
                options={USER_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                value={role}
                onChange={setRole}
              />
              <Button title="この家族を追加する" onPress={submit} loading={createMutation.isPending} />
              <View style={{ height: SPACING.sm }} />
              <Button title="やめる" variant="secondary" small onPress={() => setShowForm(false)} />
            </Section>
          ) : (
            <Button
              title="家族を追加する"
              variant="outline"
              icon={<Ionicons name="person-add-outline" size={16} color={COLORS.ink} />}
              onPress={() => setShowForm(true)}
            />
          )
        ) : (
          <Text style={styles.note}>家族の追加・編集は管理者のみが行えます。</Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
  memberCard: { marginBottom: SPACING.sm },
  memberRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.accent,
    borderWidth: 1.5,
    borderColor: COLORS.borderInk,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-4deg' }],
  },
  avatarText: { fontFamily: FONTS.black, fontSize: 18, color: '#FFFDF6' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  memberName: { fontFamily: FONTS.bold, fontSize: 15, color: COLORS.ink },
  memberEmail: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkSub, marginTop: 1 },
  memberActions: {
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
  note: { fontFamily: FONTS.medium, fontSize: 13, color: COLORS.inkSub, textAlign: 'center', marginTop: SPACING.lg },
});
