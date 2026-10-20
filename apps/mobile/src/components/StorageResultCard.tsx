import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { StoragePlacementDto, StorageResultDto } from '../api/storage';
import { StampBadge } from './StampBadge';
import { COLORS, FONTS, RADIUS, SHADOW, SPACING } from '../theme';

interface Props {
  result: StorageResultDto;
  /** 置き場所の表示文字列（場所の画面では相対パスにする）。未指定なら全体のパス */
  placementLabel?: (placement: StoragePlacementDto) => string;
  /** 表示する置き場所を絞る（場所の画面では、その場所の配下だけ） */
  placementFilter?: (placement: StoragePlacementDto) => boolean;
  onPressPlacement?: (placement: StoragePlacementDto) => void;
  onPressTag?: (tag: { id: string; name: string }) => void;
}

// 置き場所の検索結果1件。名前・置き場所（複数）・用途タグを1枚の札にまとめる
export const StorageResultCard: React.FC<Props> = ({
  result,
  placementLabel,
  placementFilter,
  onPressPlacement,
  onPressTag,
}) => {
  const placements = placementFilter ? result.placements.filter(placementFilter) : result.placements;
  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Text style={styles.name} numberOfLines={2}>
          {result.name}
        </Text>
        {result.kind === 'item' ? <StampBadge label="消耗品" color={COLORS.indigo} /> : null}
      </View>
      {result.memo ? <Text style={styles.memo}>{result.memo}</Text> : null}

      {placements.length === 0 ? (
        <Text style={styles.unplaced}>置き場所は未登録です</Text>
      ) : (
        placements.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={styles.placement}
            disabled={!onPressPlacement}
            onPress={() => onPressPlacement?.(p)}
            activeOpacity={0.7}
            accessibilityRole={onPressPlacement ? 'button' : undefined}
            accessibilityLabel={`置き場所 ${p.pathText}${p.memo ? `、${p.memo}` : ''}`}
          >
            <Ionicons name="location-sharp" size={14} color={COLORS.accent} style={styles.pin} />
            <View style={{ flex: 1 }}>
              <Text style={styles.path}>{placementLabel ? placementLabel(p) : p.pathText}</Text>
              {p.memo ? <Text style={styles.placementMemo}>{p.memo}</Text> : null}
            </View>
            {onPressPlacement ? <Ionicons name="chevron-forward" size={14} color={COLORS.inkFaint} /> : null}
          </TouchableOpacity>
        ))
      )}

      {result.tags.length > 0 ? (
        <View style={styles.tagRow}>
          {result.tags.map((tag) => (
            <TouchableOpacity
              key={tag.id}
              style={styles.tag}
              disabled={!onPressTag}
              onPress={() => onPressTag?.(tag)}
              activeOpacity={0.7}
            >
              <Text style={styles.tagText}>#{tag.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...SHADOW.card,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  name: { flex: 1, fontFamily: FONTS.bold, fontSize: 15, color: COLORS.ink },
  memo: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkSub, marginTop: 2 },
  unplaced: { fontFamily: FONTS.medium, fontSize: 12, color: COLORS.inkFaint, marginTop: SPACING.sm },
  placement: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: SPACING.sm,
    paddingVertical: 6,
    paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.surfaceWarm,
    borderRadius: RADIUS.sm,
    minHeight: 36,
  },
  pin: { marginTop: 2, marginRight: 6 },
  path: { fontFamily: FONTS.medium, fontSize: 13, color: COLORS.ink },
  placementMemo: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.inkSub, marginTop: 1 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: SPACING.sm },
  tag: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.indigoSoft,
    marginRight: 6,
    marginBottom: 4,
  },
  tagText: { fontFamily: FONTS.medium, fontSize: 12, color: COLORS.indigo },
});
