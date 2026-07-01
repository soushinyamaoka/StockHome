import { z } from 'zod';
import { NOTIFY_TARGET_TYPES, DEFAULTS } from '../constants';
import { optionalUrl, optionalString, optionalNonNegativeNumber } from './common';

// 代替購入候補（items.alternatives に JSON で保持）
export const alternativeSchema = z.object({
  name: z.string().trim().min(1, '代替品名を入力してください'),
  url: optionalUrl,
  note: optionalString,
});

export type Alternative = z.infer<typeof alternativeSchema>;

export const itemInputSchema = z.object({
  itemName: z.string().trim().min(1, '品名を入力してください'),
  category: optionalString,
  unit: optionalString,
  defaultPurchaseQty: z.coerce.number().min(1, '標準購入数は1以上で入力してください').default(1),
  daysPerUnit: z.coerce.number().min(0.1, '1単位あたり消費日数は正の数で入力してください'),
  leadDays: z.coerce.number().int('通知何日前は整数で入力してください').min(0).default(0),
  safetyDays: z.coerce.number().int('安全日数は整数で入力してください').min(0).default(0),
  lowStockThresholdQty: optionalNonNegativeNumber,
  purchaseUrl: optionalUrl,
  alternatives: z
    .array(alternativeSchema)
    .max(DEFAULTS.MAX_ALTERNATIVES, `代替品は最大${DEFAULTS.MAX_ALTERNATIVES}件までです`)
    .default([]),
  itemMemo: z
    .string()
    .trim()
    .max(DEFAULTS.MAX_ITEM_MEMO_LENGTH, `メモは${DEFAULTS.MAX_ITEM_MEMO_LENGTH}文字以内で入力してください`)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  notifyTargetType: z.enum(NOTIFY_TARGET_TYPES).default('all'),
  notifyTargetUserId: optionalString,
  notificationEnabled: z.boolean().default(true),
  isInventoryUnknown: z.boolean().default(false),
});

export type ItemInput = z.infer<typeof itemInputSchema>;
