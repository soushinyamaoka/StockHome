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
//
// 買い足し累積: counted 化する購入は「直前の推定残数＋今回の購入数」を manual_override_qty
// として積み上げる（setManualOverrideQty）。購入のたびに残数を上書きするのではなく、
// 既存の在庫に買い足した分を足していく（手動・Gmail取込確定・夜間バッチ経由の全ルート共通）。
// 数え直したい場合は既存の「在庫補正」機能（correctionInputSchema）で実数を設定する
import type { Item, ItemRuntimeState, PurchaseLog, Prisma } from '@prisma/client';
import { DEFAULTS } from '@stockhome/shared';
import { prisma } from '../lib/prisma';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 任意の日時を「ローカルタイムゾーンのカレンダー日付」で UTC 0時の Date に丸める。
// 本番コンテナ・開発環境とも TZ=Asia/Tokyo のため、ローカルgetterはJSTのカレンダー日付を返す
// （docker-compose.prod.yml参照）。DB の date 型は UTC 0時で保持しているため、
// 比較はこの形式で揃える
function dateOnlyLocal(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

// 今日（JST のカレンダー日付）を UTC 0時の Date で返す
export function todayDateOnly(): Date {
  return dateOnlyLocal(new Date());
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
export async function getLatestCountedPurchase(
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

  // 補正の基準日（JSTのカレンダー日付、todayDateOnyと同じ丸め方に揃える）。
  // 以前はUTC日付で丸めていたため、JST 0時〜9時台に書き込まれた補正が
  // todayDateOnly()（JST基準）とズレて即座に1日分減衰する不具合があった（修正済み）
  const overrideDate = hasOverride && state ? dateOnlyLocal(state.manualOverrideAt!) : null;

  // 補正と最新購入のうち「より新しい基準イベント」を起点にする。
  // 通常、counted 化した購入は登録時に setManualOverrideQty で「直前残数＋購入数」を
  // 補正値として積み上げるため override が常に最新となるが、念のためのフォールバックとして
  // 万一 override 側が更新されないまま古い状態で残った場合でも、より新しい購入があれば
  // そちらを優先する（例: 外部要因で override 更新が失敗した場合等）。
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

// 品目の「現時点の推定残数」を、保存済み snapshot に頼らずその場で計算する。
// 買い足し累積（積み上げ）計算のベース値取得に使う。呼び出し時点でまだ加味されていない
// 新しい購入を加える"前"の状態を表すため、呼び出し側は対象購入を作成/counted化する前に呼ぶこと。
// ロックは持たないため、直列化が必要な呼び出し元は先に lockItemForAccumulation を呼ぶこと
export async function getCurrentEstimatedRemainingQty(
  tx: Prisma.TransactionClient,
  itemId: string
): Promise<number> {
  const item = await tx.item.findUnique({
    where: { id: itemId },
    include: { runtimeState: true },
  });
  if (!item) return 0;
  const latestPurchase = await getLatestCountedPurchase(tx, itemId);
  const calc = calculateStock(item, latestPurchase);
  return calc.estimatedRemainingQty ?? 0;
}

// 手動補正値（item_runtime_state）を指定の残数で設定する（積み上げ結果の書き込み用）
export async function setManualOverrideQty(
  tx: Prisma.TransactionClient,
  itemId: string,
  householdId: string,
  qty: number,
  byUserId: string | null,
  reason: string
): Promise<void> {
  const rounded = Math.max(0, Math.round(qty * 100) / 100);
  const now = new Date();
  await tx.itemRuntimeState.upsert({
    where: { itemId },
    create: {
      householdId,
      itemId,
      manualOverrideQty: rounded,
      manualOverrideAt: now,
      manualOverrideByUserId: byUserId,
      manualOverrideReason: reason,
    },
    update: {
      manualOverrideQty: rounded,
      manualOverrideAt: now,
      manualOverrideByUserId: byUserId,
      manualOverrideReason: reason,
    },
  });
}

// 買い足し累積で設定した補正値かどうか（購入取消時の差し戻し判定に使う）
export function isAccumulatedOverrideReason(reason: string | null | undefined): boolean {
  return !!reason && reason.startsWith('purchase_accumulated');
}

// 積み上げ由来の補正値から、指定品目の購入取消分を差し引く（購入取消の差し戻し用）。
// 完全に正確な巻き戻しではない（その後の別の積み上げ・補正で上書きされていればズレうる）が、
// 直近の誤登録取り消しという想定用途では妥当な範囲。品目行をロックしてから読み書きするため、
// 同時実行中の購入登録・夜間バッチと競合しない（VPS管理レビューB01対応）
export async function reverseAccumulatedPurchase(
  tx: Prisma.TransactionClient,
  itemId: string,
  qty: number
): Promise<void> {
  await lockItemForAccumulation(tx, itemId);
  const state = await tx.itemRuntimeState.findUnique({ where: { itemId } });
  if (state?.manualOverrideQty != null && isAccumulatedOverrideReason(state.manualOverrideReason)) {
    await tx.itemRuntimeState.update({
      where: { itemId },
      data: { manualOverrideQty: Math.max(0, state.manualOverrideQty - qty) },
    });
  }
}

// 品目単位の直列化ロック（VPS管理レビューB01対応）。
// 同一品目への同時書き込み（手動購入・Gmail確定・夜間バッチが同時に走るケース）で、
// 「読み取り→積み上げ→書き込み」が競合して片方の加算が失われないよう、
// items 行（常に存在する）を SELECT ... FOR UPDATE でロックし、後続の同一品目トランザクションを
// 直列化する。item_runtime_state は初回はまだ行が無いことがあるためロック対象にできない
export async function lockItemForAccumulation(tx: Prisma.TransactionClient, itemId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM items WHERE id = ${itemId} FOR UPDATE`;
}

// 買い足し累積の一連処理（ロック→現時点の推定残数取得→積み上げ書き込み）をまとめた関数。
// 呼び出し元は、購入行の作成と同一トランザクション（tx）内でこれを呼ぶことで、
// 「購入は作成されたが積み上げは書き込まれない」という不整合（VPS管理レビューB01）を防ぐ
export async function accumulatePurchaseIntoStock(
  tx: Prisma.TransactionClient,
  itemId: string,
  householdId: string,
  purchaseQty: number,
  byUserId: string | null,
  reason: string
): Promise<void> {
  await lockItemForAccumulation(tx, itemId);
  const baseQty = await getCurrentEstimatedRemainingQty(tx, itemId);
  await setManualOverrideQty(tx, itemId, householdId, baseQty + purchaseQty, byUserId, reason);
}

interface PendingPurchase {
  id: string;
  itemId: string;
  householdId: string;
  qty: number;
}

// 品目1件分の pending 購入（counted_in_inventory=false かつ inventory_effective_at 到来済み）を
// 購入日の古い順に処理する。1品目分をまるごと1トランザクションに包むため、途中で失敗した場合は
// その品目の counted 化・積み上げが両方ロールバックされ、次回バッチで安全に再試行できる
// （VPS管理レビューB01対応。テストから直接呼べるよう個別exportする）。
//
// 引数の purchases は、呼び出し元（updateCountedInInventory）がトランザクション開始前に
// 取得した一覧であり、ロック取得までの間に他の実行によって処理済みになっている可能性がある
// （夜間バッチの二重起動、手動再実行との競合等）。そのため、ロック取得後に必ずDB上の
// 最新状態を再取得し、その時点でなお counted_in_inventory=false の行だけを対象にする
// （VPS管理レビューB07対応: 同じpending一覧を読んだ2つの実行が二重加算する不具合の修正）
export async function processPendingPurchasesForItem(
  tx: Prisma.TransactionClient,
  itemId: string,
  purchases: PendingPurchase[]
): Promise<number> {
  if (purchases.length === 0) return 0;
  await lockItemForAccumulation(tx, itemId);

  const candidateIds = purchases.map((p) => p.id);
  const stillPending = await tx.purchaseLog.findMany({
    where: { id: { in: candidateIds }, itemId, countedInInventory: false },
    select: { id: true, qty: true, householdId: true },
    orderBy: [{ purchasedAt: 'asc' }, { createdAt: 'asc' }],
  });
  // 呼び出し元一覧の全件が既に他実行で処理済みだった場合、何もしない
  // （二重起動時の後続実行はここで早期終了する。B07対応）
  if (stillPending.length === 0) return 0;

  let running = await getCurrentEstimatedRemainingQty(tx, itemId);
  for (const purchase of stillPending) {
    await tx.purchaseLog.update({
      where: { id: purchase.id },
      data: { countedInInventory: true },
    });
    running += purchase.qty;
  }
  await setManualOverrideQty(
    tx,
    itemId,
    stillPending[0].householdId,
    running,
    null,
    'purchase_accumulated_batch'
  );
  return stillPending.length;
}

// inventory_effective_at 到来分の counted_in_inventory を true 化する（夜間バッチ Step 1）。
// counted 化する購入は品目ごとに購入日の古い順で「直前の推定残数＋購入数」を積み上げ、
// 手動補正値として反映する（買い足しの累積）。これにより、確定時点ではまだ counted で
// なかった Gmail 取込購入（配送バッファ設定により未来日付になっていたもの）も、
// 実際に在庫へ反映されるこのタイミングで同様に積み上がる。
//
// 品目単位で1トランザクションに包む（processPendingPurchasesForItem）ため、ある品目の処理中に
// 失敗しても、その品目の購入は counted_in_inventory=false のまま残り、次回のバッチ実行が
// 自然に再試行対象とする（二重加算しない。VPS管理レビューB01/B02対応）。既に処理済みの
// 他品目の結果は別トランザクションのため影響を受けない
export async function updateCountedInInventory(householdId?: string): Promise<number> {
  const today = todayDateOnly();
  const pending = await prisma.purchaseLog.findMany({
    where: {
      ...(householdId ? { householdId } : {}),
      countedInInventory: false,
      inventoryEffectiveAt: { not: null, lte: today },
    },
    orderBy: [{ purchasedAt: 'asc' }, { createdAt: 'asc' }],
  });
  if (pending.length === 0) return 0;

  const byItem = new Map<string, typeof pending>();
  for (const p of pending) {
    const list = byItem.get(p.itemId) ?? [];
    list.push(p);
    byItem.set(p.itemId, list);
  }

  let count = 0;
  for (const [itemId, list] of byItem) {
    // 実際に処理された件数（二重起動等で他実行に処理済みだった分を除く）を積算する。
    // list.length をそのまま足すと、二重起動時に実処理を伴わない実行分まで
    // カウントしてしまう（B07対応）
    count += await prisma.$transaction((tx) => processPendingPurchasesForItem(tx, itemId, list));
  }
  return count;
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
