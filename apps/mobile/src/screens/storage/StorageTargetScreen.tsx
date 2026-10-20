import React, { useLayoutEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';

import {
  assignStorageTags,
  createStorageLocation,
  createStoragePlacement,
  deleteStoragePlacement,
  deleteStorageThing,
  fetchStorageItem,
  fetchStorageLocations,
  fetchStorageThing,
  updateStoragePlacement,
  type StoragePlacementDto,
  type StorageTargetRef,
} from '../../api/storage';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { LocationPicker } from '../../components/LocationPicker';
import { Section } from '../../components/Section';
import { StampBadge } from '../../components/StampBadge';
import { TagEditor } from '../../components/TagEditor';
import { TextPromptModal } from '../../components/TextPromptModal';
import type { StorageStackParamList } from '../../navigation/types';
import { UNPLACED_LOCATION_NAME, apiErrorMessage, findUnplacedRoot, notHereMemo } from '../../lib/storageEdit';
import { COLORS, FONTS, RADIUS, SHADOW, SPACING } from '../../theme';

type PickerMode = { type: 'add' } | { type: 'move'; placement: StoragePlacementDto } | null;

// 1つの消耗品・物の置き場所と用途タグを見て直す画面
export default function StorageTargetScreen() {
  const navigation = useNavigation<any>();
  const { params } = useRoute<RouteProp<StorageStackParamList, 'StorageTarget'>>();
  const { kind, id } = params;
  const ref: StorageTargetRef = kind === 'item' ? { itemId: id } : { thingId: id };
  const queryClient = useQueryClient();
  const [picker, setPicker] = useState<PickerMode>(null);
  const [memoTarget, setMemoTarget] = useState<StoragePlacementDto | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['storage', 'target', kind, id],
    queryFn: async () => (kind === 'item' ? (await fetchStorageItem(id)).item : (await fetchStorageThing(id)).thing),
  });

  useLayoutEffect(() => {
    navigation.setOptions({ title: data?.name ?? (kind === 'item' ? '消耗品の置き場所' : '物の置き場所') });
  }, [navigation, data?.name, kind]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['storage'] });
  const onError = (title: string) => (e: unknown) => Alert.alert(title, apiErrorMessage(e, '時間をおいてやり直してください'));

  const addPlacement = useMutation({
    mutationFn: (locationId: string) => createStoragePlacement({ ...ref, locationId }),
    onSuccess: invalidate,
    onError: onError('置き場所を追加できませんでした'),
  });
  const movePlacement = useMutation({
    mutationFn: ({ placementId, locationId }: { placementId: string; locationId: string }) =>
      updateStoragePlacement(placementId, { locationId }),
    onSuccess: invalidate,
    onError: onError('移動できませんでした'),
  });
  const updateMemo = useMutation({
    mutationFn: ({ placementId, memo }: { placementId: string; memo: string }) =>
      updateStoragePlacement(placementId, { memo: memo || null }),
    onSuccess: async () => {
      await invalidate();
      setMemoTarget(null);
    },
    onError: onError('メモを保存できませんでした'),
  });
  const removePlacement = useMutation({
    mutationFn: deleteStoragePlacement,
    onSuccess: invalidate,
    onError: onError('外せませんでした'),
  });
  // 最後の置き場所は外さず、最上位の「未登録」へ移す（無ければ作る）。場所から辿れない迷子を作らないため
  const moveToUnplaced = useMutation({
    mutationFn: async (p: StoragePlacementDto) => {
      let root = findUnplacedRoot((await fetchStorageLocations()).locations);
      if (!root) {
        try {
          await createStorageLocation({ name: UNPLACED_LOCATION_NAME, parentId: null });
        } catch (e) {
          // 同時に作られていた場合（409）は作り直さず、作られた方を使う
          if ((e as { response?: { status?: number } })?.response?.status !== 409) throw e;
        }
        root = findUnplacedRoot((await fetchStorageLocations()).locations);
        if (!root) throw new Error('unplaced location not found');
      }
      await updateStoragePlacement(p.id, {
        ...(root.id === p.locationId ? {} : { locationId: root.id }),
        memo: notHereMemo(p.pathText, p.memo, new Date()),
      });
    },
    onSuccess: invalidate,
    onError: onError(`「${UNPLACED_LOCATION_NAME}」へ移せませんでした`),
  });
  const saveTags = useMutation({
    mutationFn: (names: string[]) => assignStorageTags({ ...ref, names }),
    onSuccess: invalidate,
    onError: onError('用途タグを保存できませんでした'),
  });
  const removeThing = useMutation({
    mutationFn: () => deleteStorageThing(id),
    onSuccess: async () => {
      await invalidate();
      navigation.goBack();
    },
    onError: onError('削除できませんでした'),
  });

  // 「ここに無かった」: 実際に無かった置き場所を外す。他の置き場所は残る。
  // 最後の1か所なら外さずに「未登録」へ移し、いつ・どこで無かったかをメモに残す
  const confirmNotHere = (p: StoragePlacementDto) => {
    if ((data?.placements.length ?? 0) > 1) {
      Alert.alert('ここに無かった', `「${p.pathText}」を置き場所から外しますか？`, [
        { text: 'やめる', style: 'cancel' },
        { text: '外す', style: 'destructive', onPress: () => removePlacement.mutate(p.id) },
      ]);
      return;
    }
    Alert.alert(
      'ここに無かった',
      `最後の置き場所です。「${UNPLACED_LOCATION_NAME}」へ移しますか？\n（メモに「ここに無かった」と元の場所を残します）`,
      [
        { text: 'やめる', style: 'cancel' },
        { text: '移す', onPress: () => moveToUnplaced.mutate(p) },
      ]
    );
  };

  const confirmDeleteThing = () => {
    Alert.alert('削除確認', `「${data?.name}」を削除しますか？\n（置き場所・用途タグも見えなくなります）`, [
      { text: 'やめる', style: 'cancel' },
      { text: '削除する', style: 'destructive', onPress: () => removeThing.mutate() },
    ]);
  };

  if (isError && !data) {
    return (
      <View style={[styles.container, styles.content]}>
        <ErrorState onRetry={() => void refetch()} />
      </View>
    );
  }
  if (isLoading || !data) {
    return (
      <View style={[styles.container, styles.content]}>
        <Text style={styles.muted}>読み込み中…</Text>
      </View>
    );
  }

  const busy = addPlacement.isPending || movePlacement.isPending || removePlacement.isPending || moveToUnplaced.isPending;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={COLORS.accent} />}
    >
      <View style={styles.titleRow}>
        <Text style={styles.name}>{data.name}</Text>
        {kind === 'item' ? <StampBadge label="消耗品" color={COLORS.indigo} /> : null}
        {kind === 'thing' ? (
          <TouchableOpacity
            style={styles.editLink}
            onPress={() => navigation.navigate('StorageThingForm', { thingId: id })}
            accessibilityLabel="名前とメモを編集"
          >
            <Ionicons name="pencil-outline" size={15} color={COLORS.inkSub} />
            <Text style={styles.editText}>編集</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {data.memo ? <Text style={styles.memo}>{data.memo}</Text> : null}

      <Section title="置き場所" count={data.placements.length}>
        {data.placements.length === 0 ? <Text style={styles.muted}>まだ置き場所がありません</Text> : null}
        {data.placements.map((p) => (
          <View key={p.id} style={styles.placementCard}>
            <TouchableOpacity
              style={styles.placementMain}
              onPress={() => navigation.push('StorageLocation', { locationId: p.locationId })}
              activeOpacity={0.75}
            >
              <Ionicons name="location-sharp" size={16} color={COLORS.accent} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.path}>{p.pathText}</Text>
                {p.memo ? <Text style={styles.placementMemo}>{p.memo}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={14} color={COLORS.inkFaint} />
            </TouchableOpacity>
            <View style={styles.placementActions}>
              <TouchableOpacity style={styles.action} onPress={() => setPicker({ type: 'move', placement: p })} disabled={busy}>
                <Ionicons name="swap-horizontal" size={14} color={COLORS.inkSub} />
                <Text style={styles.actionText}>移動</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.action} onPress={() => setMemoTarget(p)} disabled={busy}>
                <Ionicons name="create-outline" size={14} color={COLORS.inkSub} />
                <Text style={styles.actionText}>メモ</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.action} onPress={() => confirmNotHere(p)} disabled={busy}>
                <Ionicons name="help-circle-outline" size={14} color={COLORS.accentDeep} />
                <Text style={[styles.actionText, { color: COLORS.accentDeep }]}>ここに無かった</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
        <Button
          title="置き場所を追加"
          variant="outline"
          small
          icon={<Ionicons name="add" size={16} color={COLORS.ink} />}
          onPress={() => setPicker({ type: 'add' })}
          loading={addPlacement.isPending}
        />
      </Section>

      <Section title="用途タグ">
        <TagEditor
          value={data.tags.map((t) => t.name)}
          onChange={(names) => saveTags.mutate(names)}
          disabled={saveTags.isPending}
        />
      </Section>

      {kind === 'thing' ? (
        <TouchableOpacity style={styles.deleteLink} onPress={confirmDeleteThing} disabled={removeThing.isPending}>
          <Ionicons name="trash-outline" size={15} color={COLORS.accentDeep} />
          <Text style={styles.deleteText}>この物を削除する</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.hint}>品名や消費ペースの変更は「消耗品」タブから行います。</Text>
      )}

      <LocationPicker
        visible={picker !== null}
        title={picker?.type === 'move' ? '移動先の場所' : '置き場所を追加'}
        initialLocationId={picker?.type === 'move' ? picker.placement.locationId : data.placements[0]?.locationId ?? null}
        onClose={() => setPicker(null)}
        onSelect={(locationId) => {
          const mode = picker;
          setPicker(null);
          if (!locationId || !mode) return;
          if (mode.type === 'add') addPlacement.mutate(locationId);
          else if (locationId !== mode.placement.locationId) {
            movePlacement.mutate({ placementId: mode.placement.id, locationId });
          }
        }}
      />
      <TextPromptModal
        visible={memoTarget !== null}
        title="置き方のメモ（例: 右奥の青いケース）"
        initialValue={memoTarget?.memo ?? ''}
        allowEmpty
        submitLabel="保存"
        loading={updateMemo.isPending}
        onCancel={() => setMemoTarget(null)}
        onSubmit={(memo) => memoTarget && updateMemo.mutate({ placementId: memoTarget.id, memo })}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  muted: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.inkSub, marginBottom: SPACING.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.xs },
  name: { flex: 1, fontFamily: FONTS.bold, fontSize: 20, color: COLORS.ink },
  editLink: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: SPACING.sm },
  editText: { fontFamily: FONTS.medium, fontSize: 13, color: COLORS.inkSub },
  memo: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.inkSub, marginBottom: SPACING.md },
  placementCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.sm,
    ...SHADOW.card,
  },
  placementMain: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, padding: SPACING.md },
  path: { fontFamily: FONTS.bold, fontSize: 14, color: COLORS.ink },
  placementMemo: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkSub, marginTop: 2 },
  placementActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: SPACING.sm,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: SPACING.sm, minHeight: 44 },
  actionText: { fontFamily: FONTS.medium, fontSize: 12, color: COLORS.inkSub },
  deleteLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', padding: SPACING.md, marginTop: SPACING.md },
  deleteText: { fontFamily: FONTS.medium, fontSize: 13, color: COLORS.accentDeep },
  hint: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkFaint, textAlign: 'center', marginTop: SPACING.md },
});
