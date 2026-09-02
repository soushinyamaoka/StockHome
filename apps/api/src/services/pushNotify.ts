// Expo Push 通知の送信
// 仕様: https://docs.expo.dev/push-notifications/sending-notifications/
// - 送信先は household 内の is_active=true な端末のみ
// - Expo は1リクエスト最大100件までなので分割して送る
// - DeviceNotRegistered が返った端末は is_active=false にして以後の対象から外す
// - 送信失敗はバッチ全体を止めない（ログに残して継続する）
import { appLogger, ERROR_KINDS, LOG_EVENTS, safeErr, type AppLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPT_ENDPOINT = 'https://exp.host/--/api/v2/push/getReceipts';
const MAX_TOKENS_PER_REQUEST = 100;
const MAX_RECEIPT_IDS_PER_REQUEST = 300;
const RECEIPT_LOOKBACK_HOURS = 24;
// 確定済み(ok/error) ticketを残す期間。デバッグ・監査用の参照期間で、これを過ぎたら削除する
const TICKET_RETENTION_DAYS = 7;

// 外部サービス待ちで夜間バッチを長時間止めないための上限。
// 1リクエストのtimeoutと、retryを含めた1チャンクあたりの総時間を分けて制限する。
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const MAX_TOTAL_MS_PER_CHUNK = 30_000;

export interface PushResult {
  targeted: number;
  accepted: number;
  failed: number;
  deactivated: number;
}

export interface ReceiptCheckResult {
  checked: number;
  ok: number;
  errored: number;
  deactivated: number;
}

export interface TicketCleanupResult {
  deleted: number;
}

interface PostJsonResult {
  ok: boolean;
  body?: unknown;
  status?: number;
  errName?: string;
  attempts: number;
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// リトライして良い一時的な失敗か（429 と 5xx のみ。4xxは要求自体の誤りなので繰り返さない）
function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function isRetriableFetchError(errName: string | undefined): boolean {
  return errName === 'TimeoutError' || errName === 'AbortError' || errName === 'TypeError';
}

// 任意のJSONをPOSTする。timeoutとretryを内包し、例外は投げない。
async function postJsonWithRetry(
  endpoint: string,
  jsonBody: unknown,
  _logger: AppLogger
): Promise<PostJsonResult> {
  const startedAt = Date.now();
  let last: PostJsonResult = { ok: false, attempts: 0 };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remainingMs = MAX_TOTAL_MS_PER_CHUNK - (Date.now() - startedAt);
    if (remainingMs <= 0) break;

    let res: Response | undefined;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(jsonBody),
        signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remainingMs)),
      });
    } catch (e) {
      // fetch が投げる timeout（TimeoutError）・network errorはretry対象
      const errName = safeErr(e).name;
      last = { ok: false, errName, attempts: attempt };
      if (!isRetriableFetchError(errName)) return last;
    }

    if (res) {
      if (res.ok) {
        try {
          return { ok: true, body: await res.json(), attempts: attempt };
        } catch (e) {
          const errName = safeErr(e).name;
          last = { ok: false, errName, attempts: attempt };
          // 本文読み取り中のtimeoutはretryし、不正JSONなどは要求の再送対象にしない
          if (!isRetriableFetchError(errName)) return last;
        }
      } else {
        last = { ok: false, status: res.status, attempts: attempt };
        if (!isRetriableStatus(res.status)) return last;
      }
    }

    if (attempt < MAX_ATTEMPTS) {
      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      if (Date.now() - startedAt + delay >= MAX_TOTAL_MS_PER_CHUNK) break;
      await sleep(delay);
    }
  }
  return last;
}

// 前回までに送ったticketのreceiptを確認する。
// ticket は「Expoが受理した」ことしか示さないため、FCM/APNsへの引き渡し結果は
// receipt を引いて初めて分かる（DeviceNotRegistered もここで判明することが多い）。
// 夜間バッチの冒頭で呼ぶ。Expo が receipt を保持しない古い ticket は諦めて片付ける。
export async function checkPushReceipts(
  logger: AppLogger = appLogger
): Promise<ReceiptCheckResult> {
  const result: ReceiptCheckResult = { checked: 0, ok: 0, errored: 0, deactivated: 0 };
  const cutoff = new Date(Date.now() - RECEIPT_LOOKBACK_HOURS * 60 * 60 * 1000);

  // 保持期間を過ぎた未確認ticketは確認できないので expired として閉じる
  await prisma.pushTicket.updateMany({
    where: { status: 'pending', createdAt: { lt: cutoff } },
    data: { status: 'error', errorCode: 'ReceiptExpired', checkedAt: new Date() },
  });

  const pending = await prisma.pushTicket.findMany({
    where: { status: 'pending' },
    select: { id: true, expoTicketId: true, pushDeviceId: true },
    take: MAX_RECEIPT_IDS_PER_REQUEST,
  });
  if (pending.length === 0) return result;

  const sent = await postJsonWithRetry(
    EXPO_RECEIPT_ENDPOINT,
    { ids: pending.map((ticket) => ticket.expoTicketId) },
    logger
  );
  if (!sent.ok) {
    logger.warn({
      event: LOG_EVENTS.PUSH_RECEIPT_CHECK_FAILED,
      error_kind: ERROR_KINDS.INTERNAL,
      ...(sent.status != null ? { status: sent.status } : {}),
      ...(sent.errName ? { err: { name: sent.errName } } : {}),
      count: pending.length,
      attempts: sent.attempts,
    });
    return result;
  }

  // レスポンス: { data: { "<ticketId>": { status: 'ok' | 'error', details?: { error?: string } } } }
  const receipts = (sent.body as {
    data?: Record<string, { status?: string; details?: { error?: string } }>;
  })?.data ?? {};

  const deadDeviceIds = new Set<string>();
  for (const ticket of pending) {
    const receipt = receipts[ticket.expoTicketId];
    if (!receipt) continue; // まだ receipt が用意されていないため次回に持ち越す
    result.checked++;
    const errorCode =
      typeof receipt.details?.error === 'string' ? receipt.details.error : null;
    if (receipt.status === 'ok') {
      result.ok++;
      await prisma.pushTicket.update({
        where: { id: ticket.id },
        data: { status: 'ok', checkedAt: new Date() },
      });
    } else {
      result.errored++;
      await prisma.pushTicket.update({
        where: { id: ticket.id },
        data: { status: 'error', errorCode, checkedAt: new Date() },
      });
      if (errorCode === 'DeviceNotRegistered') deadDeviceIds.add(ticket.pushDeviceId);
    }
  }

  if (deadDeviceIds.size) {
    const updated = await prisma.pushDevice.updateMany({
      where: { id: { in: [...deadDeviceIds] } },
      data: { isActive: false },
    });
    result.deactivated = updated.count;
  }

  logger.info({
    event: LOG_EVENTS.PUSH_RECEIPT_CHECKED,
    checked: result.checked,
    ok: result.ok,
    errored: result.errored,
    deactivated: result.deactivated,
  });
  return result;
}

// 確定済み(ok/error) ticketのうち、確認から一定期間を過ぎたものを削除する。
// pendingのまま残っているticketは（receipt未確認のため）対象にしない。
// 夜間バッチとは独立したscheduleから呼ぶ想定
export async function cleanupPushTickets(
  logger: AppLogger = appLogger
): Promise<TicketCleanupResult> {
  const cutoff = new Date(Date.now() - TICKET_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await prisma.pushTicket.deleteMany({
    where: { status: { not: 'pending' }, checkedAt: { lt: cutoff } },
  });
  logger.info({
    event: LOG_EVENTS.PUSH_TICKETS_CLEANED,
    deleted: deleted.count,
    retention_days: TICKET_RETENTION_DAYS,
  });
  return { deleted: deleted.count };
}

export async function sendPushToHousehold(
  householdId: string,
  title: string,
  body: string,
  logger: AppLogger = appLogger
): Promise<PushResult> {
  const result: PushResult = { targeted: 0, accepted: 0, failed: 0, deactivated: 0 };

  const devices = await prisma.pushDevice.findMany({
    where: { householdId, isActive: true },
    select: { id: true, expoPushToken: true },
  });
  result.targeted = devices.length;
  if (devices.length === 0) return result;

  for (const group of chunk(devices, MAX_TOKENS_PER_REQUEST)) {
    const sent = await postJsonWithRetry(
      EXPO_PUSH_ENDPOINT,
      group.map((device) => ({
        to: device.expoPushToken,
        title,
        body,
        sound: 'default',
      })),
      logger
    );
    if (!sent.ok) {
      result.failed += group.length;
      logger.warn({
        event: LOG_EVENTS.PUSH_SEND_FAILED,
        error_kind: ERROR_KINDS.INTERNAL,
        ...(sent.status != null ? { status: sent.status } : {}),
        ...(sent.errName ? { err: { name: sent.errName } } : {}),
        count: group.length,
        attempts: sent.attempts,
      });
      continue;
    }

    // レスポンス: { data: [{ status: 'ok' | 'error', id?: string, details?: { error?: string } }, ...] }
    const data = (sent.body as {
      data?: { status?: string; id?: string; details?: { error?: string } }[];
    })?.data;
    const ticketRows: { pushDeviceId: string; expoTicketId: string }[] = [];
    const deadTokenIds: string[] = [];
    group.forEach((device, i) => {
      const ticket = data?.[i];
      if (ticket?.status === 'ok') {
        result.accepted++;
        // receipt を後から引くための ID。端末識別子ではない
        if (ticket.id) ticketRows.push({ pushDeviceId: device.id, expoTicketId: ticket.id });
        return;
      }
      result.failed++;
      if (ticket?.details?.error === 'DeviceNotRegistered') deadTokenIds.push(device.id);
    });

    if (ticketRows.length) {
      // 同じticket IDが二重に来ることは無いはずだが、一意制約違反でバッチを落とさない
      await prisma.pushTicket.createMany({ data: ticketRows, skipDuplicates: true });
    }

    if (deadTokenIds.length) {
      await prisma.pushDevice.updateMany({
        where: { id: { in: deadTokenIds } },
        data: { isActive: false },
      });
      result.deactivated += deadTokenIds.length;
    }
  }

  if (result.accepted > 0) {
    await prisma.pushDevice.updateMany({
      where: { householdId, isActive: true },
      data: { lastPushAt: new Date() },
    });
  }
  return result;
}
