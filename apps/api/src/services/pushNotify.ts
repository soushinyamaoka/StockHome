// Expo Push 通知の送信
// 仕様: https://docs.expo.dev/push-notifications/sending-notifications/
// - 送信先は user に紐づく is_active=true な端末のみ
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
  // Expoへの問い合わせ自体が失敗した(retry尽きた)場合true。
  // pendingが0件で問い合わせを行わなかった場合はfalse（両者は区別する。B11対応）
  apiCallFailed: boolean;
}

export interface TicketCleanupResult {
  deleted: number;
}

export interface PushMaintenanceResult {
  receipt: ReceiptCheckResult;
  cleanup: TicketCleanupResult;
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
  const result: ReceiptCheckResult = {
    checked: 0,
    ok: 0,
    errored: 0,
    deactivated: 0,
    apiCallFailed: false,
  };
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
    result.apiCallFailed = true;
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

// 確定済み(ok/error) ticketのうち、確認(checkedAt)から一定期間を過ぎたものを削除する。
// この関数単体は pending を対象にしないが、runPushReceiptMaintenance の実行順序
// （checkPushReceipts → cleanupPushTickets）により、24時間を超えたpendingは
// 直前の checkPushReceipts で ReceiptExpired(error) へ既に閉じられているため、
// 実運用では「pendingのまま7日以上残る」ことは事実上起こらない（B12対応）。
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

// job_start/job_end(同一run_id)で成功・失敗・異常終了・未実行を区別できるようにした
// 20:10 JST 定期jobの本体（B11対応）。receipt確認・cleanupの失敗はこのjob自体の
// 失敗として扱うが、daily_batch本体やAPIプロセス全体へは波及させない
// （呼び出し元のcron callbackで例外を握りつぶす設計は変えない）。
function maintenanceRunId(date = new Date()): string {
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

export async function runPushReceiptMaintenance(
  logger: AppLogger = appLogger
): Promise<PushMaintenanceResult> {
  const runId = maintenanceRunId();
  const startedAt = Date.now();
  const job = 'push_receipt_check_and_cleanup';
  logger.info({ event: LOG_EVENTS.JOB_START, job, run_id: runId });

  let status: 'success' | 'failure' = 'failure';
  let failureName: string | undefined;
  let failureCode: string | undefined;
  let receipt: ReceiptCheckResult = {
    checked: 0,
    ok: 0,
    errored: 0,
    deactivated: 0,
    apiCallFailed: false,
  };
  let cleanup: TicketCleanupResult = { deleted: 0 };

  try {
    receipt = await checkPushReceipts(logger);
    cleanup = await cleanupPushTickets(logger);
    if (receipt.apiCallFailed) {
      // 個別のwarn(push_receipt_check_failed)は既に出ている。
      // 「例外が無い=job成功」とはみなさず、job自体の失敗として扱う（B11対応）
      failureName = 'PushReceiptCheckFailed';
    } else {
      status = 'success';
    }
  } catch (e) {
    const err = safeErr(e);
    failureName = err.name;
    failureCode = err.code;
  } finally {
    const line = {
      event: LOG_EVENTS.JOB_END,
      job,
      run_id: runId,
      status,
      duration_ms: Date.now() - startedAt,
      checked: receipt.checked,
      ok: receipt.ok,
      errored: receipt.errored,
      deactivated: receipt.deactivated,
      cleaned: cleanup.deleted,
      ...(status === 'failure' ? { error_name: failureName, error_code: failureCode } : {}),
    };
    if (status === 'success') logger.info(line);
    else logger.error(line);
  }

  return { receipt, cleanup };
}

// household境界を維持して有効な端末を検索する（S007-B01対応）。
// 同一userが複数household所属でも、他householdの端末が混ざらないようにする
export async function findActiveDevicesForHouseholdUser(
  householdId: string,
  userId: string
): Promise<{ id: string; expoPushToken: string }[]> {
  return prisma.pushDevice.findMany({
    where: { householdId, userId, isActive: true },
    select: { id: true, expoPushToken: true },
  });
}

// 送信成功後のlastPushAt更新も同様にhousehold境界で絞る（S007-B01対応）
export async function markDevicesPushed(householdId: string, userId: string): Promise<void> {
  await prisma.pushDevice.updateMany({
    where: { householdId, userId, isActive: true },
    data: { lastPushAt: new Date() },
  });
}

export async function sendPushToUser(
  householdId: string,
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  logger: AppLogger = appLogger
): Promise<PushResult> {
  const result: PushResult = { targeted: 0, accepted: 0, failed: 0, deactivated: 0 };

  const devices = await findActiveDevicesForHouseholdUser(householdId, userId);
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
        ...(data ? { data } : {}),
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
    // 引数の`data`（通知payload用）と名前が衝突しないよう`tickets`とする
    // （同名constで内側をshadowするとTDZでReferenceErrorになる）
    const tickets = (sent.body as {
      data?: { status?: string; id?: string; details?: { error?: string } }[];
    })?.data;
    const ticketRows: { pushDeviceId: string; expoTicketId: string }[] = [];
    const deadTokenIds: string[] = [];
    group.forEach((device, i) => {
      const ticket = tickets?.[i];
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
    await markDevicesPushed(householdId, userId);
  }
  return result;
}

export interface TestPushResult {
  ok: boolean;
  reason?: 'device_not_registered' | 'send_failed' | 'rate_limited';
  // reason==='rate_limited'の場合のみ、次に送れるまでの秒数（切り上げ）
  retryAfterSeconds?: number;
}

// テスト送信のcooldown期間。誤タップの連打・意図しない自動再試行がExpo Push APIへの
// 連続送信にならないようにするため（S020-B01対応。VPS管理レビューで指摘）。
// Claudeの提案値。実配信（sendPushToUser）には適用しない（lastPushAtとは別の
// lastTestSentAt列で判定するため、実アラート配信の頻度には影響しない）
const TEST_PUSH_COOLDOWN_MS = 30_000;

// 設定画面の「この端末に通知を送ってみる」用。sendPushToUserは対象ユーザーの
// 全active端末へ一括送信する設計のため、1台だけを狙って送るテスト送信は
// 意図的に別関数として持つ（chunking等の複数端末向けロジックを流用しない）。
// household・userでの所有確認は呼び出し側の責務ではなくこの関数の内側で行う
export async function sendTestPushToDevice(
  expoPushToken: string,
  householdId: string,
  userId: string,
  logger: AppLogger = appLogger
): Promise<TestPushResult | null> {
  const device = await prisma.pushDevice.findFirst({
    where: { expoPushToken, householdId, userId },
  });
  if (!device) return null;

  // cooldown判定＋枠の確保を1つのupdateMany（WHERE条件に判定を含める）で原子的に行う。
  // 「まずSELECTでcooldown中か判定してからUPDATEする」方式だと、2つの並行リクエストが
  // どちらも判定をすり抜けてから更新でき二重送信になりうる（TOCTOU）。一意制約への
  // 楽観的updateで解決したS014-B06の並行claim対応と同じ考え方
  const cooldownThreshold = new Date(Date.now() - TEST_PUSH_COOLDOWN_MS);
  const claimed = await prisma.pushDevice.updateMany({
    where: {
      id: device.id,
      OR: [{ lastTestSentAt: null }, { lastTestSentAt: { lt: cooldownThreshold } }],
    },
    data: { lastTestSentAt: new Date() },
  });
  if (claimed.count === 0) {
    // claimに負けた場合、呼び出し開始時点で取得したdeviceのスナップショット
    // （lastTestSentAtがまだnull/古いままの可能性がある。並行して他のrequestが
    // 直前にclaimしていると、そのrequestが書き込んだ最新値をこちらのSELECTは
    // 見ていない）ではなく、現在の値を再取得してから残り時間を計算する。
    // 古いスナップショットのまま計算すると「今からちょうどcooldown分待てる」と
    // 誤認しretryAfterSecondsが不当に小さくなる（S020-B02対応。VPS管理
    // レビューで、並行claimに負けたrequestがRetry-After: 1を返す不具合を指摘された）
    const current = await prisma.pushDevice.findUnique({
      where: { id: device.id },
      select: { lastTestSentAt: true },
    });
    const lastSentAt = current?.lastTestSentAt?.getTime() ?? Date.now();
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((lastSentAt + TEST_PUSH_COOLDOWN_MS - Date.now()) / 1000)
    );
    return { ok: false, reason: 'rate_limited', retryAfterSeconds };
  }

  const sent = await postJsonWithRetry(
    EXPO_PUSH_ENDPOINT,
    [
      {
        to: device.expoPushToken,
        title: 'StockHome',
        body: 'テスト通知です。これが届いていれば通知は正常に届く状態です。',
        sound: 'default',
      },
    ],
    logger
  );

  if (!sent.ok) {
    logger.warn({
      event: LOG_EVENTS.PUSH_SEND_FAILED,
      error_kind: ERROR_KINDS.INTERNAL,
      ...(sent.status != null ? { status: sent.status } : {}),
      ...(sent.errName ? { err: { name: sent.errName } } : {}),
      count: 1,
      attempts: sent.attempts,
    });
    return { ok: false, reason: 'send_failed' };
  }

  const ticket = (
    sent.body as { data?: { status?: string; id?: string; details?: { error?: string } }[] }
  )?.data?.[0];

  if (ticket?.status === 'ok') {
    await prisma.pushDevice.update({
      where: { id: device.id },
      data: { lastPushAt: new Date(), isActive: true },
    });
    if (ticket.id) {
      try {
        await prisma.pushTicket.create({ data: { pushDeviceId: device.id, expoTicketId: ticket.id } });
      } catch (e) {
        // ticket記録の失敗でテスト送信自体を失敗扱いにしない（一意制約違反等）
        logger.warn({
          event: LOG_EVENTS.PUSH_SEND_FAILED,
          error_kind: ERROR_KINDS.DB,
          err: safeErr(e),
        });
      }
    }
    return { ok: true };
  }

  if (ticket?.details?.error === 'DeviceNotRegistered') {
    await prisma.pushDevice.update({ where: { id: device.id }, data: { isActive: false } });
    return { ok: false, reason: 'device_not_registered' };
  }

  return { ok: false, reason: 'send_failed' };
}
