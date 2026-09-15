// 品目ごとの通知先設定（notify_target_type）の解釈を1箇所に集約する。
// ホーム画面の表示判定と夜間バッチのプッシュ宛先解決で同じ規則を使うため、
// どちらか片方だけが変わって画面と通知が食い違う状態を作らない（所見A-4対応）

export interface NotifyTargetFields {
  notifyTargetType: string;
  notifyTargetUserId: string | null;
}

export interface NotifyMember {
  userId: string;
  role: string;
  isActive: boolean;
}

/**
 * 閲覧者1人に対して、この品目のアラートを見せる/通知するかを判定する。
 * ホーム画面（routes/dashboard.ts）が使う
 */
export function isNotifyTargetForUser(
  item: NotifyTargetFields,
  userId: string,
  role: string
): boolean {
  if (item.notifyTargetType === 'representative') return role === 'admin';
  if (item.notifyTargetType === 'specific_user') return item.notifyTargetUserId === userId;
  return true;
}

/**
 * 品目1件について、プッシュ通知を受け取るべきユーザーID一覧を返す。
 * 夜間バッチ（services/batch.ts）が使う。
 * 無効化されたユーザー（User.isActive = false）は常に除外する
 */
export function resolveNotifyTargetUserIds(
  item: NotifyTargetFields,
  members: NotifyMember[]
): string[] {
  const active = members.filter((m) => m.isActive);
  if (item.notifyTargetType === 'representative') {
    return active.filter((m) => m.role === 'admin').map((m) => m.userId);
  }
  if (item.notifyTargetType === 'specific_user') {
    const targetId = item.notifyTargetUserId;
    if (!targetId) return [];
    return active.some((m) => m.userId === targetId) ? [targetId] : [];
  }
  return active.map((m) => m.userId);
}

/** LINE（世帯一括配信）へ載せてよい品目か。全員が読むため all のみ */
export function isBroadcastTarget(item: NotifyTargetFields): boolean {
  return item.notifyTargetType === 'all';
}
