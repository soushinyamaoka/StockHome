import { z } from 'zod';
import { USER_ROLES } from '../constants';

// 家族メンバーの新規追加（admin が実行）
export const familyMemberCreateSchema = z.object({
  email: z.string().email('メールアドレスの形式が不正です'),
  name: z.string().trim().min(1, '名前を入力してください'),
  password: z.string().min(8, 'パスワードは8文字以上で入力してください'),
  role: z.enum(USER_ROLES).default('member'),
});

export type FamilyMemberCreateInput = z.infer<typeof familyMemberCreateSchema>;

// 家族メンバーの更新（名前・ロール・有効無効）
export const familyMemberUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  role: z.enum(USER_ROLES).optional(),
  isActive: z.boolean().optional(),
});

export type FamilyMemberUpdateInput = z.infer<typeof familyMemberUpdateSchema>;
