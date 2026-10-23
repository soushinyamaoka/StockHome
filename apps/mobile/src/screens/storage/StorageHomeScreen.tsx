import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';

import { fetchStorageLocations, fetchStorageTags, searchStorage, type StorageResultDto } from '../../api/storage';
import { ErrorState } from '../../components/ErrorState';
import { StorageResultCard } from '../../components/StorageResultCard';
import { indexChildren, subtreePlacementCount } from '../../lib/storageView';
import { COLORS, FONTS, RADIUS, SHADOW, SPACING } from '../../theme';

const SEARCH_DEBOUNCE_MS = 300;

// 置き場所タブのトップ。キーワード・用途タグで探すか、最上位の場所から辿る
export default function StorageHomeScreen() {
  const navigation = useNavigation<any>();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [tagId, setTagId] = useState<string | null>(null);

  // 入力のたびに検索しないよう、打ち終わってから検索する
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const locationsQuery = useQuery({ queryKey: ['storage', 'locations'], queryFn: fetchStorageLocations });
  const tagsQuery = useQuery({ queryKey: ['storage', 'tags'], queryFn: fetchStorageTags });
  const searching = query.length > 0 || tagId !== null;
  const searchQuery = useQuery({
    queryKey: ['storage', 'search', { q: query, tagId }],
    queryFn: () => searchStorage({ q: query || undefined, tagId: tagId ?? undefined }),
    enabled: searching,
  });

  const locations = locationsQuery.data?.locations ?? [];
  const tags = (tagsQuery.data?.tags ?? []).filter((t) => t.usageCount > 0);
  const activeTag = tags.find((t) => t.id === tagId) ?? null;
  const { roots, counts } = useMemo(() => {
    const children = indexChildren(locations);
    const byId = new Map(locations.map((l) => [l.id, l]));
    const rootList = children.get(null) ?? [];
    return {
      roots: rootList,
      counts: new Map(rootList.map((r) => [r.id, subtreePlacementCount(r.id, children, byId)])),
    };
  }, [locations]);

  const openLocation = (locationId: string) => navigation.navigate('StorageLocation', { locationId });

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('StorageThingForm', {})}
          style={styles.headerAdd}
          accessibilityLabel="物を登録"
        >
          <Ionicons name="add" size={20} color="#FFFDF6" />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  const footer = (
    <View style={styles.footer}>
      <TouchableOpacity style={styles.footerLink} onPress={() => navigation.navigate('StorageLocationForm', {})}>
        <Ionicons name="add-circle-outline" size={16} color={COLORS.indigo} />
        <Text style={styles.footerLinkText}>最上位に場所を追加（例: 1階・2階）</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.footerLink} onPress={() => navigation.navigate('StorageTags')}>
        <Ionicons name="pricetags-outline" size={16} color={COLORS.indigo} />
        <Text style={styles.footerLinkText}>用途タグの整理</Text>
      </TouchableOpacity>
    </View>
  );
  const refreshing = locationsQuery.isRefetching || tagsQuery.isRefetching || searchQuery.isRefetching;
  const refresh = () => {
    void locationsQuery.refetch();
    void tagsQuery.refetch();
    if (searching) void searchQuery.refetch();
  };

  const header = (
    <View>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={COLORS.inkFaint} />
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="名前・場所・用途でさがす"
          placeholderTextColor={COLORS.inkFaint}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="置き場所をさがす"
        />
        {input ? (
          <TouchableOpacity onPress={() => setInput('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={16} color={COLORS.inkFaint} />
          </TouchableOpacity>
        ) : null}
      </View>

      {tags.length > 0 ? (
        <View style={styles.tagWrap}>
          {tags.map((tag) => {
            const active = tag.id === tagId;
            return (
              <TouchableOpacity
                key={tag.id}
                style={[styles.tagChip, active && styles.tagChipActive]}
                onPress={() => setTagId(active ? null : tag.id)}
                activeOpacity={0.7}
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.tagChipText, active && styles.tagChipTextActive]}>#{tag.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {searching ? (
        <Text style={styles.resultCount}>
          {searchQuery.isLoading ? 'さがしています…' : `${searchQuery.data?.results.length ?? 0}件みつかりました`}
        </Text>
      ) : (
        <Text style={styles.sectionLabel}>場所からたどる</Text>
      )}
    </View>
  );

  if (searching) {
    return (
      <FlatList
        style={styles.container}
        contentContainerStyle={styles.content}
        data={searchQuery.data?.results ?? []}
        keyExtractor={(r: StorageResultDto) => `${r.kind}:${r.id}`}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={COLORS.accent} />}
        renderItem={({ item }) => (
          <StorageResultCard
            result={item}
            onPressPlacement={(p) => openLocation(p.locationId)}
            onPressTag={(tag) => setTagId(tag.id)}
            onPress={() => navigation.navigate('StorageTarget', { kind: item.kind, id: item.id })}
          />
        )}
        ListEmptyComponent={
          searchQuery.isError ? (
            <ErrorState onRetry={() => void searchQuery.refetch()} />
          ) : searchQuery.isLoading ? undefined : query && activeTag ? (
            // キーワードと用途タグは両方に当てはまるものだけを出すため、タグを外せば見つかることがある
            <View>
              <Text style={styles.empty}>「{query}」で #{activeTag.name} のものは見つかりませんでした</Text>
              <TouchableOpacity style={styles.clearTag} onPress={() => setTagId(null)} activeOpacity={0.75}>
                <Ionicons name="close" size={14} color={COLORS.indigo} />
                <Text style={styles.clearTagText}>#{activeTag.name} の絞り込みを外す</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.empty}>見つかりませんでした。別のことばでも試してください</Text>
          )
        }
      />
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={roots}
      keyExtractor={(l) => l.id}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={COLORS.accent} />}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.locationRow}
          onPress={() => openLocation(item.id)}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={`${item.name}、${counts.get(item.id) ?? 0}件`}
        >
          <Ionicons name="file-tray-stacked-outline" size={18} color={COLORS.inkSub} />
          <View style={{ flex: 1 }}>
            <Text style={styles.locationName}>{item.name}</Text>
            {item.memo ? (
              <Text style={styles.locationMemo} numberOfLines={1}>
                {item.memo}
              </Text>
            ) : null}
          </View>
          <Text style={styles.locationCount}>{counts.get(item.id) ?? 0}</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.inkFaint} />
        </TouchableOpacity>
      )}
      ListEmptyComponent={
        locationsQuery.isError ? (
          <ErrorState onRetry={() => void locationsQuery.refetch()} />
        ) : locationsQuery.isLoading ? (
          <Text style={styles.empty}>読み込み中…</Text>
        ) : (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>まだ置き場所が登録されていません</Text>
            <Text style={styles.empty}>
              右上の＋から物を登録するか、下の「最上位に場所を追加」から場所を作れます。物と場所をチャットで伝えて、まとめて登録することもできます。
            </Text>
          </View>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1.5,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    marginBottom: SPACING.md,
  },
  input: { flex: 1, fontFamily: FONTS.medium, fontSize: 14, color: COLORS.ink, padding: 0 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: SPACING.sm },
  tagChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    marginRight: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  tagChipActive: { backgroundColor: COLORS.indigoSoft, borderColor: COLORS.indigo },
  tagChipText: { fontFamily: FONTS.medium, fontSize: 13, color: COLORS.inkSub },
  tagChipTextActive: { fontFamily: FONTS.bold, color: COLORS.indigo },
  sectionLabel: { fontFamily: FONTS.bold, fontSize: 13, color: COLORS.inkSub, marginBottom: SPACING.sm },
  resultCount: { fontFamily: FONTS.medium, fontSize: 12, color: COLORS.inkSub, marginBottom: SPACING.sm },
  locationRow: {
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
    minHeight: 52,
    ...SHADOW.card,
  },
  locationName: { fontFamily: FONTS.bold, fontSize: 15, color: COLORS.ink },
  locationMemo: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkSub, marginTop: 1 },
  locationCount: { fontFamily: FONTS.display, fontSize: 16, color: COLORS.inkSub },
  emptyBox: { paddingVertical: SPACING.lg },
  emptyTitle: { fontFamily: FONTS.bold, fontSize: 14, color: COLORS.ink, marginBottom: SPACING.sm },
  empty: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.inkSub, lineHeight: 20 },
  clearTag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    borderWidth: 1.5,
    borderColor: COLORS.indigo,
    backgroundColor: COLORS.indigoSoft,
  },
  clearTagText: { fontFamily: FONTS.bold, fontSize: 13, color: COLORS.indigo },
  headerAdd: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.accent,
    borderWidth: 1.5,
    borderColor: COLORS.borderInk,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { marginTop: SPACING.lg },
  footerLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: SPACING.md, minHeight: 44 },
  footerLinkText: { fontFamily: FONTS.medium, fontSize: 13, color: COLORS.indigo },
});
