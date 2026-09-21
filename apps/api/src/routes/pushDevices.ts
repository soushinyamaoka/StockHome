import type { FastifyPluginAsync } from 'fastify';
import { pushDeviceRegisterSchema, pushDeviceTestSchema } from '@stockhome/shared';
import { appLogger, LOG_EVENTS } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { parseBody } from '../utils/validate';
import { serializePushDevice } from '../utils/serialize';
import { sendTestPushToDevice } from '../services/pushNotify';

const pushDeviceRoutes: FastifyPluginAsync = async (app) => {
  // 自分（世帯内の自ユーザー）の登録端末一覧（B-6: 設定画面の疎通確認）
  app.get('/', async (req) => {
    const devices = await prisma.pushDevice.findMany({
      where: { householdId: req.auth.householdId, userId: req.auth.userId },
      orderBy: { createdAt: 'desc' },
    });
    return { devices: devices.map(serializePushDevice) };
  });

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

  // 指定した1台へテスト通知を送る（B-6: 設定画面「この端末に通知を送ってみる」）。
  // 送信を試みた結果（成功／DeviceNotRegistered／送信失敗）は診断結果として200で返す。
  // 対象の端末がこの世帯・ユーザーに存在しない場合は404、cooldown中は429＋Retry-After
  // （S020-B01対応。VPS管理レビューで、サーバー側の連打防止が無いと指摘された）
  app.post('/test', async (req, reply) => {
    const data = parseBody(pushDeviceTestSchema, req.body, reply);
    if (!data) return;

    const result = await sendTestPushToDevice(data.expoPushToken, req.auth.householdId, req.auth.userId);
    if (result === null) {
      return reply.code(404).send({ message: '指定された端末が見つかりません' });
    }
    if (result.reason === 'rate_limited') {
      reply.header('Retry-After', String(result.retryAfterSeconds));
      return reply.code(429).send(result);
    }
    return result;
  });
};

export default pushDeviceRoutes;
