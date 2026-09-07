import { z } from 'zod';
import { optionalString, optionalNonNegativeNumber } from './common';

// GET /api/bridge/reparse-candidates のクエリ
// email: 呼び出し元GASトリガーの所有者自身のメールアドレス（自己申告）。
// mail_message_id は個人のGmailを参照する識別子のため、対象をこのemailに紐づく
// 候補だけへ絞る（B03対応）。既存の import-candidates が importedByEmail を
// 自己申告のまま信頼している境界と同一の信頼モデルを踏襲する
export const reparseCandidatesQuerySchema = z.object({
  email: z.string().email(),
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

// POST /api/bridge/reparse-candidates の1候補分の結果。
// GAS側で再取得・再解析できなかった場合は detectedPrice/priceSource を省略し、
// skipReason（例: 'message_not_found' / 'item_not_found_in_reparse'）を入れる
export const reparseResultItemSchema = z.object({
  candidateId: z.string().min(1),
  detectedPrice: optionalNonNegativeNumber,
  priceSource: optionalString,
  skipReason: optionalString,
});
export type ReparseResultItem = z.infer<typeof reparseResultItemSchema>;

export const reparseCandidatesPayloadSchema = z.object({
  runId: z.string().min(1),
  mode: z.enum(['dry_run', 'write']),
  results: z.array(reparseResultItemSchema).max(50),
});
export type ReparseCandidatesPayload = z.infer<typeof reparseCandidatesPayloadSchema>;
