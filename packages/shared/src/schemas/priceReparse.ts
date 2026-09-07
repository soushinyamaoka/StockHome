import { z } from 'zod';
import { optionalString, optionalNonNegativeNumber } from './common';

// GET /api/bridge/reparse-candidates のクエリ。
// runToken はquery stringではなく専用header（X-Reparse-Run-Token）で受け取る
// （第3回レビューB03: bearer secretがaccess logへ残ることを防ぐ）。
// そのためquery schemaにはcursor/limitだけを残す
export const reparseCandidatesQuerySchema = z.object({
  cursor: optionalString,
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type ReparseCandidatesQuery = z.infer<typeof reparseCandidatesQuerySchema>;

export const reparseCandidateTargetSchema = z.object({
  id: z.string(),
  mailMessageId: z.string(),
  itemNameRaw: z.string().nullable(),
  vendor: z.string(),
  mailPhase: z.string(),
});
export type ReparseCandidateTarget = z.infer<typeof reparseCandidateTargetSchema>;

export const REPARSE_SKIP_REASONS = [
  'message_not_found',
  'item_not_found_in_reparse',
  'ambiguous_item_match',
] as const;
export const reparseSkipReasonSchema = z.enum(REPARSE_SKIP_REASONS);

// 第3回レビューB02対応: skipReasonと価格系フィールドは排他。
// priceSourceを送るならdetectedPriceも必須（price_sourceだけが入って
// detected_priceがNULLのまま残り、以後対象外になる不具合を防ぐ）
export const reparseResultItemSchema = z
  .object({
    candidateId: z.string().min(1),
    detectedPrice: optionalNonNegativeNumber,
    priceSource: optionalString,
    skipReason: reparseSkipReasonSchema.optional(),
  })
  .refine((v) => !(v.skipReason != null && (v.detectedPrice != null || v.priceSource != null)), {
    message: 'skipReasonと価格フィールドは同時に指定できません',
  })
  .refine((v) => !(v.priceSource != null && v.detectedPrice == null), {
    message: 'priceSourceを指定する場合はdetectedPriceも必須です',
  });
export type ReparseResultItem = z.infer<typeof reparseResultItemSchema>;

// runToken はbodyからも除去し、専用headerで受け取る（GETと同じ理由）
export const reparseCandidatesPayloadSchema = z.object({
  mode: z.enum(['dry_run', 'write']),
  results: z.array(reparseResultItemSchema).max(50),
});
export type ReparseCandidatesPayload = z.infer<typeof reparseCandidatesPayloadSchema>;
