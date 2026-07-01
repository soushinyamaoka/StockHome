import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, SPACING } from '../theme';
import { TextField } from './TextField';
import type { ItemWithStock } from '../api/types';

interface Props {
  label?: string;
  items: ItemWithStock[];
  value: string | null;
  onChange: (itemId: string) => void;
  error?: string;
}

// 品目選択（タップでモーダルを開き、検索して選ぶ）
export const ItemPicker: React.FC<Props> = ({ label, items, value, onChange, error }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = items.find((i) => i.id === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.itemName.toLowerCase().includes(q) || (i.category ?? '').toLowerCase().includes(q)
    );
  }, [items, query]);

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity
        style={[styles.selector, error ? { borderColor: COLORS.accentDeep } : null]}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={selected ? styles.selectedText : styles.placeholder}>
          {selected ? selected.itemName : '品目を選択'}
        </Text>
        <Ionicons name="chevron-down" size={18} color={COLORS.inkSub} />
      </TouchableOpacity>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>品目を選択</Text>
            <TouchableOpacity onPress={() => setOpen(false)}>
              <Ionicons name="close" size={26} color={COLORS.ink} />
            </TouchableOpacity>
          </View>
          <TextField placeholder="品名・カテゴリで検索" value={query} onChangeText={setQuery} />
          <FlatList
            data={filtered}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  onChange(item.id);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{item.itemName}</Text>
                  {item.category ? <Text style={styles.rowSub}>{item.category}</Text> : null}
                </View>
                {item.id === value ? (
                  <Ionicons name="checkmark" size={20} color={COLORS.accent} />
                ) : null}
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.empty}>該当する品目がありません</Text>}
          />
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginBottom: SPACING.md },
  label: {
    fontFamily: FONTS.bold,
    fontSize: 13,
    color: COLORS.inkSub,
    marginBottom: SPACING.xs,
  },
  selector: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1.5,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectedText: { fontFamily: FONTS.medium, color: COLORS.ink, fontSize: 15 },
  placeholder: { fontFamily: FONTS.medium, color: COLORS.inkFaint, fontSize: 15 },
  error: { fontFamily: FONTS.medium, color: COLORS.accentDeep, fontSize: 12, marginTop: SPACING.xs },
  modal: { flex: 1, backgroundColor: COLORS.paper, padding: SPACING.lg, paddingTop: SPACING.xxl + SPACING.lg },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  modalTitle: { fontFamily: FONTS.bold, fontSize: 18, color: COLORS.ink },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  rowName: { fontFamily: FONTS.bold, fontSize: 15, color: COLORS.ink },
  rowSub: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkSub, marginTop: 2 },
  empty: { fontFamily: FONTS.medium, textAlign: 'center', color: COLORS.inkFaint, marginTop: SPACING.xl },
});
