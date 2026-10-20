import React, { useLayoutEffect, useMemo } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';

import { fetchStorageLocations, searchStorage, type StorageResultDto } from '../../api/storage';
import { ErrorState } from '../../components/ErrorState';
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
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={results}
      keyExtractor={(r: StorageResultDto) => `${r.kind}:${r.id}`}
      ListHeaderComponent={header}
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
});
