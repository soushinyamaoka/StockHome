// DB → API レスポンス変換
// 日付（date 型）は 'YYYY-MM-DD' 文字列に、日時は ISO 文字列に揃える
import type {
  Item,
  PurchaseLog,
  StockSnapshot,
  ItemRuntimeState,
  ImportOrderCandidate,
  StockCorrectionLog,
  NotificationLog,
} from '@prisma/client';
import { candidatePriceReliability, CERTAIN_UNIT_PRICE_SOURCES } from '../services/candidateIntake';
import { formatDateOnly } from './date';

export function serializeItem(item: Item) {
  return {
    id: item.id,
    itemName: item.itemName,
    category: item.category,
    unit: item.unit,
    defaultPurchaseQty: item.defaultPurchaseQty,
    daysPerUnit: item.daysPerUnit,
    leadDays: item.leadDays,
    safetyDays: item.safetyDays,
    lowStockThresholdQty: item.lowStockThresholdQty,
    purchaseUrl: item.purchaseUrl,
    alternatives: item.alternatives,
    itemMemo: item.itemMemo,
    notifyTargetType: item.notifyTargetType,
    notifyTargetUserId: item.notifyTargetUserId,
    notificationEnabled: item.notificationEnabled,
    isInventoryUnknown: item.isInventoryUnknown,
    isActive: item.isActive,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function serializePurchase(p: PurchaseLog) {
  return {
    id: p.id,
    itemId: p.itemId,
    purchasedAt: formatDateOnly(p.purchasedAt),
    qty: p.qty,
    price: p.price,
    source: p.source,
    sourceType: p.sourceType,
    externalVendor: p.externalVendor,
    externalOrderId: p.externalOrderId,
    purchasedByUserId: p.purchasedByUserId,
    purchasedByUserName: p.purchasedByUserName,
    note: p.note,
    fulfillmentStatus: p.fulfillmentStatus,
    shippedAt: formatDateOnly(p.shippedAt),
    inventoryEffectiveAt: formatDateOnly(p.inventoryEffectiveAt),
    countedInInventory: p.countedInInventory,
    createdAt: p.createdAt.toISOString(),
  };
}

export function serializeSnapshot(s: StockSnapshot) {
  return {
    itemId: s.itemId,
    calculatedAt: s.calculatedAt.toISOString(),
    latestPurchaseDate: formatDateOnly(s.latestPurchaseDate),
    latestPurchaseQty: s.latestPurchaseQty,
    estimatedRemainingQty: s.estimatedRemainingQty,
    estimatedDaysLeft: s.estimatedDaysLeft,
    predictedOutOfStockDate: formatDateOnly(s.predictedOutOfStockDate),
    lowStockThresholdQty: s.lowStockThresholdQty,
    daysAlertNeeded: s.daysAlertNeeded,
    qtyAlertNeeded: s.qtyAlertNeeded,
    alertNeeded: s.alertNeeded,
  };
}

export function serializeRuntimeState(s: ItemRuntimeState | null) {
  if (!s) return null;
  return {
    itemId: s.itemId,
    manualOverrideQty: s.manualOverrideQty,
    manualOverrideAt: s.manualOverrideAt?.toISOString() ?? null,
    manualOverrideReason: s.manualOverrideReason,
    snoozeUntil: s.snoozeUntil?.toISOString() ?? null,
    lastNotificationReason: s.lastNotificationReason,
    lastNotificationAt: s.lastNotificationAt?.toISOString() ?? null,
  };
}

export function serializeCandidate(c: ImportOrderCandidate) {
  const price = candidatePriceReliability(c.detectedQty, c.detectedPrice);
  return {
    id: c.id,
    vendor: c.vendor,
    mailDate: c.mailDate.toISOString(),
    orderId: c.orderId,
    mailType: c.mailType,
    mailPhase: c.mailPhase,
    fulfillmentStatus: c.fulfillmentStatus,
    itemNameRaw: c.itemNameRaw,
    detectedQty: c.detectedQty,
    detectedPrice: c.detectedPrice,
    candidateStatus: c.candidateStatus,
    matchedItemId: c.matchedItemId,
    importedByEmail: c.importedByEmail,
    rawSubject: c.rawSubject,
    rawSnippet: c.rawSnippet,
    parseResult: c.parseResult,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    priceReliable: price.reliable,
    priceHoldReason: price.holdReason,
    // 品目に依存せず「パーサーが単価と明示済み」かどうか。true なら sets>1 でも
    // 品目を選んで確定するだけで単価が自動確定する見込みが高い
    // （実際の確定可否は品目確定時の3層判定に依存する。ここは一覧表示用の目安）
    priceLikelyUnitPrice: c.priceSource != null && CERTAIN_UNIT_PRICE_SOURCES.has(c.priceSource),
  };
}

export function serializeCorrection(c: StockCorrectionLog) {
  return {
    id: c.id,
    itemId: c.itemId,
    correctedAt: c.correctedAt.toISOString(),
    correctedByUserName: c.correctedByUserName,
    beforeEstimatedQty: c.beforeEstimatedQty,
    correctedQty: c.correctedQty,
    correctionReason: c.correctionReason,
    note: c.note,
  };
}

export function serializeNotification(n: NotificationLog) {
  return {
    id: n.id,
    itemId: n.itemId,
    notificationType: n.notificationType,
    notificationReason: n.notificationReason,
    message: n.message,
    createdAt: n.createdAt.toISOString(),
  };
}
