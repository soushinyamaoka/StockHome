import { z } from 'zod';

// 外部連携用トークン（Museなど、アプリ以外からAPIを呼ぶ用）

export const API_TOKEN_LIMITS = {
  /** トークン名の最大文字数 */
  MAX_NAME_LENGTH: 50,
  /** 1人が同時に持てる有効なトークンの数 */
  MAX_ACTIVE_PER_USER: 10,
} as const;

/** トークン本体の先頭に付ける目印。アプリのログイン用トークン（JWT）と見分ける */
export const API_TOKEN_PREFIX = 'shk_';

// 発行（発行した本人のトークンになる）
export const apiTokenCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '名前を入力してください')
    .max(API_TOKEN_LIMITS.MAX_NAME_LENGTH, `名前は${API_TOKEN_LIMITS.MAX_NAME_LENGTH}文字以内で入力してください`),
  allowWrite: z.boolean().default(false),
});
export type ApiTokenCreateInput = z.infer<typeof apiTokenCreateSchema>;

// 書き込み許可の切り替え
export const apiTokenUpdateSchema = z.object({
  allowWrite: z.boolean(),
});
export type ApiTokenUpdateInput = z.infer<typeof apiTokenUpdateSchema>;
