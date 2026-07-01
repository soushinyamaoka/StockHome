import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, ViewProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, SPACING } from '../theme';

interface Props extends ViewProps {
  title: string;
  action?: React.ReactNode;
  /** 見出しタップで開閉できるようにする */
  collapsible?: boolean;
  /** 初期状態を折りたたみにする（collapsible時のみ有効） */
  defaultCollapsed?: boolean;
  /** 見出し右に件数バッジを表示する */
  count?: number;
}

// 見出しは「朱の角印」＋丸ゴシック太字。手帳の小見出しのように
export const Section: React.FC<Props> = ({
  title,
  action,
  collapsible,
  defaultCollapsed,
  count,
  children,
  style,
  ...rest
}) => {
  const [collapsed, setCollapsed] = useState(!!defaultCollapsed);
  const showChildren = !collapsible || !collapsed;

  const heading = (
    <>
      <View style={styles.marker} />
      <Text style={styles.title}>{title}</Text>
      {count != null ? (
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{count}</Text>
        </View>
      ) : null}
    </>
  );

  return (
    <View {...rest} style={[styles.section, style]}>
      <View style={styles.header}>
        {collapsible ? (
          <TouchableOpacity
            style={styles.titleTouch}
            onPress={() => setCollapsed((c) => !c)}
            activeOpacity={0.6}
          >
            {heading}
            <Ionicons
              name={collapsed ? 'chevron-forward' : 'chevron-down'}
              size={16}
              color={COLORS.inkFaint}
              style={{ marginLeft: SPACING.xs }}
            />
          </TouchableOpacity>
        ) : (
          <View style={styles.titleTouch}>{heading}</View>
        )}
        {action ? <View>{action}</View> : null}
      </View>
      {showChildren ? children : null}
    </View>
  );
};

const styles = StyleSheet.create({
  section: { marginBottom: SPACING.xl },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  titleTouch: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  marker: {
    width: 10,
    height: 10,
    borderRadius: 3,
    backgroundColor: COLORS.accent,
    transform: [{ rotate: '45deg' }],
    marginRight: SPACING.sm,
  },
  title: { fontFamily: FONTS.bold, fontSize: 16, color: COLORS.ink },
  countBadge: {
    minWidth: 24,
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceWarm,
    alignItems: 'center',
    marginLeft: SPACING.sm,
  },
  countText: { fontFamily: FONTS.bold, fontSize: 12, color: COLORS.inkSub },
});
