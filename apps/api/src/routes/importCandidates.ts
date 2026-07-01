import type { FastifyPluginAsync } from 'fastify';
import type { Prisma } from '@prisma/client';
import { candidateConfirmSchema } from '@stockhome/shared';
import { prisma } from '../lib/prisma';
import { parseBody } from '../utils/validate';
import { serializeCandidate, serializePurchase } from '../utils/serialize';
import { createPurchaseLogFromCandidate } from '../services/candidateIntake';

// 取込候補の可視範囲（GAS 版 getImportCandidatesForView 準拠）:
//   自分が取り込んだ候補（メール or 旧user_id一致） + 所有者不明の旧データ のみ。
//   家族でも他人の Gmail 由来の候補は見せない
export async function candidateOwnerFilter(
  userId: string
): Promise<Prisma.ImportOrderCandidateWhereInput> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return {
    OR: [
      { importedByUserId: null, importedByEmail: null }, // 所有者不明（旧データ等）
      ...(user?.email ? [{ importedByEmail: user.email }] : []),
      ...(user?.legacyId ? [{ importedByUserId: user.legacyId }] : []),
    ],
  };
}

const importCandidateRoutes: FastifyPluginAsync = async (app) => {
  // 候補一覧（既定は未解決のみ: detected / ordered / shipped。mail_date 降順）
  // 確定/自動確定済みには「どう購入履歴・在庫に反映されたか」(reflection) を付与する
  app.get('/', async (req) => {
    const { includeResolved } = req.query as { includeResolved?: string };
    const ownerFilter = await candidateOwnerFilter(req.auth.userId);
    const candidates = await prisma.importOrderCandidate.findMany({
      where: {
        householdId: req.auth.householdId,
        ...ownerFilter,
        ...(includeResolved === 'true'
          ? {}
          : { candidateStatus: { in: ['detected', 'ordered', 'shipped'] } }),
      },
      orderBy: { mailDate: 'desc' },
      take: 200,
    });

    // 確定系候補に紐づく purchase_log と品目を一括取得して反映状況を組み立てる。
    // purchase_log.import_candidate_id は新候補の cuid（新規確定分）か、
    // 旧GASの candidate_id（移行データ）のどちらか。candidate.legacyId でも突合する
    const confirmed = candidates.filter(
      (c) => c.candidateStatus === 'confirmed' || c.candidateStatus === 'auto_confirmed'
    );
    const lookupIds = confirmed.flatMap((c) => [c.id, ...(c.legacyId ? [c.legacyId] : [])]);

    const purchases = lookupIds.length
      ? await prisma.purchaseLog.findMany({
          where: { importCandidateId: { in: lookupIds } },
          include: { item: { select: { itemName: true, isActive: true, unit: true } } },
        })
      : [];
    const purchaseByKey = new Map(purchases.map((p) => [p.importCandidateId!, p]));

    return {
      candidates: candidates.map((c) => {
        const base = serializeCandidate(c);
        const p = purchaseByKey.get(c.id) ?? (c.legacyId ? purchaseByKey.get(c.legacyId) : undefined);
        if (!p) return base;
        return {
          ...base,
          reflection: {
            matchedItemName: p.item.itemName,
            matchedItemActive: p.item.isActive,
            qty: p.qty,
            unit: p.item.unit,
            inventoryEffectiveAt: p.inventoryEffectiveAt
              ? p.inventoryEffectiveAt.toISOString().slice(0, 10)
              : null,
            countedInInventory: p.countedInInventory,
          },
        };
      }),
    };
  });

  // 候補の確定（品目に紐付けて purchase_log へ反映。GAS confirmImportCandidate 相当）
  app.post('/:id/confirm', async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = parseBody(candidateConfirmSchema, req.body, reply);
    if (!data) return;

    const ownerFilter = await candidateOwnerFilter(req.auth.userId);
    const candidate = await prisma.importOrderCandidate.findFirst({
      where: { id, householdId: req.auth.householdId, ...ownerFilter },
    });
    if (!candidate) return reply.code(404).send({ message: '取込候補が見つかりません' });

    if (candidate.candidateStatus === 'confirmed' || candidate.candidateStatus === 'auto_confirmed') {
      return reply.code(409).send({ message: 'この候補は既に確定済みです' });
    }
    if (candidate.candidateStatus === 'ignored') {
      return reply.code(409).send({ message: 'この候補は無視済みです' });
    }

    const purchase = await createPurchaseLogFromCandidate(
      candidate,
      data.matchedItemId,
      req.auth.userId,
      'gmail_auto'
    );

    const updated = await prisma.importOrderCandidate.update({
      where: { id },
      data: { candidateStatus: 'confirmed', matchedItemId: data.matchedItemId },
    });

    return {
      candidate: serializeCandidate(updated),
      purchase: serializePurchase(purchase),
    };
  });

  // 候補の無視
  app.post('/:id/ignore', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ownerFilter = await candidateOwnerFilter(req.auth.userId);
    const candidate = await prisma.importOrderCandidate.findFirst({
      where: { id, householdId: req.auth.householdId, ...ownerFilter },
    });
    if (!candidate) return reply.code(404).send({ message: '取込候補が見つかりません' });

    const updated = await prisma.importOrderCandidate.update({
      where: { id },
      data: { candidateStatus: 'ignored' },
    });
    return { candidate: serializeCandidate(updated) };
  });
};

export default importCandidateRoutes;
