import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { fetchStorageTags } from '../api/storage';
import { addTagName, suggestTags } from '../lib/storageEdit';
import { COLORS, FONTS, RADIUS, SPACING } from '../theme';

interface Props {
  value: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
}

// 用途タグの付け外し。表記ゆれを防ぐため、入力中は既存のタグを候補として出す
export const TagEditor: React.FC<Props> = ({ value, onChange, disabled }) => {
  const [input, setInput] = useState('');
  const { data } = useQuery({ queryKey: ['storage', 'tags'], queryFn: fetchStorageTags });
  const suggestions = suggestTags(data?.tags ?? [], input, value);

  const add = (name: string) => {
    const next = addTagName(value, name);
    if (next !== value) onChange(next);
    setInput('');
  };

  return (
    <View>
      <View style={styles.selectedWrap}>
        {value.length === 0 ? <Text style={styles.none}>用途タグはまだありません</Text> : null}
        {value.map((name) => (
          <TouchableOpacity
            key={name}
            style={styles.selected}
            onPress={() => onChange(value.filter((n) => n !== name))}
            disabled={disabled}
            accessibilityLabel={`用途タグ ${name} を外す`}
          >
            <Text style={styles.selectedText}>#{name}</Text>
            <Ionicons name="close" size={13} color={COLORS.indigo} />
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="用途を追加（例: 旅行、トイレ掃除）"
          placeholderTextColor={COLORS.inkFaint}
          returnKeyType="done"
          onSubmitEditing={() => add(input)}
          editable={!disabled}
        />
        <TouchableOpacity
          style={[styles.addButton, !input.trim() && { opacity: 0.4 }]}
          onPress={() => add(input)}
          disabled={disabled || !input.trim()}
          accessibilityLabel="用途タグを追加"
        >
          <Ionicons name="add" size={18} color="#FFFDF6" />
        </TouchableOpacity>
      </View>
      {suggestions.length > 0 ? (
        <View style={styles.suggestWrap}>
          {suggestions.map((name) => (
            <TouchableOpacity key={name} style={styles.suggest} onPress={() => add(name)} disabled={disabled}>
              <Text style={styles.suggestText}>+ {name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  selectedWrap: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: SPACING.sm },
  none: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkFaint },
  selected: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.indigoSoft,
    borderWidth: 1.5,
    borderColor: COLORS.indigo,
    marginRight: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  selectedText: { fontFamily: FONTS.bold, fontSize: 13, color: COLORS.indigo },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  input: {
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
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.indigo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: SPACING.sm },
  suggest: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    backgroundColor: COLORS.surface,
    marginRight: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  suggestText: { fontFamily: FONTS.medium, fontSize: 12, color: COLORS.inkSub },
});
