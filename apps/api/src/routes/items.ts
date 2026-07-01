import type { FastifyPluginAsync } from 'fastify';
import { itemInputSchema } from '@stockhome/shared';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { parseBody } from '../utils/validate';
import { serializeItem, serializeSnapshot, serializeRuntimeState } from '../utils/serialize';
import { refreshStockSnapshotForItem } from '../services/stockCalc';

const itemRoutes: FastifyPluginAsync = async (app) => {
  // 一覧（既定は有効品目のみ。includeInactive=true で論理削除分も含む）
  // snapshot / runtimeState を同梱して返す（消耗品一覧・在庫予測一覧の両方で使う）
  app.get('/', async (req) => {
    const { includeInactive } = req.query as { includeInactive?: string };
    const items = await prisma.item.findMany({
      where: {
        householdId: req.auth.householdId,
        ...(includeInactive === 'true' ? {} : { isActive: true }),
      },
      include: { stockSnapshot: true, runtimeState: true },
    });

    // 在庫切れが近い順（snapshot なしは末尾）
    items.sort((a, b) => {
      const da = a.stockSnapshot?.estimatedDaysLeft ?? Number.MAX_SAFE_INTEGER;
      const db = b.stockSnapshot?.estimatedDaysLeft ?? Number.MAX_SAFE_INTEGER;
      return da - db;
    });

    return {
      items: items.map((item) => ({
        ...serializeItem(item),
        snapshot: item.stockSnapshot ? serializeSnapshot(item.stockSnapshot) : null,
        runtimeState: serializeRuntimeState(item.runtimeState),
      })),
    };
  });

  // 詳細
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await prisma.item.findFirst({
      where: { id, householdId: req.auth.householdId },
      include: { stockSnapshot: true, runtimeState: true },
    });
    if (!item) return reply.code(404).send({ message: '品目が見つかりません' });
    return {
      item: {
        ...serializeItem(item),
        snapshot: item.stockSnapshot ? serializeSnapshot(item.stockSnapshot) : null,
        runtimeState: serializeRuntimeState(item.runtimeState),
      },
    };
  });

  // 新規作成
  app.post('/', async (req, reply) => {
    const data = parseBody(itemInputSchema, req.body, reply);
    if (!data) return;

    const item = await prisma.item.create({
      data: {
        householdId: req.auth.householdId,
        itemName: data.itemName,
        category: data.category ?? null,
        unit: data.unit ?? null,
        defaultPurchaseQty: data.defaultPurchaseQty,
        daysPerUnit: data.daysPerUnit,
        leadDays: data.leadDays,
        safetyDays: data.safetyDays,
        lowStockThresholdQty: data.lowStockThresholdQty ?? null,
        purchaseUrl: data.purchaseUrl ?? null,
        alternatives: data.alternatives,
        itemMemo: data.itemMemo ?? null,
        notifyTargetType: data.notifyTargetType,
        notifyTargetUserId: data.notifyTargetUserId ?? null,
        notificationEnabled: data.notificationEnabled,
        isInventoryUnknown: data.isInventoryUnknown,
        // runtime state は品目ごとに1行（GAS ensureRuntimeState 相当）
        runtimeState: { create: { householdId: req.auth.householdId } },
      },
    });
    return reply.code(201).send({ item: serializeItem(item) });
  });

  // 更新
  app.put('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = parseBody(itemInputSchema, req.body, reply);
    if (!data) return;

    const exists = await prisma.item.findFirst({
      where: { id, householdId: req.auth.householdId },
    });
    if (!exists) return reply.code(404).send({ message: '品目が見つかりません' });

    const item = await prisma.item.update({
      where: { id },
      data: {
        itemName: data.itemName,
        category: data.category ?? null,
        unit: data.unit ?? null,
        defaultPurchaseQty: data.defaultPurchaseQty,
        daysPerUnit: data.daysPerUnit,
        leadDays: data.leadDays,
        safetyDays: data.safetyDays,
        lowStockThresholdQty: data.lowStockThresholdQty ?? null,
        purchaseUrl: data.purchaseUrl ?? null,
        alternatives: data.alternatives,
        itemMemo: data.itemMemo ?? null,
        notifyTargetType: data.notifyTargetType,
        notifyTargetUserId: data.notifyTargetUserId ?? null,
        notificationEnabled: data.notificationEnabled,
        isInventoryUnknown: data.isInventoryUnknown,
      },
    });

    // 消費日数やしきい値の変更が在庫判定に効くため snapshot を即時更新
    await refreshStockSnapshotForItem(id);
    return { item: serializeItem(item) };
  });

  // 通知ON/OFFだけの切り替え
  app.patch('/:id/notification', async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = parseBody(z.object({ enabled: z.boolean() }), req.body, reply);
    if (!data) return;

    const exists = await prisma.item.findFirst({
      where: { id, householdId: req.auth.householdId },
    });
    if (!exists) return reply.code(404).send({ message: '品目が見つかりません' });

    const item = await prisma.item.update({
      where: { id },
      data: { notificationEnabled: data.enabled },
    });
    return { item: serializeItem(item) };
  });

  // 論理削除（GAS 版 deleteItemLogical 相当）
  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const exists = await prisma.item.findFirst({
      where: { id, householdId: req.auth.householdId },
    });
    if (!exists) return reply.code(404).send({ message: '品目が見つかりません' });

    await prisma.item.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date(), deletedBy: req.auth.userId },
    });
    return { ok: true };
  });
};

export default itemRoutes;
