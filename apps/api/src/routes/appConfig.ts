import type { FastifyPluginAsync } from 'fastify';
import { deliveryBufferSchema, APP_CONFIG_KEYS, DEFAULTS } from '@stockhome/shared';
import { prisma } from '../lib/prisma';
import { parseBody } from '../utils/validate';

const appConfigRoutes: FastifyPluginAsync = async (app) => {
  // 設定一覧
  app.get('/', async (req) => {
    const configs = await prisma.appConfig.findMany({
      where: { householdId: req.auth.householdId },
    });
    const map: Record<string, string> = {};
    for (const c of configs) map[c.key] = c.value;
    return {
      configs: map,
      deliveryBufferDays: Number(map[APP_CONFIG_KEYS.DELIVERY_BUFFER_DAYS] ?? DEFAULTS.DELIVERY_BUFFER_DAYS),
    };
  });

  // 配送バッファ日数の更新
  app.put('/delivery-buffer', async (req, reply) => {
    const data = parseBody(deliveryBufferSchema, req.body, reply);
    if (!data) return;

    await prisma.appConfig.upsert({
      where: {
        householdId_key: {
          householdId: req.auth.householdId,
          key: APP_CONFIG_KEYS.DELIVERY_BUFFER_DAYS,
        },
      },
      create: {
        householdId: req.auth.householdId,
        key: APP_CONFIG_KEYS.DELIVERY_BUFFER_DAYS,
        value: String(data.days),
      },
      update: { value: String(data.days) },
    });
    return { ok: true, deliveryBufferDays: data.days };
  });
};

export default appConfigRoutes;
