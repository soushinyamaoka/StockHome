import React, { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createStorageLocation, fetchStorageLocations } from '../api/storage';
import { Button } from './Button';
import { ancestorsOf, indexChildren } from '../lib/storageView';
import { apiErrorMessage } from '../lib/storageEdit';
import { COLORS, FONTS, RADIUS, SPACING } from '../theme';

interface Props {
  visible: boolean;
  title: string;
  /** 開いたときに表示する場所（その場所の中身を表示する）。未指定なら最上位 */
  initialLocationId?: string | null;
  /** 選べない場所（移動・統合で自分と配下を除くため） */
  excludeIds?: Set<string>;
  /** 「最上位」を選択肢にする（場所の移動用） */
  allowRoot?: boolean;
  onSelect: (locationId: string | null) => void;
  onClose: () => void;
}

// 場所の木を辿って1つ選ぶ全画面モーダル。今いる階層に新しい場所を作って、そのまま選ぶこともできる
export const LocationPicker: React.FC<Props> = ({
  visible,
  title,
  initialLocationId = null,
  excludeIds,
  allowRoot,
  onSelect,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [currentId, setCurrentId] = useState<string | null>(initialLocationId);
  const [newName, setNewName] = useState('');
  useEffect(() => {
    if (visible) {
      setCurrentId(initialLocationId);
      setNewName('');
    }
  }, [visible, initialLocationId]);

  const { data } = useQuery({ queryKey: ['storage', 'locations'], queryFn: fetchStorageLocations, enabled: visible });
  const { byId, children } = useMemo(() => {
    const all = data?.locations ?? [];
    return { byId: new Map(all.map((l) => [l.id, l])), children: indexChildren(all) };
  }, [data]);

  const current = currentId ? byId.get(currentId) : undefined;
  const ancestors = currentId ? ancestorsOf(currentId, byId) : [];
  const list = children.get(currentId) ?? [];
  const currentExcluded = currentId ? !!excludeIds?.has(currentId) : false;

  const createMutation = useMutation({
    mutationFn: (name: string) => createStorageLocation({ name, parentId: currentId }),
    onSuccess: async ({ location }) => {
      await queryClient.invalidateQueries({ queryKey: ['storage'] });
      setNewName('');
      onSelect(location.id);
    },
    onError: (e) => Alert.alert('場所を作れませんでした', apiErrorMessage(e, '時間をおいてやり直してください')),
  });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top + SPACING.sm, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity onPress={onClose} accessibilityLabel="閉じる" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={26} color={COLORS.ink} />
          </TouchableOpacity>
        </View>

        <View style={styles.breadcrumb}>
          <TouchableOpacity onPress={() => setCurrentId(null)} style={styles.crumb}>
            <Text style={currentId ? styles.crumbLink : styles.crumbCurrent}>最上位</Text>
          </TouchableOpacity>
          {ancestors.map((a) => (
            <TouchableOpacity key={a.id} onPress={() => setCurrentId(a.id)} style={styles.crumb}>
              <Text style={styles.crumbSep}>›</Text>
              <Text style={styles.crumbLink}>{a.name}</Text>
            </TouchableOpacity>
          ))}
          {current ? (
            <View style={styles.crumb}>
              <Text style={styles.crumbSep}>›</Text>
              <Text style={styles.crumbCurrent}>{current.name}</Text>
            </View>
          ) : null}
        </View>

        {current && !currentExcluded ? (
          <Button
            title={`「${current.name}」に決める`}
            icon={<Ionicons name="checkmark" size={16} color="#FFFDF6" />}
            onPress={() => onSelect(current.id)}
          />
        ) : null}
        {!current && allowRoot ? (
          <Button title="最上位に決める" variant="outline" onPress={() => onSelect(null)} />
        ) : null}

        <FlatList
          style={{ marginTop: SPACING.md }}
          data={list}
          keyExtractor={(l) => l.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const excluded = !!excludeIds?.has(item.id);
            const hasChildren = (children.get(item.id) ?? []).length > 0;
            return (
              <TouchableOpacity
                style={[styles.row, excluded && styles.rowExcluded]}
                onPress={() => setCurrentId(item.id)}
                disabled={excluded}
                activeOpacity={0.75}
                accessibilityRole="button"
              >
                <Ionicons name={hasChildren ? 'file-tray-stacked-outline' : 'file-tray-outline'} size={16} color={COLORS.inkSub} />
                <Text style={styles.rowText}>{item.name}</Text>
                {excluded ? <Text style={styles.rowNote}>選べません</Text> : null}
                <Ionicons name="chevron-forward" size={16} color={COLORS.inkFaint} />
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.empty}>{current ? 'この中にはまだ場所がありません' : 'まだ場所がありません'}</Text>
          }
          ListFooterComponent={
            currentExcluded ? undefined : (
              <View style={styles.newRow}>
                <TextInput
                  style={styles.newInput}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder={current ? `「${current.name}」の中に新しい場所` : '新しい場所（例: 1階）'}
                  placeholderTextColor={COLORS.inkFaint}
                  returnKeyType="done"
                  onSubmitEditing={() => newName.trim() && createMutation.mutate(newName.trim())}
                />
                <Button
                  title="作って決める"
                  small
                  onPress={() => createMutation.mutate(newName.trim())}
                  disabled={!newName.trim()}
                  loading={createMutation.isPending}
                />
              </View>
            )
          }
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper, paddingHorizontal: SPACING.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  title: { fontFamily: FONTS.bold, fontSize: 17, color: COLORS.ink },
  breadcrumb: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: SPACING.md },
  crumb: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  crumbLink: { fontFamily: FONTS.medium, fontSize: 14, color: COLORS.indigo },
  crumbCurrent: { fontFamily: FONTS.bold, fontSize: 14, color: COLORS.ink },
  crumbSep: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.inkFaint, marginHorizontal: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    minHeight: 48,
    marginBottom: SPACING.sm,
  },
  rowExcluded: { opacity: 0.45 },
  rowText: { flex: 1, fontFamily: FONTS.bold, fontSize: 14, color: COLORS.ink },
  rowNote: { fontFamily: FONTS.medium, fontSize: 11, color: COLORS.inkFaint },
  empty: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.inkSub, marginVertical: SPACING.sm },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.md },
  newInput: {
    flex: 1,
    fontFamily: FONTS.medium,
    fontSize: 14,
    color: COLORS.ink,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
  },
});
