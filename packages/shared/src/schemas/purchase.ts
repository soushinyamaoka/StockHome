import { z } from 'zod';
import { optionalString, optionalNonNegativeNumber, requiredDate } from './common';

// 手動の購入履歴登録
export const purchaseInputSchema = z.object({
  itemId: z.string().min(1, '品目を選択してください'),
  purchasedAt: requiredDate,
  qty: z.coerce.number().min(1, '購入数は1以上で入力してください'),
  price: optionalNonNegativeNumber, // 1箱（1セット）の単価
  source: optionalString, // 購入元（店舗名等の自由記述）
  note: optionalString,
});

export type PurchaseInput = z.infer<typeof purchaseInputSchema>;
