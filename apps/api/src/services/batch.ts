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
import { appLogger, LOG_EVENTS, type AppLogger } from '../lib/logger';
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

function dailyBatchRunId(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return (
    `${value('year')}${value('month')}${value('day')}-` +
    `${value('hour')}${value('minute')}${value('second')}`
  );
}

export async function runDailyBatch(logger: AppLogger = appLogger): Promise<BatchResult> {
  const runId = dailyBatchRunId();
  const startedAt = Date.now();
  const result: BatchResult = {
    countedUpdated: 0,
    recalculated: 0,
    processed: 0,
    alerts: 0,
    queued: false,
  };
  let queuedHouseholds = 0;
  let status: 'success' | 'failure' = 'failure';
  let failureName: string | undefined;
  let failureCode: string | undefined;

  logger.info({ event: LOG_EVENTS.JOB_START, job: 'daily_batch', run_id: runId });

  try {
    // Step 1: counted_in_inventory 更新
    result.countedUpdated = await updateCountedInInventory();
    logger.info({
      event: LOG_EVENTS.BATCH_STEP,
      job: 'daily_batch',
      run_id: runId,
      step: 'counted_update',
      counted_updated: result.countedUpdated,
    });

    // Step 2-3: 在庫再計算 & snapshot 更新
    const recalculated = await recalculateAllStocks();
    result.recalculated = recalculated.length;
    logger.info({
      event: LOG_EVENTS.BATCH_STEP,
      job: 'daily_batch',
      run_id: runId,
      step: 'stock_recalc',
      recalculated: result.recalculated,
    });

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
    result.processed = items.length;

    const targets: AlertTarget[] = [];
    for (const item of items) {
      const snapshot = item.stockSnapshot;
      if (!snapshot || !snapshot.alertNeeded || snapshot.estimatedRemainingQty == null) continue;
      if (item.runtimeState?.snoozeUntil && item.runtimeState.snoozeUntil > now) continue;
      targets.push({ item, snapshot, reason: resolveReason(snapshot) });
    }
    result.alerts = targets.length;

    // 残日数の少ない順
    targets.sort(
      (a, b) =>
        (a.snapshot.estimatedDaysLeft ?? 0) - (b.snapshot.estimatedDaysLeft ?? 0)
    );

    logger.info({
      event: LOG_EVENTS.BATCH_STEP,
      job: 'daily_batch',
      run_id: runId,
      step: 'alert_evaluation',
      processed: result.processed,
      alerts: result.alerts,
    });

    if (targets.length > 0) {
      // household ごとに1メッセージへ集約してキューに積む（実運用は単一家庭）
      const byHousehold = new Map<string, AlertTarget[]>();
      for (const target of targets) {
        const list = byHousehold.get(target.item.householdId) ?? [];
        list.push(target);
        byHousehold.set(target.item.householdId, list);
      }

      for (const [householdId, list] of byHousehold) {
        await prisma.readyGoOutbox.create({
          data: {
            householdId,
            body: buildBroadcastMessage(list),
            alertsJson: list.map((target) => ({
              itemId: target.item.id,
              reason: target.reason,
              line: buildItemSummaryLine(target.item, target.snapshot, target.reason),
            })),
          },
        });
        queuedHouseholds++;
        result.queued = true;
      }
      logger.info({
        event: LOG_EVENTS.READYGO_QUEUED,
        job: 'daily_batch',
        run_id: runId,
        households: queuedHouseholds,
        alerts: result.alerts,
      });
    }

    status = 'success';
    return result;
  } catch (e) {
    if (e instanceof Error) {
      failureName = e.name;
      failureCode = (e as { code?: string }).code;
    }
    throw e;
  } finally {
    const line = {
      event: LOG_EVENTS.JOB_END,
      job: 'daily_batch',
      run_id: runId,
      status,
      duration_ms: Date.now() - startedAt,
      counted_updated: result.countedUpdated,
      recalculated: result.recalculated,
      processed: result.processed,
      alerts: result.alerts,
      households: queuedHouseholds,
      queued: result.queued,
      ...(status === 'failure' ? { error_name: failureName, error_code: failureCode } : {}),
    };
    if (status === 'success') logger.info(line);
    else logger.error(line);
  }
}
