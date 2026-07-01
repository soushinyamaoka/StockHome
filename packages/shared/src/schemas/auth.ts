import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email('メールアドレスの形式が不正です'),
  password: z.string().min(8, 'パスワードは8文字以上で入力してください'),
  name: z.string().min(1, '名前を入力してください'),
  householdName: z.string().min(1, '家庭名を入力してください').optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, '現在のパスワードを入力してください'),
  newPassword: z.string().min(8, '新しいパスワードは8文字以上で入力してください'),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const authResponseSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    householdId: z.string(),
    householdName: z.string(),
    role: z.string(),
  }),
});

export type AuthResponse = z.infer<typeof authResponseSchema>;
