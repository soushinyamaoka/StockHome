import { z } from 'zod';
import { optionalString, optionalNonNegativeNumber } from './common';

// GET /api/bridge/reparse-candidates のクエリ。
// runToken は運用者が事前発行した PriceReparseRun.runToken
// （production承認後にのみ、HTTPを介さず直接発行する）。
// 自己申告のemailは受け付けない（B03: 共有BRIDGE_TOKEN保持者が任意のownerを
// 指定して他利用者のmessage IDへアクセスすることを防ぐ）
export const reparseCandidatesQuerySchema = z.object({
  runToken: z.string().min(20),
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

// GASが再取得・再解析できなかった場合に入れる理由。自由文字列にしない
// （B03/B04: 任意文字列がログの集計キーへそのまま到達しないようにする）
export const REPARSE_SKIP_REASONS = [
  'message_not_found',
  'item_not_found_in_reparse',
  'ambiguous_item_match',
] as const;
export const reparseSkipReasonSchema = z.enum(REPARSE_SKIP_REASONS);

export const reparseResultItemSchema = z.object({
  candidateId: z.string().min(1),
  detectedPrice: optionalNonNegativeNumber,
  priceSource: optionalString,
  skipReason: reparseSkipReasonSchema.optional(),
});
export type ReparseResultItem = z.infer<typeof reparseResultItemSchema>;

// runId（自由文字列）は廃止。runToken自体が対象runを特定する
export const reparseCandidatesPayloadSchema = z.object({
  runToken: z.string().min(20),
  mode: z.enum(['dry_run', 'write']),
  results: z.array(reparseResultItemSchema).max(50),
});
export type ReparseCandidatesPayload = z.infer<typeof reparseCandidatesPayloadSchema>;
