// 夜間バッチ（GAS 版 BatchController.runDailyBatch の移植）
// 毎日 19:55 JST に実行（GAS の夜間トリガー(20時台) → ReadyGo の 21:00 LINE 配信の前段）
//   1. inventory_effective_at 到来分の counted_in_inventory 更新
//   2. 全品目の在庫計算 → stock_snapshot 更新
//   3. 通知判定（全notify_target_type）
//   4. all のみ集約して ReadyGoOutbox（配信待ちキュー）に積む
//   5. 新規アラートを notify_target_type に応じたユーザーへプッシュ送信
//
// ReadyGo への実投入は GAS 側の夜間トリガーが行う:
//   GAS が GET /api/bridge/readygo-pending でキューを取得
//   → ReadyGo スプレッドシートの Inbox に行追加
//   → POST /api/bridge/readygo-ack → ここで初めて notification_log を記録
// （「Inbox 投入成功時のみ notification_log 記録」という GAS 版の方針を踏襲）
import { Prisma, type Item, type StockSnapshot } from '@prisma/client';
import { appLogger, ERROR_KINDS, LOG_EVENTS, safeErr, type AppLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { updateCountedInInventory, recalculateAllStocks } from './stockCalc';
import { checkPushReceipts, sendPushToUser } from './pushNotify';
import {
  isBroadcastTarget,
  resolveNotifyTargetUserIds,
  type NotifyMember,
} from './notifyTarget';

export interface AlertTarget {
  item: Item;
  snapshot: StockSnapshot;
  reason: string; // days_threshold | qty_threshold | both
}

export interface HouseholdUserAlertGroup {
  householdId: string;
  userId: string;
  targets: AlertTarget[];
}

// 新規アラートを (household, user) 単位でグループ化する。
// 同一userが複数household所属でも、household境界をまたいで1通のメッセージへ
// 混ざらないようにする（S007-B01対応。DB非依存の純粋関数）
export function groupNewAlertsByHouseholdUser(
  targets: AlertTarget[],
  membersByHousehold: Map<string, NotifyMember[]>
): HouseholdUserAlertGroup[] {
  const groups = new Map<string, HouseholdUserAlertGroup>();
  for (const target of targets) {
    const householdMembers = membersByHousehold.get(target.item.householdId) ?? [];
    const userIds = resolveNotifyTargetUserIds(target.item, householdMembers);
    for (const userId of userIds) {
      const key = `${target.item.householdId}:${userId}`;
      const group = groups.get(key) ?? {
        householdId: target.item.householdId,
        userId,
        targets: [],
      };
      group.targets.push(target);
      groups.set(key, group);
    }
  }
  return [...groups.values()];
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
  lineAlerts: number;
  queued: boolean;
  newAlerts: number;
  pushTargeted: number;
  pushAccepted: number;
  readygoSuperseded: number;
  readygoCleaned: number;
  readygoPending: number;
  readygoPendingOldestAgeHours: number | null;
}

export interface RunDailyBatchOptions {
  householdId?: string;
  // テスト専用: batch_run_status.status='failure'記録の回帰testのためだけに、
  // 主要処理の前に強制的に例外を投げる。production呼び出し元（server.ts・
  // routes/dashboard.ts）からは絶対に指定しないこと。
  forceFailureForTest?: boolean;
}

const READYGO_DELIVERED_RETENTION_DAYS = 30;

async function upsertPendingReadyGoRow(
  householdId: string,
  body: string,
  alertsJson: Prisma.InputJsonValue
): Promise<'created' | 'updated'> {
  const now = new Date();
  try {
    await prisma.readyGoOutbox.create({
      data: { householdId, body, alertsJson, status: 'pending', createdAt: now },
    });
    return 'created';
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // A concurrent batch may have created the pending row first. Update it without
      // touching a row already claimed by GAS.
      const updated = await prisma.readyGoOutbox.updateMany({
        where: { householdId, status: 'pending' },
        data: { body, alertsJson, createdAt: now },
      });
      if (updated.count > 0) return 'updated';
      // The pending row may have been claimed between the failed insert and update.
      await prisma.readyGoOutbox.create({
        data: { householdId, body, alertsJson, status: 'pending', createdAt: now },
      });
      return 'created';
    }
    throw e;
  }
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

// A household scope limits every step of this batch to that household.
export async function runDailyBatch(
  logger: AppLogger = appLogger,
  options: RunDailyBatchOptions = {}
): Promise<BatchResult> {
  const runId = dailyBatchRunId();
  const startedAt = Date.now();
  const result: BatchResult = {
    countedUpdated: 0,
    recalculated: 0,
    processed: 0,
    alerts: 0,
    lineAlerts: 0,
    queued: false,
    newAlerts: 0,
    pushTargeted: 0,
    pushAccepted: 0,
    readygoSuperseded: 0,
    readygoCleaned: 0,
    readygoPending: 0,
    readygoPendingOldestAgeHours: null,
  };
  let queuedHouseholds = 0;
  let status: 'success' | 'failure' = 'failure';
  let failureName: string | undefined;
  let failureCode: string | undefined;

  logger.info({ event: LOG_EVENTS.JOB_START, job: 'daily_batch', run_id: runId });

  try {
    if (options.forceFailureForTest) {
      throw new Error('forced failure for test');
    }
    // 前回送信分のreceiptを確認し、実配信できなかった端末を無効化する。
    // 失敗してもバッチ本体を止めない
    try {
      await checkPushReceipts(logger);
    } catch (e) {
      logger.warn({
        event: LOG_EVENTS.PUSH_RECEIPT_CHECK_FAILED,
        error_kind: ERROR_KINDS.INTERNAL,
        job: 'daily_batch',
        run_id: runId,
        err: safeErr(e),
      });
    }

    // Step 1: counted_in_inventory 更新
    result.countedUpdated = await updateCountedInInventory(options.householdId);
    logger.info({
      event: LOG_EVENTS.BATCH_STEP,
      job: 'daily_batch',
      run_id: runId,
      step: 'counted_update',
      counted_updated: result.countedUpdated,
    });

    // 「新規に」アラートになった品目を出すため、再計算前の状態を控える。
    // stock_snapshot は再計算で上書きされるため、事前に読まないと前回値が失われる
    const previousAlerts = new Map<string, boolean>(
      (
        await prisma.stockSnapshot.findMany({
          where: options.householdId ? { householdId: options.householdId } : undefined,
          select: { itemId: true, alertNeeded: true },
        })
      ).map((s) => [s.itemId, s.alertNeeded])
    );

    // Step 2-3: 在庫再計算 & snapshot 更新
    const recalculated = await recalculateAllStocks(options.householdId);
    result.recalculated = recalculated.length;
    logger.info({
      event: LOG_EVENTS.BATCH_STEP,
      job: 'daily_batch',
      run_id: runId,
      step: 'stock_recalc',
      recalculated: result.recalculated,
    });

    // Step 4: 通知対象抽出（通知ON / スヌーズ外 / アラートあり）
    const now = new Date();
    const items = await prisma.item.findMany({
      where: {
        isActive: true,
        notificationEnabled: true,
        ...(options.householdId ? { householdId: options.householdId } : {}),
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

    // 前回 false → 今回 true の品目だけがプッシュ対象。
    // 前回 snapshot が無い品目（新規登録直後など）も「新たに出た」として扱う
    const newTargets = targets.filter((t) => previousAlerts.get(t.item.id) !== true);
    result.newAlerts = newTargets.length;

    // 残日数の少ない順
    targets.sort(
      (a, b) =>
        (a.snapshot.estimatedDaysLeft ?? 0) - (b.snapshot.estimatedDaysLeft ?? 0)
    );

    // LINE は世帯全員が読む一括配信のため、通知先が all の品目だけを載せる
    const lineTargets = targets.filter((target) => isBroadcastTarget(target.item));
    result.lineAlerts = lineTargets.length;

    logger.info({
      event: LOG_EVENTS.BATCH_STEP,
      job: 'daily_batch',
      run_id: runId,
      step: 'alert_evaluation',
      processed: result.processed,
      alerts: result.alerts,
      line_alerts: result.lineAlerts,
    });

    if (lineTargets.length > 0) {
      // household ごとに1メッセージへ集約してキューに積む（実運用は単一家庭）
      const byHousehold = new Map<string, AlertTarget[]>();
      for (const target of lineTargets) {
        const list = byHousehold.get(target.item.householdId) ?? [];
        list.push(target);
        byHousehold.set(target.item.householdId, list);
      }

      for (const [householdId, list] of byHousehold) {
        const outcome = await upsertPendingReadyGoRow(
          householdId,
          buildBroadcastMessage(list),
          list.map((target) => ({
            itemId: target.item.id,
            reason: target.reason,
            line: buildItemSummaryLine(target.item, target.snapshot, target.reason),
          }))
        );
        if (outcome === 'updated') {
          result.readygoSuperseded += 1;
          logger.info({
            event: LOG_EVENTS.READYGO_QUEUE_SUPERSEDED,
            job: 'daily_batch',
            run_id: runId,
            household_id: householdId,
          });
        }
        queuedHouseholds++;
        result.queued = true;
      }
      logger.info({
        event: LOG_EVENTS.READYGO_QUEUED,
        job: 'daily_batch',
        run_id: runId,
        households: queuedHouseholds,
        alerts: result.lineAlerts,
      });
    }

    try {
      const cutoff = new Date(
        Date.now() - READYGO_DELIVERED_RETENTION_DAYS * 24 * 60 * 60 * 1000
      );
      const cleaned = await prisma.readyGoOutbox.deleteMany({
        where: {
          status: 'delivered',
          deliveredAt: { lt: cutoff },
          ...(options.householdId ? { householdId: options.householdId } : {}),
        },
      });
      result.readygoCleaned = cleaned.count;
      if (cleaned.count > 0) {
        logger.info({
          event: LOG_EVENTS.READYGO_OUTBOX_CLEANED,
          job: 'daily_batch',
          run_id: runId,
          deleted: cleaned.count,
          retention_days: READYGO_DELIVERED_RETENTION_DAYS,
        });
      }
    } catch (e) {
      logger.warn({
        event: LOG_EVENTS.BATCH_STEP,
        error_kind: ERROR_KINDS.INTERNAL,
        job: 'daily_batch',
        run_id: runId,
        step: 'readygo_cleanup_failed',
        err: safeErr(e),
      });
    }

    try {
      if (newTargets.length > 0) {
        const householdIds = new Set(newTargets.map((target) => target.item.householdId));
        const members = await prisma.householdMember.findMany({
          where: { householdId: { in: [...householdIds] } },
          select: {
            householdId: true,
            userId: true,
            role: true,
            user: { select: { isActive: true } },
          },
        });
        const membersByHousehold = new Map<string, NotifyMember[]>();
        for (const member of members) {
          const list = membersByHousehold.get(member.householdId) ?? [];
          list.push({
            userId: member.userId,
            role: member.role,
            isActive: member.user.isActive,
          });
          membersByHousehold.set(member.householdId, list);
        }

        const groups = groupNewAlertsByHouseholdUser(newTargets, membersByHousehold);

        for (const { householdId, userId, targets: list } of groups) {
          const title = `そろそろ切れそう（${list.length}件）`;
          const body = list
            .map((t) => buildItemSummaryLine(t.item, t.snapshot, t.reason))
            .join('\n');
          try {
            const push = await sendPushToUser(
              householdId,
              userId,
              title,
              body,
              list.length === 1 ? { itemId: list[0].item.id } : undefined,
              logger
            );
            result.pushTargeted += push.targeted;
            result.pushAccepted += push.accepted;
            logger.info({
              event: LOG_EVENTS.PUSH_DISPATCHED,
              job: 'daily_batch',
              run_id: runId,
              items: list.length,
              targeted: push.targeted,
              accepted: push.accepted,
              failed: push.failed,
              deactivated: push.deactivated,
            });
          } catch (e) {
            // 1ユーザーの送信失敗で、残りのユーザーへの送信を止めない
            logger.warn({
              event: LOG_EVENTS.PUSH_SEND_FAILED,
              error_kind: ERROR_KINDS.INTERNAL,
              job: 'daily_batch',
              run_id: runId,
              err: safeErr(e),
            });
          }
        }
      }
    } catch (e) {
      logger.warn({
        event: LOG_EVENTS.PUSH_SEND_FAILED,
        error_kind: ERROR_KINDS.INTERNAL,
        job: 'daily_batch',
        run_id: runId,
        err: safeErr(e),
      });
    }

    const pendingRows = await prisma.readyGoOutbox.findMany({
      where: {
        status: 'pending',
        ...(options.householdId ? { householdId: options.householdId } : {}),
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    result.readygoPending = pendingRows.length;
    result.readygoPendingOldestAgeHours =
      pendingRows.length > 0
        ? Math.round(((Date.now() - pendingRows[0].createdAt.getTime()) / (60 * 60 * 1000)) * 10) /
          10
        : null;

    status = 'success';
    return result;
  } catch (e) {
    if (e instanceof Error) {
      failureName = e.name;
      failureCode = (e as { code?: string }).code;
    }
    throw e;
  } finally {
    if (!options.householdId) {
      try {
        await prisma.batchRunStatus.upsert({
          where: { jobName: 'daily_batch' },
          create: {
            jobName: 'daily_batch',
            status,
            runId,
            ranAt: new Date(startedAt),
            durationMs: Date.now() - startedAt,
            errorName: status === 'failure' ? (failureName ?? null) : null,
          },
          update: {
            status,
            runId,
            ranAt: new Date(startedAt),
            durationMs: Date.now() - startedAt,
            errorName: status === 'failure' ? (failureName ?? null) : null,
          },
        });
      } catch {
        // 状態記録自体の失敗でjob_endログや本来のバッチ結果を握りつぶさない
      }
    }

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
      line_alerts: result.lineAlerts,
      new_alerts: result.newAlerts,
      push_targeted: result.pushTargeted,
      push_accepted: result.pushAccepted,
      households: queuedHouseholds,
      queued: result.queued,
      readygo_pending: result.readygoPending,
      readygo_pending_oldest_age_h: result.readygoPendingOldestAgeHours,
      readygo_superseded: result.readygoSuperseded,
      readygo_cleaned: result.readygoCleaned,
      ...(status === 'failure' ? { error_name: failureName, error_code: failureCode } : {}),
    };
    if (status === 'success') logger.info(line);
    else logger.error(line);
  }
}
