// StockHome 共通定数
// GAS 版 Config.js の ENUMS / DEFAULTS を移植したもの

// --- 購入元 ---
export const SOURCES = ['manual', 'line', 'gmail'] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_TYPES = ['manual', 'line_quick', 'gmail_auto', 'gmail_auto_confirmed'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const EXTERNAL_VENDORS = ['amazon', 'matsukiyo'] as const;
export type ExternalVendor = (typeof EXTERNAL_VENDORS)[number];

export const VENDOR_LABELS: Record<ExternalVendor, string> = {
  amazon: 'Amazon',
  matsukiyo: 'マツキヨ',
};

// --- 購入履歴の配送状態 ---
export const FULFILLMENT_STATUSES = ['ordered', 'shipped', 'received', 'cancelled'] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

// --- Gmail 取込候補の状態 ---
export const CANDIDATE_STATUSES = [
  'detected',
  'ordered',
  'shipped',
  'confirmed',
  'auto_confirmed',
  'ignored',
  'cancelled',
  'error',
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  detected: '検出',
  ordered: '注文済',
  shipped: '発送済',
  confirmed: '確定済',
  auto_confirmed: '自動確定',
  ignored: '無視',
  cancelled: 'キャンセル',
  error: 'エラー',
};

export const MAIL_TYPES = ['order_confirm', 'shipment', 'other'] as const;
export type MailType = (typeof MAIL_TYPES)[number];

export const MAIL_PHASES = ['ordered', 'shipped', 'delivered_optional', 'other'] as const;
export type MailPhase = (typeof MAIL_PHASES)[number];

// --- 通知 ---
export const NOTIFY_TARGET_TYPES = ['all', 'representative', 'specific_user'] as const;
export type NotifyTargetType = (typeof NOTIFY_TARGET_TYPES)[number];

export const NOTIFY_TARGET_TYPE_LABELS: Record<NotifyTargetType, string> = {
  all: '全員',
  representative: '代表者のみ',
  specific_user: '特定ユーザー',
};

export const NOTIFICATION_REASONS = ['days_threshold', 'qty_threshold', 'both'] as const;
export type NotificationReason = (typeof NOTIFICATION_REASONS)[number];

export const NOTIFICATION_REASON_LABELS: Record<NotificationReason, string> = {
  days_threshold: '残日数',
  qty_threshold: '残数しきい値',
  both: '残日数+残数',
};

// --- 在庫補正理由 ---
export const CORRECTION_REASONS = [
  'still_have_more',
  'counted_actual_stock',
  'wrong_import',
  'manual_adjustment',
] as const;
export type CorrectionReason = (typeof CORRECTION_REASONS)[number];

export const CORRECTION_REASON_LABELS: Record<CorrectionReason, string> = {
  still_have_more: 'まだ残っていた',
  counted_actual_stock: '実数を数えた',
  wrong_import: '誤った取込の修正',
  manual_adjustment: '手動調整',
};

// --- ユーザーロール ---
export const USER_ROLES = ['admin', 'member'] as const;
export type UserRole = (typeof USER_ROLES)[number];

// --- 既定値（GAS 版 DEFAULTS 準拠） ---
export const DEFAULTS = {
  /** 配送バッファ日数の初期値（inventory_effective_at = shipped_at + バッファ） */
  DELIVERY_BUFFER_DAYS: 0,
  /** スヌーズ「今回は無視」の場合の抑止日数 */
  SNOOZE_IGNORE_DAYS: 30,
  /** 直近の購入から何日以内ならアラートを抑止するか */
  RECENT_PURCHASE_SUPPRESS_DAYS: 3,
  /** 品目あたりの代替品登録上限 */
  MAX_ALTERNATIVES: 10,
  /** 品目メモの最大文字数 */
  MAX_ITEM_MEMO_LENGTH: 1000,
} as const;

// --- app_config のキー ---
export const APP_CONFIG_KEYS = {
  DELIVERY_BUFFER_DAYS: 'default_delivery_buffer_days',
} as const;
