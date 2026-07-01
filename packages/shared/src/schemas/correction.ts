import { z } from 'zod';
import { CORRECTION_REASONS } from '../constants';
import { optionalString } from './common';

// 在庫補正
export const correctionInputSchema = z.object({
  itemId: z.string().min(1, '品目を選択してください'),
  correctedQty: z.coerce.number().min(0, '実際の残数は0以上で入力してください'),
  correctionReason: z.enum(CORRECTION_REASONS, { message: '補正理由を選択してください' }),
  note: optionalString,
});

export type CorrectionInput = z.infer<typeof correctionInputSchema>;

// スヌーズ操作
export const SNOOZE_ACTIONS = ['days3', 'days7', 'ignore', 'clear'] as const;
export type SnoozeAction = (typeof SNOOZE_ACTIONS)[number];

export const snoozeInputSchema = z.object({
  itemId: z.string().min(1),
  action: z.enum(SNOOZE_ACTIONS),
});

export type SnoozeInput = z.infer<typeof snoozeInputSchema>;
