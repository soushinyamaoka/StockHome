import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma';
import { formatDateOnly } from '../utils/date';
import { candidateOwnerFilter } from './importCandidates';

const reflectionRoutes: FastifyPluginAsync = async (app) => {
  // 反映記録ログ（本人分のみ。新しい順）
  app.get('/', async (req) => {
    const { limit } = req.query as { limit?: string };
    const take = Math.min(Math.max(parseInt(limit ?? '100', 10) || 100, 1), 200);

    // Gmail経由（自動確定・手動確定の両方）: 本人が取り込んだ候補 + 所有者不明の旧データ
    const ownerFilter = await candidateOwnerFilter(req.auth.userId);
    const candidates = await prisma.importOrderCandidate.findMany({
      where: {
        householdId: req.auth.householdId,
        ...ownerFilter,
        candidateStatus: { in: ['confirmed', 'auto_confirmed'] },
      },
      select: { id: true, legacyId: true, itemNameRaw: true, vendor: true },
    });
    const candidateLookup = new Map<
      string,
      { itemNameRaw: string | null; vendor: string }
    >();
    for (const c of candidates) {
      candidateLookup.set(c.id, { itemNameRaw: c.itemNameRaw, vendor: c.vendor });
      if (c.legacyId) {
        candidateLookup.set(c.legacyId, { itemNameRaw: c.itemNameRaw, vendor: c.vendor });
      }
    }
    const candidateKeys = [...candidateLookup.keys()];

    const logs = await prisma.purchaseLog.findMany({
      where: {
        householdId: req.auth.householdId,
        OR: [
          // 本人が登録者の購入すべて。sourceType で絞らないのは、GAS 移行データに
          // import_candidate_id の参照先候補が残っていない gmail_auto があり、
          // 候補経由の突合だけでは本人の反映記録が欠落するため。
          // 他人の候補は candidateOwnerFilter により確定できない（=purchasedByUserId に
          // ならない）ので、この条件で可視範囲が広がることはない
          { purchasedByUserId: req.auth.userId },
          ...(candidateKeys.length
            ? [{ importCandidateId: { in: candidateKeys } }]
            : []),
        ],
      },
      orderBy: [{ purchasedAt: 'desc' }, { createdAt: 'desc' }],
      take,
      include: { item: { select: { itemName: true, unit: true } } },
    });

    return {
      reflections: logs.map((l) => {
        const candidate = l.importCandidateId
          ? candidateLookup.get(l.importCandidateId)
          : undefined;
        const category: 'auto' | 'manual' =
          l.sourceType === 'gmail_auto_confirmed' ? 'auto' : 'manual';
        return {
          id: l.id,
          occurredAt: formatDateOnly(l.purchasedAt),
          itemNameRaw: candidate?.itemNameRaw ?? null,
          matchedItemName: l.item.itemName,
          qty: l.qty,
          unit: l.item.unit,
          category,
          vendor: candidate?.vendor ?? null,
        };
      }),
    };
  });
};

export default reflectionRoutes;
