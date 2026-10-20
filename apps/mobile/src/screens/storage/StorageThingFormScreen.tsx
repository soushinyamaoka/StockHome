import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';

import { createStorageThing, fetchStorageLocations, fetchStorageThing, updateStorageThing } from '../../api/storage';
import { Button } from '../../components/Button';
import { LocationPicker } from '../../components/LocationPicker';
import { Section } from '../../components/Section';
import { TagEditor } from '../../components/TagEditor';
import { TextField } from '../../components/TextField';
import type { StorageStackParamList } from '../../navigation/types';
import { apiErrorMessage } from '../../lib/storageEdit';
import { COLORS, FONTS, RADIUS, SPACING } from '../../theme';

// 場所だけ管理する物の登録（名前・メモ・最初の置き場所・用途タグ）と、名前・メモの編集
export default function StorageThingFormScreen() {
  const navigation = useNavigation<any>();
  const { params } = useRoute<RouteProp<StorageStackParamList, 'StorageThingForm'>>();
  const thingId = params?.thingId;
  const isEdit = !!thingId;
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [memo, setMemo] = useState('');
  const [locationId, setLocationId] = useState<string | null>(params?.locationId ?? null);
  const [placementMemo, setPlacementMemo] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>();

  useLayoutEffect(() => {
    navigation.setOptions({ title: isEdit ? '物の編集' : '物の登録' });
  }, [navigation, isEdit]);

  const existing = useQuery({
    queryKey: ['storage', 'target', 'thing', thingId],
    queryFn: async () => (await fetchStorageThing(thingId!)).thing,
    enabled: isEdit,
  });
  useEffect(() => {
    if (existing.data) {
      setName(existing.data.name);
      setMemo(existing.data.memo ?? '');
    }
  }, [existing.data]);

  const locations = useQuery({ queryKey: ['storage', 'locations'], queryFn: fetchStorageLocations, enabled: !isEdit });
  const locationPath = useMemo(
    () => locations.data?.locations.find((l) => l.id === locationId)?.pathText ?? null,
    [locations.data, locationId]
  );

  const save = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        await updateStorageThing(thingId!, { name: name.trim(), memo: memo.trim() || null });
        return thingId!;
      }
      const { thing } = await createStorageThing({
        name: name.trim(),
        memo: memo.trim() || null,
        placements: locationId ? [{ locationId, memo: placementMemo.trim() || null }] : [],
        tags,
      });
      return thing.id;
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['storage'] });
      if (isEdit) navigation.goBack();
      // 登録後は詳細へ（置き場所の追加やタグの調整を続けられるように）
      else navigation.replace('StorageTarget', { kind: 'thing', id });
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
        <Section title="物">
          <TextField label="名前" value={name} onChangeText={setName} placeholder="例: ほうき、スーツケース" error={nameError} />
          <TextField label="メモ（任意）" value={memo} onChangeText={setMemo} placeholder="例: 大小2つ、柄が伸びるタイプ" />
        </Section>

        {!isEdit ? (
          <>
            <Section title="置き場所（任意）">
              <TouchableOpacity style={styles.locationSelector} onPress={() => setPickerOpen(true)} activeOpacity={0.75}>
                <Ionicons name="location-sharp" size={16} color={locationPath ? COLORS.accent : COLORS.inkFaint} />
                <Text style={locationPath ? styles.locationText : styles.locationPlaceholder}>
                  {locationPath ?? '場所を選ぶ'}
                </Text>
                <Ionicons name="chevron-down" size={16} color={COLORS.inkSub} />
              </TouchableOpacity>
              {locationId ? (
                <TextField
                  label="置き方のメモ（任意）"
                  value={placementMemo}
                  onChangeText={setPlacementMemo}
                  placeholder="例: 右奥の青いケースの中"
                />
              ) : null}
              <Text style={styles.hint}>別の場所にもある場合は、登録後に追加できます。</Text>
            </Section>
            <Section title="用途タグ（任意）">
              <TagEditor value={tags} onChange={setTags} />
            </Section>
          </>
        ) : null}

        <Button title={isEdit ? '保存する' : '登録する'} onPress={submit} loading={save.isPending} />
      </ScrollView>

      <LocationPicker
        visible={pickerOpen}
        title="置き場所を選ぶ"
        initialLocationId={locationId}
        onClose={() => setPickerOpen(false)}
        onSelect={(id) => {
          setPickerOpen(false);
          setLocationId(id);
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  locationSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    minHeight: 48,
    marginBottom: SPACING.md,
  },
  locationText: { flex: 1, fontFamily: FONTS.medium, fontSize: 14, color: COLORS.ink },
  locationPlaceholder: { flex: 1, fontFamily: FONTS.medium, fontSize: 14, color: COLORS.inkFaint },
  hint: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkFaint },
});
