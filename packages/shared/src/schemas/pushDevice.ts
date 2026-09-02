import { z } from 'zod';

export const PUSH_PLATFORMS = ['ios', 'android'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

// Expo が発行する送信先識別子。形式が違うものは受け付けない
export const pushDeviceRegisterSchema = z.object({
  expoPushToken: z
    .string()
    .min(1)
    .regex(/^Expo(nent)?PushToken\[.+\]$/, 'Expo Push Token の形式が不正です'),
  platform: z.enum(PUSH_PLATFORMS),
});

export type PushDeviceRegisterInput = z.infer<typeof pushDeviceRegisterSchema>;
