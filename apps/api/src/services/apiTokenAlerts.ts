import type { ApiToken } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { LOG_EVENTS, appLogger, type AppLogger } from '../lib/logger';
import { sendPushToUser } from './pushNotify';

// 外部連携用トークンで拒否された操作を、発行した本人へプッシュ通知する。
// 連携先（Muse など）は正しく使えば拒否されないため、拒否そのものが「想定外の使われ方」の合図になる

/** 同じトークンについての通知はこの間隔に1回まで */
export const API_TOKEN_ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type ApiTokenDenialReason = 'write_not_allowed' | 'denied_route' | 'revoked';

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
 * 通知する。24時間以内に通知済みなら何もしない（false）。
 * 通知済みの印は送信前に付けるため、同時に何件拒否されても通知は1回になる（送信に失敗しても24時間は再送しない）
 */
export async function alertApiTokenDenied(
  token: Pick<ApiToken, 'id' | 'householdId' | 'userId' | 'name'>,
  reason: ApiTokenDenialReason,
  logger: AppLogger = appLogger
): Promise<boolean> {
  const now = new Date();
  const claimed = await prisma.apiToken.updateMany({
    where: {
      id: token.id,
      OR: [{ lastAlertedAt: null }, { lastAlertedAt: { lt: new Date(now.getTime() - API_TOKEN_ALERT_INTERVAL_MS) } }],
    },
    data: { lastAlertedAt: now },
  });
  if (claimed.count === 0) return false;

  const { title, body } = apiTokenAlertMessage(token.name, reason);
  const push = await sendPushToUser(
    token.householdId,
    token.userId,
    title,
    body,
    { type: 'api_token_alert', apiTokenId: token.id },
    logger
  );
  logger.warn({
    event: LOG_EVENTS.API_TOKEN_ALERT_SENT,
    api_token_id: token.id,
    reason,
    push_targeted: push.targeted,
    push_accepted: push.accepted,
  });
  return true;
}
