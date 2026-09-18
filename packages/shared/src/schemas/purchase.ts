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

// 購入履歴の編集（数量・単価・備考のみ。購入日・品目・購入元は変更できない）。
// 画面のフォームは常に3項目すべてを送るため、price/noteの未指定は「値なし」を意味する
export const purchaseEditSchema = z.object({
  qty: z.coerce.number().min(1, '購入数は1以上で入力してください'),
  price: optionalNonNegativeNumber, // 1箱（1セット）の単価。未指定は単価なしとして保存
  note: optionalString,
});

export type PurchaseEdit = z.infer<typeof purchaseEditSchema>;
