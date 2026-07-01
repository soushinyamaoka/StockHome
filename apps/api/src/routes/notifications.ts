import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma';
import { serializeNotification } from '../utils/serialize';

const notificationRoutes: FastifyPluginAsync = async (app) => {
  // 通知履歴一覧（新しい順、品目名同梱）
  app.get('/', async (req) => {
    const { limit } = req.query as { limit?: string };
    const take = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 200);

    const logs = await prisma.notificationLog.findMany({
      where: { householdId: req.auth.householdId },
      orderBy: { createdAt: 'desc' },
      take,
      include: { item: { select: { itemName: true } } },
    });

    return {
      notifications: logs.map((n) => ({
        ...serializeNotification(n),
        itemName: n.item.itemName,
      })),
    };
  });
};

export default notificationRoutes;
