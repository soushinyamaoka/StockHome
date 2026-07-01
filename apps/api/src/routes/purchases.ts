import type { FastifyPluginAsync } from 'fastify';
import { purchaseInputSchema } from '@stockhome/shared';
import { prisma } from '../lib/prisma';
import { parseBody } from '../utils/validate';
import { parseDateOnly } from '../utils/date';
import { serializePurchase } from '../utils/serialize';
import { refreshStockSnapshotForItem, todayDateOnly } from '../services/stockCalc';

const purchaseRoutes: FastifyPluginAsync = async (app) => {
  // 品目別の購入履歴（新しい順）+ 価格統計
  app.get('/items/:itemId/purchases', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const item = await prisma.item.findFirst({
      where: { id: itemId, householdId: req.auth.householdId },
    });
    if (!item) return reply.code(404).send({ message: '品目が見つかりません' });

    const logs = await prisma.purchaseLog.findMany({
      where: { itemId },
      orderBy: [{ purchasedAt: 'desc' }, { createdAt: 'desc' }],
    });

    // 価格統計（price 入力済みの行のみ。GAS getPriceStatsByItem 相当）
    const prices = logs.map((l) => l.price).filter((p): p is number => p != null && p >= 0);
    const priceStats =
      prices.length === 0
        ? { count: 0, min: null, max: null, avg: null, latest: null }
        : {
            count: prices.length,
            min: Math.min(...prices),
            max: Math.max(...prices),
            avg: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 10) / 10,
            latest: prices[0], // logs は新しい順
          };

    return { purchases: logs.map(serializePurchase), priceStats };
  });

  // 手動の購入登録
  // 手動登録 = 手元に在庫がある前提:
  //   fulfillment_status=received / inventory_effective_at=購入日 / counted_in_inventory=true
  app.post('/purchases', async (req, reply) => {
    const data = parseBody(purchaseInputSchema, req.body, reply);
    if (!data) return;

    const item = await prisma.item.findFirst({
      where: { id: data.itemId, householdId: req.auth.householdId, isActive: true },
    });
    if (!item) return reply.code(404).send({ message: '品目が見つからないか削除済みです' });

    const purchasedAt = parseDateOnly(data.purchasedAt);
    if (!purchasedAt) return reply.code(400).send({ message: '購入日が不正です' });

    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });

    const log = await prisma.$transaction(async (tx) => {
      const log = await tx.purchaseLog.create({
        data: {
          householdId: req.auth.householdId,
          itemId: data.itemId,
          purchasedAt,
          qty: data.qty,
          price: data.price ?? null,
          // source は GAS 版同様、フォームの「購入元」自由記述をそのまま保持（既定 manual）
          source: data.source ?? 'manual',
          sourceType: 'manual',
          note: data.note ?? null,
          purchasedByUserId: req.auth.userId,
          purchasedByUserName: user?.name ?? null,
          fulfillmentStatus: 'received',
          inventoryEffectiveAt: purchasedAt,
          countedInInventory: purchasedAt <= todayDateOnly(),
        },
      });

      // 新しい購入が入ったので手動補正値をクリア（GAS createPurchaseLog 準拠）
      await tx.itemRuntimeState.updateMany({
        where: { itemId: data.itemId, manualOverrideQty: { not: null } },
        data: {
          manualOverrideQty: null,
          manualOverrideAt: null,
          manualOverrideByUserId: null,
          manualOverrideReason: null,
        },
      });
      return log;
    });

    await refreshStockSnapshotForItem(data.itemId);
    return reply.code(201).send({ purchase: serializePurchase(log) });
  });

  // 購入履歴の削除（誤登録の取り消し用）
  app.delete('/purchases/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const log = await prisma.purchaseLog.findFirst({
      where: { id, householdId: req.auth.householdId },
    });
    if (!log) return reply.code(404).send({ message: '購入履歴が見つかりません' });

    await prisma.purchaseLog.delete({ where: { id } });
    await refreshStockSnapshotForItem(log.itemId);
    return { ok: true };
  });
};

export default purchaseRoutes;
