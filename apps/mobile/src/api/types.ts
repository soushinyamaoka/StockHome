// API レスポンスの型定義（apps/api の serialize.ts と対応）
import type { Alternative } from '@stockhome/shared';

export interface ItemDto {
  id: string;
  itemName: string;
  category: string | null;
  unit: string | null;
  defaultPurchaseQty: number;
  daysPerUnit: number;
  leadDays: number;
  safetyDays: number;
  lowStockThresholdQty: number | null;
  purchaseUrl: string | null;
  alternatives: Alternative[];
  itemMemo: string | null;
  notifyTargetType: string;
  notifyTargetUserId: string | null;
  notificationEnabled: boolean;
  isInventoryUnknown: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotDto {
  itemId: string;
  calculatedAt: string;
  latestPurchaseDate: string | null;
  latestPurchaseQty: number | null;
  estimatedRemainingQty: number | null;
  estimatedDaysLeft: number | null;
  predictedOutOfStockDate: string | null;
  lowStockThresholdQty: number | null;
  daysAlertNeeded: boolean;
  qtyAlertNeeded: boolean;
  alertNeeded: boolean;
}

export interface RuntimeStateDto {
  itemId: string;
  manualOverrideQty: number | null;
  manualOverrideAt: string | null;
  manualOverrideReason: string | null;
  snoozeUntil: string | null;
  lastNotificationReason: string | null;
  lastNotificationAt: string | null;
}

export interface ItemWithStock extends ItemDto {
  snapshot: SnapshotDto | null;
  runtimeState: RuntimeStateDto | null;
}

export interface StockEntry {
  item: ItemDto;
  snapshot: SnapshotDto | null;
  runtimeState: RuntimeStateDto | null;
}

export interface PurchaseDto {
  id: string;
  itemId: string;
  purchasedAt: string;
  qty: number;
  price: number | null;
  source: string;
  sourceType: string;
  externalVendor: string | null;
  externalOrderId: string | null;
  purchasedByUserId: string | null;
  purchasedByUserName: string | null;
  note: string | null;
  fulfillmentStatus: string | null;
  shippedAt: string | null;
  inventoryEffectiveAt: string | null;
  countedInInventory: boolean;
  createdAt: string;
}

export interface PriceStats {
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  latest: number | null;
}

export interface CandidateDto {
  id: string;
  vendor: string;
  mailDate: string;
  orderId: string | null;
  mailType: string;
  mailPhase: string;
  fulfillmentStatus: string | null;
  itemNameRaw: string | null;
  detectedQty: number | null;
  detectedPrice: number | null;
  candidateStatus: string;
  matchedItemId: string | null;
  importedByEmail: string | null;
  rawSubject: string | null;
  rawSnippet: string | null;
  parseResult: string | null;
  createdAt: string;
  updatedAt: string;
  // 確定/自動確定済み候補の購入履歴・在庫への反映状況
  reflection?: {
    matchedItemName: string;
    matchedItemActive: boolean;
    qty: number;
    unit: string | null;
    inventoryEffectiveAt: string | null;
    countedInInventory: boolean;
  };
}

export interface NotificationDto {
  id: string;
  itemId: string;
  itemName: string;
  notificationType: string;
  notificationReason: string;
  message: string;
  createdAt: string;
}

export interface FamilyUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}

export interface DashboardData {
  alerts: StockEntry[];
  /** アラート総件数（alerts は上位5件のみ） */
  alertTotal: number;
  pendingCandidates: number;
  todayNotifications: number;
  totalActiveItems: number;
}
