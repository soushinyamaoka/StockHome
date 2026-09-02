// Expo Push 通知の送信
// 仕様: https://docs.expo.dev/push-notifications/sending-notifications/
// - 送信先は household 内の is_active=true な端末のみ
// - Expo は1リクエスト最大100件までなので分割して送る
// - DeviceNotRegistered が返った端末は is_active=false にして以後の対象から外す
// - 送信失敗はバッチ全体を止めない（ログに残して継続する）
import { appLogger, ERROR_KINDS, LOG_EVENTS, safeErr, type AppLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const MAX_TOKENS_PER_REQUEST = 100;

export interface PushResult {
  targeted: number;
  accepted: number;
  failed: number;
  deactivated: number;
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
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
    let tickets: unknown;
    try {
      const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(
          group.map((d) => ({ to: d.expoPushToken, title, body, sound: 'default' }))
        ),
      });
      if (!res.ok) {
        result.failed += group.length;
        logger.warn({
          event: LOG_EVENTS.PUSH_SEND_FAILED,
          error_kind: ERROR_KINDS.INTERNAL,
          status: res.status,
          count: group.length,
        });
        continue;
      }
      tickets = await res.json();
    } catch (e) {
      result.failed += group.length;
      logger.warn({
        event: LOG_EVENTS.PUSH_SEND_FAILED,
        error_kind: ERROR_KINDS.INTERNAL,
        count: group.length,
        err: safeErr(e),
      });
      continue;
    }

    // レスポンス: { data: [{ status: 'ok' | 'error', details?: { error?: string } }, ...] }
    const data = (tickets as { data?: { status?: string; details?: { error?: string } }[] })?.data;
    const deadTokenIds: string[] = [];
    group.forEach((device, i) => {
      const ticket = data?.[i];
      if (ticket?.status === 'ok') {
        result.accepted++;
        return;
      }
      result.failed++;
      if (ticket?.details?.error === 'DeviceNotRegistered') deadTokenIds.push(device.id);
    });

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
