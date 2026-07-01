import type { FastifyPluginAsync } from 'fastify';
import { correctionInputSchema, snoozeInputSchema, DEFAULTS } from '@stockhome/shared';
import { prisma } from '../lib/prisma';
import { parseBody } from '../utils/validate';
import { serializeCorrection } from '../utils/serialize';
import { refreshStockSnapshotForItem } from '../services/stockCalc';

const correctionRoutes: FastifyPluginAsync = async (app) => {
  // 在庫補正（GAS StockCorrectionService.correctStock 相当）
  // runtime_state の補正値更新 + 補正履歴追加 + snapshot 即時再計算
  app.post('/corrections', async (req, reply) => {
    const data = parseBody(correctionInputSchema, req.body, reply);
    if (!data) return;

    const item = await prisma.item.findFirst({
      where: { id: data.itemId, householdId: req.auth.householdId, isActive: true },
      include: { stockSnapshot: true },
    });
    if (!item) return reply.code(404).send({ message: '品目が見つからないか削除済みです' });

    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    const now = new Date();

    const log = await prisma.$transaction(async (tx) => {
      await tx.itemRuntimeState.upsert({
        where: { itemId: data.itemId },
        create: {
          householdId: req.auth.householdId,
          itemId: data.itemId,
          manualOverrideQty: data.correctedQty,
          manualOverrideAt: now,
          manualOverrideByUserId: req.auth.userId,
          manualOverrideReason: data.correctionReason,
        },
        update: {
          manualOverrideQty: data.correctedQty,
          manualOverrideAt: now,
          manualOverrideByUserId: req.auth.userId,
          manualOverrideReason: data.correctionReason,
        },
      });

      return tx.stockCorrectionLog.create({
        data: {
          householdId: req.auth.householdId,
          itemId: data.itemId,
          correctedAt: now,
          correctedByUserId: req.auth.userId,
          correctedByUserName: user?.name ?? null,
          beforeEstimatedQty: item.stockSnapshot?.estimatedRemainingQty ?? null,
          correctedQty: data.correctedQty,
          correctionReason: data.correctionReason,
          note: data.note ?? null,
        },
      });
    });

    await refreshStockSnapshotForItem(data.itemId);
    return reply.code(201).send({ correction: serializeCorrection(log) });
  });

  // 品目別の補正履歴
  app.get('/items/:itemId/corrections', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const item = await prisma.item.findFirst({
      where: { id: itemId, householdId: req.auth.householdId },
    });
    if (!item) return reply.code(404).send({ message: '品目が見つかりません' });

    const logs = await prisma.stockCorrectionLog.findMany({
      where: { itemId },
      orderBy: { correctedAt: 'desc' },
    });
    return { corrections: logs.map(serializeCorrection) };
  });

  // スヌーズ設定/解除（GAS SnoozeService 相当）
  app.post('/snooze', async (req, reply) => {
    const data = parseBody(snoozeInputSchema, req.body, reply);
    if (!data) return;

    const item = await prisma.item.findFirst({
      where: { id: data.itemId, householdId: req.auth.householdId },
    });
    if (!item) return reply.code(404).send({ message: '品目が見つかりません' });

    const days =
      data.action === 'days3' ? 3 :
      data.action === 'days7' ? 7 :
      data.action === 'ignore' ? DEFAULTS.SNOOZE_IGNORE_DAYS :
      null; // clear

    const snoozeUntil =
      days != null ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;

    await prisma.itemRuntimeState.upsert({
      where: { itemId: data.itemId },
      create: {
        householdId: req.auth.householdId,
        itemId: data.itemId,
        snoozeUntil,
      },
      update: { snoozeUntil },
    });

    return { ok: true, snoozeUntil: snoozeUntil?.toISOString() ?? null };
  });
};

export default correctionRoutes;
