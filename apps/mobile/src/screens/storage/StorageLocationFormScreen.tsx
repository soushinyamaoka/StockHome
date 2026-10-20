import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';

import { createStorageLocation, fetchStorageLocations, updateStorageLocation } from '../../api/storage';
import { Button } from '../../components/Button';
import { Section } from '../../components/Section';
import { TextField } from '../../components/TextField';
import type { StorageStackParamList } from '../../navigation/types';
import { apiErrorMessage } from '../../lib/storageEdit';
import { COLORS, FONTS, SPACING } from '../../theme';

// 場所の追加（親を指定。未指定なら最上位）と、名前・メモの変更
export default function StorageLocationFormScreen() {
  const navigation = useNavigation<any>();
  const { params } = useRoute<RouteProp<StorageStackParamList, 'StorageLocationForm'>>();
  const locationId = params?.locationId;
  const parentId = params?.parentId ?? null;
  const isEdit = !!locationId;
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [memo, setMemo] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();

  const { data } = useQuery({ queryKey: ['storage', 'locations'], queryFn: fetchStorageLocations });
  const { current, parentPath } = useMemo(() => {
    const all = data?.locations ?? [];
    const cur = locationId ? all.find((l) => l.id === locationId) : undefined;
    const parent = all.find((l) => l.id === (cur ? cur.parentId : parentId));
    return { current: cur, parentPath: parent?.pathText ?? null };
  }, [data, locationId, parentId]);

  useLayoutEffect(() => {
    navigation.setOptions({ title: isEdit ? '場所の編集' : '場所の追加' });
  }, [navigation, isEdit]);

  useEffect(() => {
    if (current) {
      setName(current.name);
      setMemo(current.memo ?? '');
    }
  }, [current]);

  const save = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        await updateStorageLocation(locationId!, { name: name.trim(), memo: memo.trim() || null });
      } else {
        await createStorageLocation({ name: name.trim(), parentId, memo: memo.trim() || null });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['storage'] });
      navigation.goBack();
    },
    onError: (e) => Alert.alert('保存できませんでした', apiErrorMessage(e, '時間をおいてやり直してください')),
  });

  const submit = () => {
    if (!name.trim()) {
      setNameError('名前を入力してください');
      return;
    }
    setNameError(undefined);
    save.mutate();
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.parent}>{parentPath ? `「${parentPath}」の中` : '最上位（例: 1階・2階・屋外）'}</Text>
        <Section title="場所">
          <TextField label="名前" value={name} onChangeText={setName} placeholder="例: パントリー、A棚、青いケース" error={nameError} />
          <TextField
            label="メモ（任意）"
            value={memo}
            onChangeText={setMemo}
            placeholder="例: 入って左の白い棚（家族が迷わないための説明）"
          />
        </Section>
        <Button title={isEdit ? '保存する' : '追加する'} onPress={submit} loading={save.isPending} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  parent: { fontFamily: FONTS.medium, fontSize: 13, color: COLORS.inkSub, marginBottom: SPACING.md },
});
