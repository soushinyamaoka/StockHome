// 夜間バッチ（GAS 版 BatchController.runDailyBatch の移植）
// 毎日 19:55 JST に実行（GAS の夜間トリガー(20時台) → ReadyGo の 21:00 LINE 配信の前段）
//   1. inventory_effective_at 到来分の counted_in_inventory 更新
//   2. 全品目の在庫計算 → stock_snapshot 更新
//   3. 通知判定（notify_target_type=all のみ）→ 集約メッセージ生成
//   4. ReadyGoOutbox（配信待ちキュー）に積む
//
// ReadyGo への実投入は GAS 側の夜間トリガーが行う:
//   GAS が GET /api/bridge/readygo-pending でキューを取得
//   → ReadyGo スプレッドシートの Inbox に行追加
//   → POST /api/bridge/readygo-ack → ここで初めて notification_log を記録
// （「Inbox 投入成功時のみ notification_log 記録」という GAS 版の方針を踏襲）
import type { Item, StockSnapshot } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { updateCountedInInventory, recalculateAllStocks } from './stockCalc';

interface AlertTarget {
  item: Item;
  snapshot: StockSnapshot;
  reason: string; // days_threshold | qty_threshold | both
}

function resolveReason(s: StockSnapshot): string {
  if (s.daysAlertNeeded && s.qtyAlertNeeded) return 'both';
  if (s.qtyAlertNeeded) return 'qty_threshold';
  return 'days_threshold';
}

// 1品目の1行要約（GAS buildItemSummaryLine_ 準拠）
function buildItemSummaryLine(item: Item, s: StockSnapshot, reason: string): string {
  const name = item.itemName;
  const daysLeft = Math.round(s.estimatedDaysLeft ?? 0);
  const remainQty = Math.round((s.estimatedRemainingQty ?? 0) * 10) / 10;
  const remainStr = `${remainQty}${item.unit ?? ''}`;

  switch (reason) {
    case 'days_threshold':
      return `${name}：残${daysLeft}日`;
    case 'qty_threshold':
      return `${name}：しきい値以下 (残${remainStr})`;
    case 'both':
      return `${name}：残${daysLeft}日 / 残${remainStr}`;
    default:
      return name;
  }
}

// 集約メッセージ（GAS buildBroadcastMessage_ 準拠）
function buildBroadcastMessage(targets: AlertTarget[]): string {
  const lines: string[] = [];
  lines.push(`📦 在庫アラート (${targets.length}件)`);
  lines.push('');
  for (const t of targets) {
    lines.push(`・${buildItemSummaryLine(t.item, t.snapshot, t.reason)}`);
  }
  lines.push('');
  lines.push('→ StockHomeアプリの在庫予測で確認');
  return lines.join('\n');
}

export interface BatchResult {
  countedUpdated: number;
  recalculated: number;
  processed: number;
  alerts: number;
  queued: boolean;
}

export async function runDailyBatch(): Promise<BatchResult> {
  console.log('=== 夜間バッチ開始 ===');
  const started = Date.now();

  // Step 1: counted_in_inventory 更新
  const countedUpdated = await updateCountedInInventory();

  // Step 2-3: 在庫再計算 & snapshot 更新
  const recalculated = await recalculateAllStocks();

  // Step 4: 通知対象抽出（notify_target_type=all / 通知ON / スヌーズ外 / アラートあり）
  const now = new Date();
  const items = await prisma.item.findMany({
    where: {
      isActive: true,
      notificationEnabled: true,
      notifyTargetType: 'all',
    },
    include: { stockSnapshot: true, runtimeState: true },
  });

  const targets: AlertTarget[] = [];
  for (const item of items) {
    const s = item.stockSnapshot;
    if (!s || !s.alertNeeded || s.estimatedRemainingQty == null) continue;
    if (item.runtimeState?.snoozeUntil && item.runtimeState.snoozeUntil > now) continue;
    targets.push({ item, snapshot: s, reason: resolveReason(s) });
  }

  // 残日数の少ない順
  targets.sort((a, b) => (a.snapshot.estimatedDaysLeft ?? 0) - (b.snapshot.estimatedDaysLeft ?? 0));

  let queued = false;

  if (targets.length === 0) {
    console.log('[batch] アラート対象なし。ReadyGo キュー投入はスキップ。');
  } else {
    // household ごとに1メッセージへ集約してキューに積む（実運用は単一家庭）
    const byHousehold = new Map<string, AlertTarget[]>();
    for (const t of targets) {
      const list = byHousehold.get(t.item.householdId) ?? [];
      list.push(t);
      byHousehold.set(t.item.householdId, list);
    }

    for (const [householdId, list] of byHousehold) {
      await prisma.readyGoOutbox.create({
        data: {
          householdId,
          body: buildBroadcastMessage(list),
          alertsJson: list.map((t) => ({
            itemId: t.item.id,
            reason: t.reason,
            line: buildItemSummaryLine(t.item, t.snapshot, t.reason),
          })),
        },
      });
    }
    queued = true;
    console.log(`[batch] ReadyGo キューに ${byHousehold.size} 件投入（アラート ${targets.length} 品目）`);
  }

  const elapsed = (Date.now() - started) / 1000;
  console.log(
    `=== 夜間バッチ完了 (${elapsed}秒) counted=${countedUpdated}, recalc=${recalculated.length}, alerts=${targets.length} ===`
  );

  return {
    countedUpdated,
    recalculated: recalculated.length,
    processed: items.length,
    alerts: targets.length,
    queued,
  };
}
