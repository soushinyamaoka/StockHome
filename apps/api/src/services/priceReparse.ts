import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { ReparseResultItem } from '@stockhome/shared';
import { resolveCandidatePriceForItem } from './candidateIntake';

// household consumableの単価としてこれを超える検出値は誤解析の可能性が高いため、
// 自動適用せず失敗として扱う（VPS管理レビューB06: 異常値の更新拒否）
const MAX_PLAUSIBLE_UNIT_PRICE = 1_000_000;

function isPlausiblePrice(price: number): boolean {
  return Number.isFinite(price) && price > 0 && Number.isInteger(price) && price <= MAX_PLAUSIBLE_UNIT_PRICE;
}

interface BeforeAfter {
  detectedPrice: number | null;
  priceSource: string | null;
  purchasePrice: number | null;
}

interface ApplyResult {
  outcome: 'updated' | 'unchanged' | 'skipped' | 'conflict' | 'failed';
  skipReason: string | null;
  purchaseId: string | null;
  before: BeforeAfter;
  applied: BeforeAfter;
}

const EMPTY_BA: BeforeAfter = { detectedPrice: null, priceSource: null, purchasePrice: null };

// 1候補分の判定・更新を transaction 内で行う。write/dry_run どちらも本関数を通し、
// dry_run は呼び出し側で transaction を必ず rollback することで
// 「判定はするが書かない」を実現する（write と dry_run のロジック分岐を作らない）
async function applyOneInTx(tx: Prisma.TransactionClient, item: ReparseResultItem): Promise<ApplyResult> {
  if (item.skipReason) {
    return { outcome: 'skipped', skipReason: item.skipReason, purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
  }
  if (item.detectedPrice != null && !isPlausiblePrice(item.detectedPrice)) {
    return { outcome: 'failed', skipReason: 'invalid_price_rejected', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
  }

  const candidate = await tx.importOrderCandidate.findUnique({ where: { id: item.candidateId } });
  if (!candidate || candidate.priceSource != null) {
    return { outcome: 'conflict', skipReason: 'already_has_price_source', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
  }
  const before: BeforeAfter = { detectedPrice: candidate.detectedPrice, priceSource: candidate.priceSource, purchasePrice: null };

  // where句に priceSource: null を再度含めることで、findUnique からここまでの間に
  // 別プロセスが同じ行を更新していないかを更新件数で確認する（同時実行対策、B04）
  const candidateUpdate = await tx.importOrderCandidate.updateMany({
    where: { id: item.candidateId, priceSource: null },
    data: { detectedPrice: item.detectedPrice ?? null, priceSource: item.priceSource ?? null },
  });
  if (candidateUpdate.count !== 1) {
    return { outcome: 'conflict', skipReason: 'concurrent_update', purchaseId: null, before, applied: EMPTY_BA };
  }
  const applied: BeforeAfter = { detectedPrice: item.detectedPrice ?? null, priceSource: item.priceSource ?? null, purchasePrice: null };

  if (item.detectedPrice == null) {
    return { outcome: 'unchanged', skipReason: 'no_price_found', purchaseId: null, before, applied };
  }
  if (!['confirmed', 'auto_confirmed'].includes(candidate.candidateStatus) || !candidate.matchedItemId) {
    return { outcome: 'updated', skipReason: null, purchaseId: null, before, applied };
  }

  const purchase = await tx.purchaseLog.findFirst({ where: { importCandidateId: candidate.id, price: null } });
  if (!purchase) {
    return { outcome: 'updated', skipReason: null, purchaseId: null, before, applied };
  }
  before.purchasePrice = purchase.price;

  const matchedItem = await tx.item.findUnique({ where: { id: candidate.matchedItemId } });
  if (!matchedItem) {
    return { outcome: 'updated', skipReason: 'matched_item_missing', purchaseId: purchase.id, before, applied };
  }

  const sets = Math.max(1, Math.round(purchase.qty / matchedItem.defaultPurchaseQty));
  const priceCheck = await resolveCandidatePriceForItem(
    { detectedPrice: item.detectedPrice, priceSource: item.priceSource ?? null },
    sets,
    false,
    matchedItem.id
  );
  if (!priceCheck.reliable || priceCheck.price == null) {
    return { outcome: 'updated', skipReason: 'purchase_price_unresolved', purchaseId: purchase.id, before, applied };
  }

  const purchaseUpdate = await tx.purchaseLog.updateMany({
    where: { id: purchase.id, price: null },
    data: { price: priceCheck.price },
  });
  if (purchaseUpdate.count !== 1) {
    return { outcome: 'updated', skipReason: 'purchase_concurrent_update', purchaseId: purchase.id, before, applied };
  }

  return {
    outcome: 'updated',
    skipReason: null,
    purchaseId: purchase.id,
    before,
    applied: { ...applied, purchasePrice: priceCheck.price },
  };
}

const DRY_RUN_ROLLBACK = Symbol('dry_run_rollback');

async function applyOne(item: ReparseResultItem, mode: 'dry_run' | 'write'): Promise<ApplyResult> {
  let captured: ApplyResult | undefined;
  try {
    await prisma.$transaction(async (tx) => {
      captured = await applyOneInTx(tx, item);
      if (mode === 'dry_run') throw DRY_RUN_ROLLBACK;
    });
  } catch (e) {
    if (e !== DRY_RUN_ROLLBACK) {
      return { outcome: 'failed', skipReason: 'exception', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
    }
  }
  return captured!;
}

export interface ReparseOutcomeCounts {
  total: number;
  updatedCandidate: number;
  updatedPurchase: number;
  unchanged: number;
  skipped: number;
  conflict: number;
  failed: number;
  bySkipReason: Record<string, number>;
}

// dry_run/write共通の入口。呼び出しごとに PriceReparseAudit へ1行ずつ記録し、
// 集計値だけを返す（row内容は返さない。B02のdry-run/write分離・B05の監査要件）
export async function processReparseResults(
  runId: string,
  mode: 'dry_run' | 'write',
  results: ReparseResultItem[]
): Promise<ReparseOutcomeCounts> {
  const counts: ReparseOutcomeCounts = {
    total: 0,
    updatedCandidate: 0,
    updatedPurchase: 0,
    unchanged: 0,
    skipped: 0,
    conflict: 0,
    failed: 0,
    bySkipReason: {},
  };
  for (const item of results) {
    counts.total++;
    const r = await applyOne(item, mode);
    await prisma.priceReparseAudit.create({
      data: {
        runId,
        candidateId: item.candidateId,
        purchaseId: r.purchaseId,
        beforeDetectedPrice: r.before.detectedPrice,
        beforePriceSource: r.before.priceSource,
        beforePurchasePrice: r.before.purchasePrice,
        appliedDetectedPrice: r.applied.detectedPrice,
        appliedPriceSource: r.applied.priceSource,
        appliedPurchasePrice: r.applied.purchasePrice,
        outcome: mode === 'dry_run' ? `dry_run_${r.outcome}` : r.outcome,
        skipReason: r.skipReason,
      },
    });
    if (r.outcome === 'updated') {
      counts.updatedCandidate++;
      if (r.applied.purchasePrice != null) counts.updatedPurchase++;
    } else if (r.outcome === 'unchanged') counts.unchanged++;
    else if (r.outcome === 'skipped') counts.skipped++;
    else if (r.outcome === 'conflict') counts.conflict++;
    else if (r.outcome === 'failed') counts.failed++;
    if (r.skipReason) counts.bySkipReason[r.skipReason] = (counts.bySkipReason[r.skipReason] ?? 0) + 1;
  }
  return counts;
}

// 再解析対象の一覧取得。呼び出し元が自己申告した email に紐づく候補だけを返す（B03）。
// price_source が既に入っている、または過去に一度も価格を検出できなかった行以外
// （detectedPrice が既にある行）は対象外にする（B02: 既に値がある行は触らない）
export async function getReparseTargets(email: string, cursor: string | undefined, limit: number) {
  return prisma.importOrderCandidate.findMany({
    where: {
      importedByEmail: email,
      priceSource: null,
      detectedPrice: null,
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true, mailMessageId: true, itemNameRaw: true, vendor: true, mailPhase: true },
  });
}
