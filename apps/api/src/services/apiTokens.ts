import { createHash, randomBytes } from 'node:crypto';
import { API_TOKEN_PREFIX } from '@stockhome/shared';

// 外部連携用トークンの生成・照合。トークン本体はDBに保存せず、SHA-256 だけを持つ
// （トークン自体が32バイトの乱数なので、パスワードのような遅いハッシュは不要）

/** 一覧で見分けるために残す先頭部分の長さ（目印 shk_ を含む） */
const DISPLAY_PREFIX_LENGTH = API_TOKEN_PREFIX.length + 6;

/** 最終利用日時の更新はこの間隔より短ければ省く（リクエストのたびに書き込まないため） */
export const LAST_USED_UPDATE_INTERVAL_MS = 10 * 60 * 1000;

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isApiTokenFormat(token: string): boolean {
  return token.startsWith(API_TOKEN_PREFIX);
}

export function generateApiToken() {
  const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, tokenHash: hashApiToken(token), tokenPrefix: token.slice(0, DISPLAY_PREFIX_LENGTH) };
}

/**
 * 外部連携用トークンでは使えない操作か。
 * トークンの発行・切り替え、ログイン・パスワード変更、家族メンバーの追加・変更は、
 * 書き込みを許可したトークンでも受け付けない（トークンから権限を広げられないようにする）
 */
export function isDeniedForApiToken(method: string, routeUrl: string): boolean {
  if (routeUrl.startsWith('/api/api-tokens')) return true;
  if (routeUrl.startsWith('/api/auth/')) return true;
  if (routeUrl.startsWith('/api/users') && !isReadMethod(method)) return true;
  return false;
}

export function isReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}
