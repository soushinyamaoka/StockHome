import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma';
import { serializeSnapshot, serializeItem, serializeRuntimeState } from '../utils/serialize';
import { recalculateAllStocks, updateCountedInInventory } from '../services/stockCalc';
import { computeSuggestedDaysPerUnit } from './purchases';

const stockRoutes: FastifyPluginAsync = async (app) => {
  // 在庫予測一覧（在庫切れが近い順、品目情報・runtime state 同梱）
  app.get('/', async (req) => {
    const items = await prisma.item.findMany({
      where: { householdId: req.auth.householdId, isActive: true },
      include: { stockSnapshot: true, runtimeState: true },
    });

    const itemIds = items.map((item) => item.id);
    const purchaseLogs = itemIds.length > 0
      ? await prisma.purchaseLog.findMany({
          where: { itemId: { in: itemIds } },
          select: { itemId: true, purchasedAt: true, qty: true },
        })
      : [];
    const logsByItem = new Map<string, { purchasedAt: Date; qty: number }[]>();
    for (const log of purchaseLogs) {
      const logs = logsByItem.get(log.itemId) ?? [];
      logs.push({ purchasedAt: log.purchasedAt, qty: log.qty });
      logsByItem.set(log.itemId, logs);
    }

    items.sort((a, b) => {
      const da = a.stockSnapshot?.estimatedDaysLeft ?? Number.MAX_SAFE_INTEGER;
      const db = b.stockSnapshot?.estimatedDaysLeft ?? Number.MAX_SAFE_INTEGER;
      return da - db;
    });

    return {
      stocks: items.map((item) => ({
        item: serializeItem(item),
        snapshot: item.stockSnapshot ? serializeSnapshot(item.stockSnapshot) : null,
        runtimeState: serializeRuntimeState(item.runtimeState),
        suggestedDaysPerUnit: computeSuggestedDaysPerUnit(logsByItem.get(item.id) ?? []),
      })),
    };
  });

  // 手動の全品目再計算（counted_in_inventory 更新 → 再計算。GAS runStockRecalculation 相当）
  app.post('/recalculate', async (req) => {
    const counted = await updateCountedInInventory(req.auth.householdId);
    const results = await recalculateAllStocks(req.auth.householdId);
    return { ok: true, countedUpdated: counted, recalculated: results.length };
  });
};

export default stockRoutes;
