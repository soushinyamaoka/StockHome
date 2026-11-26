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
 * 外部連携用トークンでは、書き込みを許可していても使えないAPI。
 * - トークンの発行・切り替え、ログイン・パスワード変更（トークンから権限を広げられないようにする）
 * - 利用者の個人情報を返すもの: 家族メンバー（メールアドレス）、プッシュ通知の端末、
 *   Gmail取込の候補と反映記録（取り込んだ人のメールアドレス・メールの件名と本文の一部）
 */
const API_TOKEN_DENIED_ROUTE_PREFIXES = [
  '/api/api-tokens',
  '/api/auth/',
  '/api/users',
  '/api/push-devices',
  '/api/import-candidates',
  '/api/reflections',
];

export function isDeniedForApiToken(routeUrl: string): boolean {
  return API_TOKEN_DENIED_ROUTE_PREFIXES.some((prefix) => routeUrl.startsWith(prefix));
}

export function isReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}
