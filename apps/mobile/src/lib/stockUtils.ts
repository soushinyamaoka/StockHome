import { Alert } from 'react-native';
import type { SnoozeAction } from '@stockhome/shared';
import type { SnapshotDto, RuntimeStateDto } from '../api/types';

// 残日数の表示文字列（例: 「残3日」「在庫不明」）
export function daysLeftLabel(snapshot: SnapshotDto | null): string {
  if (!snapshot || snapshot.estimatedDaysLeft == null) return '在庫不明';
  return `残${Math.round(snapshot.estimatedDaysLeft)}日`;
}

// 残数の表示文字列（例: 「約2.5箱」）
export function remainQtyLabel(snapshot: SnapshotDto | null, unit: string | null): string {
  if (!snapshot || snapshot.estimatedRemainingQty == null) return '—';
  const qty = Math.round(snapshot.estimatedRemainingQty * 10) / 10;
  return `約${qty}${unit ?? ''}`;
}

// スヌーズ中かどうか
export function isSnoozed(state: RuntimeStateDto | null): boolean {
  if (!state?.snoozeUntil) return false;
  return new Date(state.snoozeUntil) > new Date();
}

// スヌーズ操作の選択ダイアログ
export function showSnoozeSheet(
  itemName: string,
  snoozed: boolean,
  onSelect: (action: SnoozeAction) => void
) {
  const buttons = [
    { text: '3日後に再通知', onPress: () => onSelect('days3') },
    { text: '7日後に再通知', onPress: () => onSelect('days7') },
    { text: '今回は無視 (30日)', onPress: () => onSelect('ignore') },
    ...(snoozed ? [{ text: 'スヌーズ解除', onPress: () => onSelect('clear') }] : []),
    { text: 'キャンセル', style: 'cancel' as const },
  ];
  Alert.alert('スヌーズ', itemName, buttons);
}

// 'YYYY-MM-DD' → 'M/D' 表示
export function shortDate(s: string | null): string {
  if (!s) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  return `${Number(m[2])}/${Number(m[3])}`;
}
