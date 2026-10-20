import React, { useState } from 'react';
import { Alert, FlatList, Modal, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  deleteStorageTag,
  fetchStorageTags,
  mergeStorageTag,
  renameStorageTag,
  type StorageTagDto,
} from '../../api/storage';
import { ErrorState } from '../../components/ErrorState';
import { TextPromptModal } from '../../components/TextPromptModal';
import { apiErrorMessage } from '../../lib/storageEdit';
import { COLORS, FONTS, RADIUS, SHADOW, SPACING } from '../../theme';

// 用途タグの整理（名前の変更・表記ゆれの統合・削除）
export default function StorageTagsScreen() {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<StorageTagDto | null>(null);
  const [merging, setMerging] = useState<StorageTagDto | null>(null);
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['storage', 'tags'],
    queryFn: fetchStorageTags,
  });
  const tags = data?.tags ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['storage'] });
  const onError = (title: string) => (e: unknown) => Alert.alert(title, apiErrorMessage(e, '時間をおいてやり直してください'));

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameStorageTag(id, name),
    onSuccess: async () => {
      await invalidate();
      setRenaming(null);
    },
    onError: onError('名前を変えられませんでした'),
  });
  const merge = useMutation({
    mutationFn: ({ id, targetId }: { id: string; targetId: string }) => mergeStorageTag(id, targetId),
    onSuccess: async () => {
      await invalidate();
      setMerging(null);
      setOpenId(null);
    },
    onError: onError('統合できませんでした'),
  });
  const remove = useMutation({
    mutationFn: deleteStorageTag,
    onSuccess: async () => {
      await invalidate();
      setOpenId(null);
    },
    onError: onError('削除できませんでした'),
  });

  const confirmMerge = (source: StorageTagDto, target: StorageTagDto) => {
    Alert.alert('統合確認', `#${source.name} を #${target.name} にまとめますか？\n#${source.name} は無くなります。`, [
      { text: 'やめる', style: 'cancel' },
      { text: 'まとめる', onPress: () => merge.mutate({ id: source.id, targetId: target.id }) },
    ]);
  };
  const confirmDelete = (tag: StorageTagDto) => {
    Alert.alert('削除確認', `#${tag.name} を削除しますか？\n（付いている${tag.usageCount}件からも外れます）`, [
      { text: 'やめる', style: 'cancel' },
      { text: '削除する', style: 'destructive', onPress: () => remove.mutate(tag.id) },
    ]);
  };

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={tags}
        keyExtractor={(t) => t.id}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={COLORS.accent} />}
        ListHeaderComponent={
          <Text style={styles.lead}>同じ意味のタグ（例: 「服汚れ」と「服の汚れ」）は統合すると、探しやすくなります。</Text>
        }
        renderItem={({ item }) => {
          const open = openId === item.id;
          return (
            <View style={styles.card}>
              <TouchableOpacity style={styles.row} onPress={() => setOpenId(open ? null : item.id)} activeOpacity={0.75}>
                <Text style={styles.tagName}>#{item.name}</Text>
                <Text style={styles.count}>{item.usageCount}件</Text>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.inkFaint} />
              </TouchableOpacity>
              {open ? (
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.action} onPress={() => setRenaming(item)}>
                    <Ionicons name="pencil-outline" size={14} color={COLORS.inkSub} />
                    <Text style={styles.actionText}>名前を変える</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.action} onPress={() => setMerging(item)} disabled={tags.length < 2}>
                    <Ionicons name="git-merge-outline" size={14} color={COLORS.inkSub} />
                    <Text style={styles.actionText}>別のタグにまとめる</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.action} onPress={() => confirmDelete(item)}>
                    <Ionicons name="trash-outline" size={14} color={COLORS.accentDeep} />
                    <Text style={[styles.actionText, { color: COLORS.accentDeep }]}>削除</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          );
        }}
        ListEmptyComponent={
          isError ? (
            <ErrorState onRetry={() => void refetch()} />
          ) : (
            <Text style={styles.lead}>{isLoading ? '読み込み中…' : 'まだ用途タグがありません'}</Text>
          )
        }
      />

      <TextPromptModal
        visible={renaming !== null}
        title="タグの新しい名前"
        initialValue={renaming?.name ?? ''}
        submitLabel="変更"
        loading={rename.isPending}
        onCancel={() => setRenaming(null)}
        onSubmit={(name) => renaming && rename.mutate({ id: renaming.id, name })}
      />

      <Modal visible={merging !== null} transparent animationType="fade" onRequestClose={() => setMerging(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>#{merging?.name} をどのタグにまとめますか？</Text>
            <FlatList
              style={{ maxHeight: 360 }}
              data={tags.filter((t) => t.id !== merging?.id)}
              keyExtractor={(t) => t.id}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.sheetRow} onPress={() => merging && confirmMerge(merging, item)}>
                  <Text style={styles.tagName}>#{item.name}</Text>
                  <Text style={styles.count}>{item.usageCount}件</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.sheetCancel} onPress={() => setMerging(null)}>
              <Text style={styles.sheetCancelText}>やめる</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  lead: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.inkSub, lineHeight: 20, marginBottom: SPACING.md },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.sm,
    ...SHADOW.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.md, minHeight: 48 },
  tagName: { flex: 1, fontFamily: FONTS.bold, fontSize: 14, color: COLORS.indigo },
  count: { fontFamily: FONTS.medium, fontSize: 12, color: COLORS.inkSub },
  actions: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: SPACING.sm, minHeight: 44 },
  actionText: { fontFamily: FONTS.medium, fontSize: 13, color: COLORS.inkSub },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', paddingHorizontal: SPACING.lg },
  sheet: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg },
  sheetTitle: { fontFamily: FONTS.bold, fontSize: 15, color: COLORS.ink, marginBottom: SPACING.md },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sheetCancel: { alignSelf: 'center', padding: SPACING.md, marginTop: SPACING.sm },
  sheetCancelText: { fontFamily: FONTS.bold, fontSize: 14, color: COLORS.inkSub },
});
