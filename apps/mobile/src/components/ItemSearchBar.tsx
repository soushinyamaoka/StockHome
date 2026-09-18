import React from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ChipSelector } from './ChipSelector';
import { UNCATEGORIZED_LABEL, UNCATEGORIZED_VALUE } from '../lib/itemFilter';
import { COLORS, FONTS, RADIUS, SPACING } from '../theme';

interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  categories: string[];
  category: string | null;
  onCategoryChange: (value: string | null) => void;
}

// 品目一覧・在庫一覧の上部に置く検索＋カテゴリ絞り込み（所見B-7対応）。
// 片手操作を優先して検索欄は1行。カテゴリチップは2種類以上ある時だけ出す
export const ItemSearchBar: React.FC<Props> = ({
  query,
  onQueryChange,
  categories,
  category,
  onCategoryChange,
}) => (
  <View style={styles.container}>
    <View style={styles.searchRow}>
      <Ionicons name="search" size={16} color={COLORS.inkFaint} />
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={onQueryChange}
        placeholder="名前でさがす"
        placeholderTextColor={COLORS.inkFaint}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
      />
      {query ? (
        <TouchableOpacity
          onPress={() => onQueryChange('')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close-circle" size={16} color={COLORS.inkFaint} />
        </TouchableOpacity>
      ) : null}
    </View>
    {categories.length >= 2 ? (
      <ChipSelector
        options={categories.map((value) => ({
          value,
          label: value === UNCATEGORIZED_VALUE ? UNCATEGORIZED_LABEL : value,
        }))}
        value={category}
        onChange={onCategoryChange}
        allowClear
      />
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  container: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },
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
    marginBottom: SPACING.sm,
  },
  input: { flex: 1, fontFamily: FONTS.medium, fontSize: 14, color: COLORS.ink, padding: 0 },
});
