import React, { useLayoutEffect, useMemo, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';

import {
  deleteStorageLocation,
  fetchStorageLocations,
  mergeStorageLocation,
  searchStorage,
  updateStorageLocation,
  type StorageResultDto,
} from '../../api/storage';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { LocationPicker } from '../../components/LocationPicker';
import { apiErrorMessage, selfAndDescendantIds } from '../../lib/storageEdit';
import { StorageResultCard } from '../../components/StorageResultCard';
import { TapeMemo } from '../../components/TapeMemo';
import type { StorageStackParamList } from '../../navigation/types';
import {
  ancestorsOf,
  indexChildren,
  isPlacementUnder,
  relativePlacementPath,
  subtreePlacementCount,
} from '../../lib/storageView';
import { COLORS, FONTS, RADIUS, SHADOW, SPACING } from '../../theme';

// 1つの場所の中身。上の階層（パンくず）・中の場所・ここ（配下を含む）にある物を表示する
export default function StorageLocationScreen() {
  const navigation = useNavigation<any>();
  const { params } = useRoute<RouteProp<StorageStackParamList, 'StorageLocation'>>();
  const { locationId } = params;

  const locationsQuery = useQuery({ queryKey: ['storage', 'locations'], queryFn: fetchStorageLocations });
  const contentsQuery = useQuery({
    queryKey: ['storage', 'search', { locationId }],
    queryFn: () => searchStorage({ locationId }),
  });

  const { location, ancestors, children, childCounts } = useMemo(() => {
    const all = locationsQuery.data?.locations ?? [];
    const byId = new Map(all.map((l) => [l.id, l]));
    const index = indexChildren(all);
    const kids = index.get(locationId) ?? [];
    return {
      location: byId.get(locationId),
      ancestors: ancestorsOf(locationId, byId),
      children: kids,
      childCounts: new Map(kids.map((k) => [k.id, subtreePlacementCount(k.id, index, byId)])),
    };
  }, [locationsQuery.data, locationId]);

  useLayoutEffect(() => {
    navigation.setOptions({ title: location?.name ?? '置き場所' });
  }, [navigation, location?.name]);

  const openLocation = (id: string) => navigation.push('StorageLocation', { locationId: id });
  const results = contentsQuery.data?.results ?? [];
  const refreshing = locationsQuery.isRefetching || contentsQuery.isRefetching;

  // --- この場所自体の操作（移動・統合・削除） ---
  const queryClient = useQueryClient();
  const [picker, setPicker] = useState<'move' | 'merge' | null>(null);
  const excludeIds = useMemo(
    () => selfAndDescendantIds(locationsQuery.data?.locations ?? [], locationId),
    [locationsQuery.data, locationId]
  );
  const onError = (title: string) => (e: unknown) => Alert.alert(title, apiErrorMessage(e, '時間をおいてやり直してください'));
  const move = useMutation({
    mutationFn: (parentId: string | null) => updateStorageLocation(locationId, { parentId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['storage'] }),
    onError: onError('移動できませんでした'),
  });
  const merge = useMutation({
    mutationFn: (targetId: string) => mergeStorageLocation(locationId, targetId),
    onSuccess: async (_r, targetId) => {
      await queryClient.invalidateQueries({ queryKey: ['storage'] });
      // 統合でこの場所は無くなるので、統合先の画面に置き換える
      navigation.replace('StorageLocation', { locationId: targetId });
    },
    onError: onError('統合できませんでした'),
  });
  const remove = useMutation({
    mutationFn: () => deleteStorageLocation(locationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['storage'] });
      navigation.goBack();
    },
    onError: onError('削除できませんでした'),
  });

  const confirmMerge = (targetId: string) => {
    const target = locationsQuery.data?.locations.find((l) => l.id === targetId);
    Alert.alert(
      '統合確認',
      `「${location?.name}」を「${target?.pathText}」にまとめますか？\n中の場所と物はすべて移り、「${location?.name}」は無くなります。`,
      [
        { text: 'やめる', style: 'cancel' },
        { text: 'まとめる', onPress: () => merge.mutate(targetId) },
      ]
    );
  };
  const confirmDelete = () => {
    Alert.alert('削除確認', `「${location?.name}」を削除しますか？`, [
      { text: 'やめる', style: 'cancel' },
      { text: '削除する', style: 'destructive', onPress: () => remove.mutate() },
    ]);
  };
  const busy = move.isPending || merge.isPending || remove.isPending;

  const footer = (
    <View style={styles.footer}>
      <View style={styles.addRow}>
        <View style={{ flex: 1 }}>
          <Button
            title="物を追加"
            small
            icon={<Ionicons name="add" size={16} color="#FFFDF6" />}
            onPress={() => navigation.navigate('StorageThingForm', { locationId })}
          />
        </View>
        <View style={{ width: SPACING.sm }} />
        <View style={{ flex: 1 }}>
          <Button
            title="中に場所を追加"
            small
            variant="outline"
            onPress={() => navigation.navigate('StorageLocationForm', { parentId: locationId })}
          />
        </View>
      </View>
      <Text style={styles.sectionLabel}>この場所の操作</Text>
      <View style={styles.manageBox}>
        <TouchableOpacity
          style={styles.manageRow}
          onPress={() => navigation.navigate('StorageLocationForm', { locationId })}
          disabled={busy}
        >
          <Ionicons name="pencil-outline" size={15} color={COLORS.inkSub} />
          <Text style={styles.manageText}>名前・メモを変える</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.manageRow} onPress={() => setPicker('move')} disabled={busy}>
          <Ionicons name="swap-horizontal" size={15} color={COLORS.inkSub} />
          <Text style={styles.manageText}>別の場所の中へ移す（中身ごと）</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.manageRow} onPress={() => setPicker('merge')} disabled={busy}>
          <Ionicons name="git-merge-outline" size={15} color={COLORS.inkSub} />
          <Text style={styles.manageText}>別の場所にまとめる（統合）</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.manageRow, { borderBottomWidth: 0 }]} onPress={confirmDelete} disabled={busy}>
          <Ionicons name="trash-outline" size={15} color={COLORS.accentDeep} />
          <Text style={[styles.manageText, { color: COLORS.accentDeep }]}>この場所を削除（空のときだけ）</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (locationsQuery.isSuccess && !location) {
    return (
      <View style={[styles.container, styles.content]}>
        <Text style={styles.empty}>この場所は見つかりませんでした（移動・統合・削除された可能性があります）</Text>
      </View>
    );
  }

  const header = (
    <View>
      {ancestors.length > 0 ? (
        <View style={styles.breadcrumb}>
          {ancestors.map((a) => (
            <TouchableOpacity key={a.id} onPress={() => openLocation(a.id)} style={styles.crumb} activeOpacity={0.7}>
              <Text style={styles.crumbText}>{a.name}</Text>
              <Text style={styles.crumbSep}>›</Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.crumbCurrent}>{location?.name}</Text>
        </View>
      ) : null}
      {location?.memo ? <TapeMemo text={location.memo} /> : null}

      {children.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>この中の場所</Text>
          {children.map((child) => (
            <TouchableOpacity
              key={child.id}
              style={styles.childRow}
              onPress={() => openLocation(child.id)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`${child.name}、${childCounts.get(child.id) ?? 0}件`}
            >
              <Ionicons name="file-tray-outline" size={16} color={COLORS.inkSub} />
              <View style={{ flex: 1 }}>
                <Text style={styles.childName}>{child.name}</Text>
                {child.memo ? (
                  <Text style={styles.childMemo} numberOfLines={1}>
                    {child.memo}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.childCount}>{childCounts.get(child.id) ?? 0}</Text>
              <Ionicons name="chevron-forward" size={16} color={COLORS.inkFaint} />
            </TouchableOpacity>
          ))}
        </>
      ) : null}

      <Text style={styles.sectionLabel}>
        {children.length > 0 ? 'ここ（中の場所も含む）にある物' : 'ここにある物'}
        {contentsQuery.isSuccess ? `  ${results.length}件` : ''}
      </Text>
    </View>
  );

  return (
    <>
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={results}
      keyExtractor={(r: StorageResultDto) => `${r.kind}:${r.id}`}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            void locationsQuery.refetch();
            void contentsQuery.refetch();
          }}
          tintColor={COLORS.accent}
        />
      }
      renderItem={({ item }) => (
        <StorageResultCard
          result={item}
          placementFilter={(p) => isPlacementUnder(p, locationId)}
          placementLabel={(p) => relativePlacementPath(p, locationId)}
          onPressPlacement={(p) => (p.locationId === locationId ? undefined : openLocation(p.locationId))}
          onPress={() => navigation.navigate('StorageTarget', { kind: item.kind, id: item.id })}
        />
      )}
      ListEmptyComponent={
        contentsQuery.isError ? (
          <ErrorState onRetry={() => void contentsQuery.refetch()} />
        ) : contentsQuery.isLoading ? (
          <Text style={styles.empty}>読み込み中…</Text>
        ) : (
          <Text style={styles.empty}>この場所にはまだ何も登録されていません</Text>
        )
      }
    />
    <LocationPicker
      visible={picker !== null}
      title={picker === 'merge' ? 'まとめ先の場所' : '移動先（この中へ移します）'}
      initialLocationId={location?.parentId ?? null}
      excludeIds={excludeIds}
      allowRoot={picker === 'move'}
      onClose={() => setPicker(null)}
      onSelect={(targetId) => {
        const mode = picker;
        setPicker(null);
        if (mode === 'move') {
          if (targetId !== (location?.parentId ?? null)) move.mutate(targetId);
        } else if (mode === 'merge' && targetId) {
          confirmMerge(targetId);
        }
      }}
    />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  breadcrumb: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: SPACING.sm },
  crumb: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  crumbText: { fontFamily: FONTS.medium, fontSize: 13, color: COLORS.indigo },
  crumbSep: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.inkFaint, marginHorizontal: 6 },
  crumbCurrent: { fontFamily: FONTS.bold, fontSize: 13, color: COLORS.ink },
  sectionLabel: {
    fontFamily: FONTS.bold,
    fontSize: 13,
    color: COLORS.inkSub,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    marginBottom: SPACING.sm,
    minHeight: 48,
    ...SHADOW.card,
  },
  childName: { fontFamily: FONTS.bold, fontSize: 14, color: COLORS.ink },
  childMemo: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkSub, marginTop: 1 },
  childCount: { fontFamily: FONTS.display, fontSize: 15, color: COLORS.inkSub },
  empty: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.inkSub, lineHeight: 20 },
  footer: { marginTop: SPACING.lg },
  addRow: { flexDirection: 'row' },
  manageBox: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    minHeight: 46,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  manageText: { fontFamily: FONTS.medium, fontSize: 13, color: COLORS.ink },
});
