// 在庫計算サービス
// GAS 版 StockService.gs / PurchaseService.updateCountedInInventory の移植
//
// 在庫計算ロジック（仕様書 Section 13）:
//   1. counted_in_inventory = true の最新購入履歴を使う
//   2. manual_override_qty がある場合は補正日時起点で優先
//   3. 推定消費量 = 経過日数 / days_per_unit
//   4. 推定残数が負なら 0
//   5. 推定残日数 = max(0, 推定残数 * days_per_unit)
//   6. アラート: 残日数 <= lead_days + safety_days OR 残数 <= しきい値
//   例外: is_inventory_unknown は常にアラート無効 /
//         inventory_effective_at から3日以内は通知抑止
import type { Item, ItemRuntimeState, PurchaseLog, Prisma } from '@prisma/client';
import { DEFAULTS } from '@stockhome/shared';
import { prisma } from '../lib/prisma';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 今日（JST のカレンダー日付）を UTC 0時の Date で返す
// DB の date 型は UTC 0時で保持しているため、比較はこの形式で揃える
export function todayDateOnly(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

// 日付差（a - b、日数）。両方 UTC 0時前提
function diffDays(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / MS_PER_DAY);
}

export interface StockCalcResult {
  itemId: string;
  calculatedAt: Date;
  latestPurchaseDate: Date | null;
  latestPurchaseQty: number | null;
  estimatedRemainingQty: number | null;
  estimatedDaysLeft: number | null;
  predictedOutOfStockDate: Date | null;
  lowStockThresholdQty: number | null;
  daysAlertNeeded: boolean;
  qtyAlertNeeded: boolean;
  alertNeeded: boolean;
}

type ItemWithState = Item & {
  runtimeState: ItemRuntimeState | null;
};

// counted_in_inventory=true の最新購入（purchased_at 降順の先頭）
async function getLatestCountedPurchase(
  tx: Prisma.TransactionClient,
  itemId: string
): Promise<PurchaseLog | null> {
  return tx.purchaseLog.findFirst({
    where: { itemId, countedInInventory: true },
    orderBy: [{ purchasedAt: 'desc' }, { createdAt: 'desc' }],
  });
}

// 1品目の在庫を計算する（純粋計算。DB 書き込みなし）
export function calculateStock(
  item: ItemWithState,
  latestPurchase: PurchaseLog | null,
  today: Date = todayDateOnly()
): StockCalcResult {
  const daysPerUnit = item.daysPerUnit > 0 ? item.daysPerUnit : 1;
  const threshold = item.lowStockThresholdQty;

  const result: StockCalcResult = {
    itemId: item.id,
    calculatedAt: new Date(),
    latestPurchaseDate: null,
    latestPurchaseQty: null,
    estimatedRemainingQty: null,
    estimatedDaysLeft: null,
    predictedOutOfStockDate: null,
    lowStockThresholdQty: threshold ?? null,
    daysAlertNeeded: false,
    qtyAlertNeeded: false,
    alertNeeded: false,
  };

  const state = item.runtimeState;
  const hasOverride =
    state != null && state.manualOverrideQty != null && state.manualOverrideAt != null;

  // 補正の基準日（UTC 日付）
  const overrideDate =
    hasOverride && state
      ? new Date(
          Date.UTC(
            state.manualOverrideAt!.getUTCFullYear(),
            state.manualOverrideAt!.getUTCMonth(),
            state.manualOverrideAt!.getUTCDate()
          )
        )
      : null;

  // 補正と最新購入のうち「より新しい基準イベント」を起点にする。
  // 補正日より後の購入（補正後に買い足した分）は補正を上書きして在庫へ反映する。
  // GAS では手動購入時のみ override をクリアしていたが、候補確定経由の購入はクリアされず
  // 古い補正が残って在庫へ反映されなかった。計算側で新しい方を選ぶことで全経路を正す。
  let useOverride = false;
  if (hasOverride && overrideDate) {
    useOverride = !latestPurchase || diffDays(latestPurchase.purchasedAt, overrideDate) <= 0;
  }

  if (!latestPurchase && !useOverride) {
    // 購入履歴も（有効な）補正もなければ在庫不明
    return result;
  }

  // --- 推定残数 ---
  let estimatedRemainingQty: number;
  if (useOverride && state && overrideDate) {
    // 補正値起点: 補正日時からの消費を引く
    const daysSinceOverride = Math.max(0, diffDays(today, overrideDate));
    estimatedRemainingQty = state.manualOverrideQty! - daysSinceOverride / daysPerUnit;
    if (latestPurchase) {
      result.latestPurchaseDate = latestPurchase.purchasedAt;
      result.latestPurchaseQty = latestPurchase.qty;
    }
  } else if (latestPurchase) {
    // 通常計算: 最新購入日からの消費を引く
    result.latestPurchaseDate = latestPurchase.purchasedAt;
    result.latestPurchaseQty = latestPurchase.qty;
    const daysSincePurchase = Math.max(0, diffDays(today, latestPurchase.purchasedAt));
    estimatedRemainingQty = latestPurchase.qty - daysSincePurchase / daysPerUnit;
  } else {
    return result;
  }

  estimatedRemainingQty = Math.max(0, estimatedRemainingQty);
  estimatedRemainingQty = Math.round(estimatedRemainingQty * 100) / 100;

  let estimatedDaysLeft = Math.max(0, estimatedRemainingQty * daysPerUnit);
  estimatedDaysLeft = Math.round(estimatedDaysLeft * 10) / 10;

  const predicted = new Date(today.getTime() + estimatedDaysLeft * MS_PER_DAY);
  const predictedOutOfStockDate = new Date(
    Date.UTC(predicted.getUTCFullYear(), predicted.getUTCMonth(), predicted.getUTCDate())
  );

  // --- 通知判定 ---
  let daysAlertNeeded = estimatedDaysLeft <= item.leadDays + item.safetyDays;
  let qtyAlertNeeded = threshold != null ? estimatedRemainingQty <= threshold : false;
  let alertNeeded = daysAlertNeeded || qtyAlertNeeded;

  // 在庫不明フラグの品目はアラート対象外
  if (item.isInventoryUnknown) {
    daysAlertNeeded = false;
    qtyAlertNeeded = false;
    alertNeeded = false;
  }

  // 最近購入後の通知抑止（inventory_effective_at から3日以内）
  if (alertNeeded && latestPurchase?.inventoryEffectiveAt) {
    const daysSinceEffective = diffDays(today, latestPurchase.inventoryEffectiveAt);
    if (daysSinceEffective >= 0 && daysSinceEffective < DEFAULTS.RECENT_PURCHASE_SUPPRESS_DAYS) {
      daysAlertNeeded = false;
      qtyAlertNeeded = false;
      alertNeeded = false;
    }
  }

  result.estimatedRemainingQty = estimatedRemainingQty;
  result.estimatedDaysLeft = estimatedDaysLeft;
  result.predictedOutOfStockDate = predictedOutOfStockDate;
  result.daysAlertNeeded = daysAlertNeeded;
  result.qtyAlertNeeded = qtyAlertNeeded;
  result.alertNeeded = alertNeeded;
  return result;
}

// 計算結果を stock_snapshot に upsert する
async function saveSnapshot(
  tx: Prisma.TransactionClient,
  householdId: string,
  calc: StockCalcResult
) {
  const data = {
    householdId,
    calculatedAt: calc.calculatedAt,
    latestPurchaseDate: calc.latestPurchaseDate,
    latestPurchaseQty: calc.latestPurchaseQty,
    estimatedRemainingQty: calc.estimatedRemainingQty,
    estimatedDaysLeft: calc.estimatedDaysLeft,
    predictedOutOfStockDate: calc.predictedOutOfStockDate,
    lowStockThresholdQty: calc.lowStockThresholdQty,
    daysAlertNeeded: calc.daysAlertNeeded,
    qtyAlertNeeded: calc.qtyAlertNeeded,
    alertNeeded: calc.alertNeeded,
  };
  await tx.stockSnapshot.upsert({
    where: { itemId: calc.itemId },
    create: { itemId: calc.itemId, ...data },
    update: data,
  });
}

// 指定品目の在庫を再計算し snapshot に即時反映する
// 書き込み系処理（購入登録・補正・候補確定）の直後に呼ぶ
export async function refreshStockSnapshotForItem(
  itemId: string,
  tx: Prisma.TransactionClient = prisma
): Promise<StockCalcResult | null> {
  const item = await tx.item.findUnique({
    where: { id: itemId },
    include: { runtimeState: true },
  });
  if (!item) return null;

  const latestPurchase = await getLatestCountedPurchase(tx, itemId);
  const calc = calculateStock(item, latestPurchase);
  await saveSnapshot(tx, item.householdId, calc);
  return calc;
}

// inventory_effective_at 到来分の counted_in_inventory を true 化する（夜間バッチ Step 1）
export async function updateCountedInInventory(householdId?: string): Promise<number> {
  const today = todayDateOnly();
  const result = await prisma.purchaseLog.updateMany({
    where: {
      ...(householdId ? { householdId } : {}),
      countedInInventory: false,
      inventoryEffectiveAt: { not: null, lte: today },
    },
    data: { countedInInventory: true },
  });
  return result.count;
}

// 全有効品目の在庫を再計算して snapshot を更新する
export async function recalculateAllStocks(householdId?: string): Promise<StockCalcResult[]> {
  const items = await prisma.item.findMany({
    where: { isActive: true, ...(householdId ? { householdId } : {}) },
    include: { runtimeState: true },
  });

  const results: StockCalcResult[] = [];
  for (const item of items) {
    const latestPurchase = await getLatestCountedPurchase(prisma, item.id);
    const calc = calculateStock(item, latestPurchase);
    await saveSnapshot(prisma, item.householdId, calc);
    results.push(calc);
  }
  return results;
}
