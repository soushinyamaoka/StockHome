import { z } from 'zod';

// 任意のURL入力（空文字はundefinedに）
export const optionalUrl = z
  .string()
  .trim()
  .url('URL形式で入力してください')
  .optional()
  .or(z.literal('').transform(() => undefined));

// 任意の日付入力（YYYY-MM-DD）
export const optionalDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日付はYYYY-MM-DD形式で入力してください')
  .optional()
  .or(z.literal('').transform(() => undefined));

// 必須の日付入力（YYYY-MM-DD）
export const requiredDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日付はYYYY-MM-DD形式で入力してください');

// 任意の0以上数値
export const optionalNonNegativeNumber = z
  .union([z.number(), z.string()])
  .transform((v) => (v === '' || v === null || v === undefined ? undefined : Number(v)))
  .refine((v) => v === undefined || (!Number.isNaN(v) && v >= 0), '0以上の数値を入力してください')
  .optional();

// 任意の文字列（trim、空文字はundefined）
export const optionalString = z
  .string()
  .trim()
  .optional()
  .or(z.literal('').transform(() => undefined));
