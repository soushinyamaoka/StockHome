import type { FastifyPluginAsync } from 'fastify';
import { pushDeviceRegisterSchema } from '@stockhome/shared';
import { appLogger, LOG_EVENTS } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { parseBody } from '../utils/validate';

const pushDeviceRoutes: FastifyPluginAsync = async (app) => {
  // 端末の登録（同じトークンの再送は更新として扱う。アプリ起動のたびに呼ばれる想定）
  app.post('/', async (req, reply) => {
    const data = parseBody(pushDeviceRegisterSchema, req.body, reply);
    if (!data) return;

    const device = await prisma.pushDevice.upsert({
      where: { expoPushToken: data.expoPushToken },
      create: {
        householdId: req.auth.householdId,
        userId: req.auth.userId,
        expoPushToken: data.expoPushToken,
        platform: data.platform,
      },
      // 端末を別ユーザーが使い始めた場合や、通知を再許可した場合に追従する
      update: {
        householdId: req.auth.householdId,
        userId: req.auth.userId,
        platform: data.platform,
        isActive: true,
      },
    });

    // トークン自体はログへ出さない（端末識別子のため）
    appLogger.info({ event: LOG_EVENTS.PUSH_DEVICE_REGISTERED, platform: device.platform });
    return reply.code(201).send({ ok: true });
  });

  // 端末の解除（ログアウト時などに呼ぶ）
  app.delete('/', async (req, reply) => {
    const data = parseBody(pushDeviceRegisterSchema, req.body, reply);
    if (!data) return;
    await prisma.pushDevice.updateMany({
      where: { expoPushToken: data.expoPushToken, householdId: req.auth.householdId },
      data: { isActive: false },
    });
    return { ok: true };
  });
};

export default pushDeviceRoutes;
