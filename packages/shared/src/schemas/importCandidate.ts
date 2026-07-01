import { z } from 'zod';
import { EXTERNAL_VENDORS, MAIL_TYPES, MAIL_PHASES } from '../constants';
import { optionalString, optionalNonNegativeNumber } from './common';

// GAS ブリッジから届く解析済み候補1件
// （GAS GmailImportService がメールを解析して生成するオブジェクト）
export const bridgeCandidateSchema = z.object({
  vendor: z.enum(EXTERNAL_VENDORS),
  mailMessageId: z.string().min(1),
  gmailThreadId: optionalString,
  importedByEmail: optionalString, // 取込ユーザーの Gmail アドレス
  mailDate: z.string().min(1), // ISO 日時
  orderId: optionalString,
  mailType: z.enum(MAIL_TYPES),
  mailPhase: z.enum(MAIL_PHASES),
  itemNameRaw: optionalString,
  detectedQty: optionalNonNegativeNumber,
  detectedPrice: optionalNonNegativeNumber,
  rawSubject: optionalString,
  rawSnippet: optionalString,
  parseResult: optionalString,
});

export type BridgeCandidate = z.infer<typeof bridgeCandidateSchema>;

export const bridgeCandidatesPayloadSchema = z.object({
  candidates: z.array(bridgeCandidateSchema).max(200),
});

export type BridgeCandidatesPayload = z.infer<typeof bridgeCandidatesPayloadSchema>;

// 候補の品目紐付け・確定
export const candidateConfirmSchema = z.object({
  matchedItemId: z.string().min(1, '紐付ける品目を選択してください'),
});

export type CandidateConfirmInput = z.infer<typeof candidateConfirmSchema>;
