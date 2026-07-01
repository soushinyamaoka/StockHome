import { z } from 'zod';

// アプリ設定（app_configs）の更新
export const appConfigInputSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

export type AppConfigInput = z.infer<typeof appConfigInputSchema>;

// 配送バッファ日数の更新
export const deliveryBufferSchema = z.object({
  days: z.coerce.number().int('整数で入力してください').min(0, '0以上で入力してください'),
});

export type DeliveryBufferInput = z.infer<typeof deliveryBufferSchema>;
