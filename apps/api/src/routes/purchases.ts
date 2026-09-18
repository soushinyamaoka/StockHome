import type { FastifyPluginAsync } from 'fastify';
import { purchaseEditSchema, purchaseInputSchema } from '@stockhome/shared';
import { prisma } from '../lib/prisma';
import { parseBody } from '../utils/validate';
import { parseDateOnly } from '../utils/date';
import { serializePurchase } from '../utils/serialize';
import {
  refreshStockSnapshotForItem,
  todayDateOnly,
  accumulatePurchaseIntoStock,
  reverseAccumulatedPurchase,
  lockItemForAccumulation,
  adjustAccumulatedPurchaseQty,
} from '../services/stockCalc';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SUGGESTION_SAMPLE_INTERVALS = 5;

// 消費ペースの実績提案（直近 SUGGESTION_SAMPLE_INTERVALS 回の購入間隔 ÷ 直前購入数量、の平均）。
// 同日購入等で間隔が0日の区間は消費ペースの参考にならないため除外する。
// 有効な区間が1件も無ければ提案しない
export function computeSuggestedDaysPerUnit(
  logs: { purchasedAt: Date; qty: number }[]
): { value: number; sampleCount: number } | null {
  if (logs.length < 2) return null;
  const asc = [...logs].sort((a, b) => a.purchasedAt.getTime() - b.purchasedAt.getTime());
  const samples: number[] = [];
  for (let i = asc.length - 1; i > 0 && samples.length < SUGGESTION_SAMPLE_INTERVALS; i--) {
    const days = Math.round((asc[i].purchasedAt.getTime() - asc[i - 1].purchasedAt.getTime()) / MS_PER_DAY);
    if (days <= 0) continue;
    samples.push(days / asc[i - 1].qty);
  }
  if (samples.length === 0) return null;
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { value: Math.round(avg * 10) / 10, sampleCount: samples.length };
}

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

    const suggestedDaysPerUnit = computeSuggestedDaysPerUnit(logs);

    return { purchases: logs.map(serializePurchase), priceStats, suggestedDaysPerUnit };
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
    const counted = purchasedAt <= todayDateOnly();

    // 購入行の作成と積み上げ書き込みを同一トランザクションに包む（VPS管理レビューB01対応）。
    // 積み上げ側は品目行を SELECT ... FOR UPDATE でロックしてから現時点の推定残数を読むため、
    // 同一品目への同時購入でも一方の加算が失われない。どちらかが失敗すれば両方ロールバックされ、
    // 「購入だけ作成され積み上げが書き込まれない」状態にはならない。
    // 積み上げは必ず購入行の作成より先に行うこと（後にすると、積み上げの残数計算が
    // 今作成したばかりの購入自身を「直前の購入」として拾ってしまい二重加算になる）
    const log = await prisma.$transaction(async (tx) => {
      // 買い足し累積: 「直前の推定残数＋今回の購入数」を手動補正値として積み上げる。
      // 未来日付でまだ counted でない購入は、夜間バッチが counted 化するタイミングで
      // 同様に積み上がる（services/stockCalc.ts の updateCountedInInventory 参照）
      if (counted) {
        await accumulatePurchaseIntoStock(
          tx,
          data.itemId,
          req.auth.householdId,
          data.qty,
          req.auth.userId,
          'purchase_accumulated'
        );
      }

      return tx.purchaseLog.create({
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
          countedInInventory: counted,
        },
      });
    });

    await refreshStockSnapshotForItem(data.itemId);
    return reply.code(201).send({ purchase: serializePurchase(log) });
  });

  // 購入履歴の編集（数量・単価・備考の訂正用）。
  // 購入日・品目・購入元は変更しない（変更が必要なら削除して登録し直す）。
  // 数量を変えた場合、その購入が counted 済みなら積み上げ補正値も差分だけ調整する。
  // 品目行ロック→再取得→調整→更新→snapshot再計算を単一transactionで行い、
  // 途中失敗で「購入だけ更新され在庫が合わない」状態を残さない
  app.patch('/purchases/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = parseBody(purchaseEditSchema, req.body, reply);
    if (!data) return;

    const outcome = await prisma.$transaction(async (tx) => {
      const target = await tx.purchaseLog.findFirst({
        where: { id, householdId: req.auth.householdId },
      });
      if (!target) return { kind: 'not_found' as const };

      await lockItemForAccumulation(tx, target.itemId);

      // ロック取得までの間に削除・変更されていないか、ロック後に読み直して確認する
      const current = await tx.purchaseLog.findFirst({
        where: { id, householdId: req.auth.householdId },
      });
      if (!current) return { kind: 'not_found' as const };

      const deltaQty = data.qty - current.qty;
      if (deltaQty !== 0 && current.countedInInventory) {
        await adjustAccumulatedPurchaseQty(tx, current.itemId, deltaQty);
      }

      const updated = await tx.purchaseLog.update({
        where: { id },
        data: {
          qty: data.qty,
          price: data.price ?? null,
          note: data.note ?? null,
        },
      });

      await refreshStockSnapshotForItem(current.itemId, tx);
      return { kind: 'ok' as const, purchase: updated };
    });

    if (outcome.kind === 'not_found') {
      return reply.code(404).send({ message: '購入履歴が見つかりません' });
    }
    return { purchase: serializePurchase(outcome.purchase) };
  });

  // 購入履歴の削除（誤登録の取り消し用）
  app.delete('/purchases/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const log = await prisma.purchaseLog.findFirst({
      where: { id, householdId: req.auth.householdId },
    });
    if (!log) return reply.code(404).send({ message: '購入履歴が見つかりません' });

    await prisma.$transaction(async (tx) => {
      await tx.purchaseLog.delete({ where: { id } });

      // この購入が counted 済みで、買い足し累積により補正値へ加算されていた場合は、
      // 補正値からも同量を差し引いて取り消す（誤登録の取り消し時に二重に残らないように）
      if (log.countedInInventory) {
        await reverseAccumulatedPurchase(tx, log.itemId, log.qty);
      }
    });

    await refreshStockSnapshotForItem(log.itemId);
    return { ok: true };
  });
};

export default purchaseRoutes;
