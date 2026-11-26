import type { ApiToken } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { LOG_EVENTS, appLogger, type AppLogger } from '../lib/logger';
import { sendPushToUser } from './pushNotify';

// 外部連携用トークンで拒否された操作を、発行した本人へプッシュ通知する。
// 連携先（Muse など）は正しく使えば拒否されないため、拒否そのものが「想定外の使われ方」の合図になる

/** 同じトークンについての通知はこの間隔に1回まで */
export const API_TOKEN_ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type ApiTokenDenialReason = 'write_not_allowed' | 'denied_route' | 'revoked';

/**
 * 通知の結果。ログの event と対応する
 * - sent: 1台以上の端末で Expo が受理した（api_token_alert_sent）
 * - no_target: 送る先が無い（api_token_alert_no_target。cause: owner_inactive / owner_not_member / no_active_device）
 * - failed: 送る先はあったが1台も受理されなかった（api_token_alert_failed。cause: push_not_accepted）
 * - throttled: 24時間以内に通知済み（ログなし）
 */
export type ApiTokenAlertOutcome = 'sent' | 'no_target' | 'failed' | 'throttled';

const REASON_TEXT: Record<ApiTokenDenialReason, string> = {
  write_not_allowed: '読み取り専用なのに書き込みが試されました',
  denied_route: 'トークンでは使えない操作（個人情報など）が試されました',
  revoked: '取り消したトークンが使われました',
};

export function apiTokenAlertMessage(name: string, reason: ApiTokenDenialReason) {
  return {
    title: '外部連携のトークンで拒否された操作がありました',
    body: `「${name}」で、${REASON_TEXT[reason]}。心当たりがなければ、アプリの「せってい → 外部連携」で取り消してください。`,
  };
}

/**
 * 通知する。送る相手は、トークンを発行した本人が今も有効で、その家庭のメンバーである場合だけ
 * （無効化・家庭から外れた人へ、その家庭の出来事を知らせない。取り消し済みトークンは本人の状態を問わず届くため、ここで確かめる）。
 * 通知済みの印は送信前に付けるため、同時に何件拒否されても通知は1回になる（送信に失敗しても24時間は再送しない）
 */
export async function alertApiTokenDenied(
  token: Pick<ApiToken, 'id' | 'householdId' | 'userId' | 'name'>,
  reason: ApiTokenDenialReason,
  logger: AppLogger = appLogger
): Promise<ApiTokenAlertOutcome> {
  const member = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId: token.householdId, userId: token.userId } },
    include: { user: { select: { isActive: true } } },
  });
  const ownerProblem = !member ? 'owner_not_member' : !member.user.isActive ? 'owner_inactive' : null;
  if (ownerProblem) {
    logger.warn({ event: LOG_EVENTS.API_TOKEN_ALERT_NO_TARGET, api_token_id: token.id, reason, cause: ownerProblem });
    return 'no_target';
  }

  const now = new Date();
  const claimed = await prisma.apiToken.updateMany({
    where: {
      id: token.id,
      OR: [{ lastAlertedAt: null }, { lastAlertedAt: { lt: new Date(now.getTime() - API_TOKEN_ALERT_INTERVAL_MS) } }],
    },
    data: { lastAlertedAt: now },
  });
  if (claimed.count === 0) return 'throttled';

  const { title, body } = apiTokenAlertMessage(token.name, reason);
  const push = await sendPushToUser(
    token.householdId,
    token.userId,
    title,
    body,
    { type: 'api_token_alert', apiTokenId: token.id },
    logger
  );
  const counts = {
    api_token_id: token.id,
    reason,
    push_targeted: push.targeted,
    push_accepted: push.accepted,
    push_failed: push.failed,
  };
  if (push.targeted === 0) {
    logger.warn({ event: LOG_EVENTS.API_TOKEN_ALERT_NO_TARGET, ...counts, cause: 'no_active_device' });
    return 'no_target';
  }
  if (push.accepted === 0) {
    logger.warn({ event: LOG_EVENTS.API_TOKEN_ALERT_FAILED, ...counts, cause: 'push_not_accepted' });
    return 'failed';
  }
  logger.warn({ event: LOG_EVENTS.API_TOKEN_ALERT_SENT, ...counts });
  return 'sent';
}
