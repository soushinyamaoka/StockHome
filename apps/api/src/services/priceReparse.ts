import type { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma';
import type { ReparseResultItem } from '@stockhome/shared';
import { resolveCandidatePriceForItem, resolvePurchaseQty, getRecentUnitPriceMedian } from './candidateIntake';

const MAX_PLAUSIBLE_UNIT_PRICE = 1_000_000;
const REPARSE_LOOKUP_LIMIT = 50;

function isPlausiblePrice(price: number): boolean {
  return Number.isFinite(price) && price > 0 && Number.isInteger(price) && price <= MAX_PLAUSIBLE_UNIT_PRICE;
}

export class ReparseRunInvalidError extends Error {}

interface ActiveRun {
  id: string;
  householdId: string;
  importedByEmail: string;
  cutoffAt: Date;
}

async function findActiveRun(runToken: string): Promise<ActiveRun> {
  const run = await prisma.priceReparseRun.findUnique({ where: { runToken } });
  if (!run || run.revokedAt || run.expiresAt.getTime() <= Date.now()) {
    throw new ReparseRunInvalidError('invalid or expired run token');
  }
  return { id: run.id, householdId: run.householdId, importedByEmail: run.importedByEmail, cutoffAt: run.cutoffAt };
}

// 品目の参照単価snapshotを取得する。無ければ計算して保存し、以後同じrunでは
// dry_run/write・chunk・処理順序を問わず同じ値を使い回す（第3回レビューB02/B06）。
// 同時に複数chunkが同じ品目を初めて処理しようとした場合はunique制約で競合するため、
// その場合は既存行を再取得する。tx経由ではなく独立したprismaで書くことで、
// 呼び出し元のtransactionがdry_runでrollbackされても、snapshot自体は消えない
async function getOrCreateItemSnapshot(runId: string, itemId: string): Promise<number | null> {
  const existing = await prisma.priceReparseItemSnapshot.findUnique({
    where: { runId_itemId: { runId, itemId } },
  });
  if (existing) return existing.referencePrice;

  const referencePrice = await getRecentUnitPriceMedian(itemId);
  try {
    const created = await prisma.priceReparseItemSnapshot.create({
      data: { runId, itemId, referencePrice },
    });
    return created.referencePrice;
  } catch {
    const raced = await prisma.priceReparseItemSnapshot.findUnique({
      where: { runId_itemId: { runId, itemId } },
    });
    return raced?.referencePrice ?? referencePrice;
  }
}

interface BeforeAfter {
  detectedPrice: number | null;
  priceSource: string | null;
  purchasePrice: number | null;
}
const EMPTY_BA: BeforeAfter = { detectedPrice: null, priceSource: null, purchasePrice: null };

interface ApplyResult {
  outcome: 'updated' | 'unchanged' | 'skipped' | 'conflict' | 'failed';
  skipReason: string | null;
  purchaseId: string | null;
  before: BeforeAfter;
  applied: BeforeAfter;
}

interface AuditRow {
  outcome: string;
  skipReason: string | null;
  purchaseId: string | null;
  beforeDetectedPrice: number | null;
  beforePriceSource: string | null;
  beforePurchasePrice: number | null;
  appliedDetectedPrice: number | null;
  appliedPriceSource: string | null;
  appliedPurchasePrice: number | null;
}

function auditRowToApplyResult(row: AuditRow): ApplyResult {
  return {
    outcome: row.outcome as ApplyResult['outcome'],
    skipReason: row.skipReason,
    purchaseId: row.purchaseId,
    before: {
      detectedPrice: row.beforeDetectedPrice,
      priceSource: row.beforePriceSource,
      purchasePrice: row.beforePurchasePrice,
    },
    applied: {
      detectedPrice: row.appliedDetectedPrice,
      priceSource: row.appliedPriceSource,
      purchasePrice: row.appliedPurchasePrice,
    },
  };
}

// 1候補分の判定を行い、write判定であれば同一transaction内で候補・購入も更新する
// （commitするか rollback するかは呼び出し元 applyOne が決める）。
// 早期returnも含め、ここでは監査を書かない（呼び出し元が必ず1回だけ書く。B05）
async function computeOutcome(tx: Prisma.TransactionClient, run: ActiveRun, item: ReparseResultItem): Promise<ApplyResult> {
  if (item.skipReason) {
    return { outcome: 'skipped', skipReason: item.skipReason, purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
  }
  if (item.detectedPrice != null && !isPlausiblePrice(item.detectedPrice)) {
    return { outcome: 'failed', skipReason: 'invalid_price_rejected', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
  }

  const candidate = await tx.importOrderCandidate.findUnique({ where: { id: item.candidateId } });
  if (!candidate) {
    return { outcome: 'conflict', skipReason: 'candidate_not_found', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
  }
  // household・owner・run作成時cutoffのすべてが一致する候補だけを対象にする（第3回B03）
  if (candidate.householdId !== run.householdId || candidate.importedByEmail !== run.importedByEmail) {
    return { outcome: 'conflict', skipReason: 'candidate_owner_mismatch', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
  }
  if (candidate.createdAt.getTime() > run.cutoffAt.getTime()) {
    return { outcome: 'conflict', skipReason: 'candidate_after_cutoff', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
  }
  if (candidate.priceSource != null || candidate.detectedPrice != null) {
    return { outcome: 'conflict', skipReason: 'already_has_price', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
  }
  const before: BeforeAfter = {
    detectedPrice: candidate.detectedPrice,
    priceSource: candidate.priceSource,
    purchasePrice: null,
  };

  const candidateUpdate = await tx.importOrderCandidate.updateMany({
    where: { id: item.candidateId, priceSource: null, detectedPrice: null },
    data: { detectedPrice: item.detectedPrice ?? null, priceSource: item.priceSource ?? null },
  });
  if (candidateUpdate.count !== 1) {
    return { outcome: 'conflict', skipReason: 'concurrent_update', purchaseId: null, before, applied: EMPTY_BA };
  }
  const applied: BeforeAfter = {
    detectedPrice: item.detectedPrice ?? null,
    priceSource: item.priceSource ?? null,
    purchasePrice: null,
  };

  if (item.detectedPrice == null) {
    return { outcome: 'unchanged', skipReason: 'no_price_found', purchaseId: null, before, applied };
  }
  if (!['confirmed', 'auto_confirmed'].includes(candidate.candidateStatus) || !candidate.matchedItemId) {
    return { outcome: 'updated', skipReason: null, purchaseId: null, before, applied };
  }

  // household・itemも一致するpurchaseだけを対象にする（第3回B02/B06:
  // 別householdのpurchaseが更新されるprobeを踏まえた修正）
  const linkIds = [candidate.id, candidate.legacyId].filter((v): v is string => v != null);
  const purchases = await tx.purchaseLog.findMany({
    where: {
      importCandidateId: { in: linkIds },
      price: null,
      householdId: run.householdId,
      itemId: candidate.matchedItemId,
    },
  });
  if (purchases.length === 0) {
    return { outcome: 'updated', skipReason: null, purchaseId: null, before, applied };
  }
  if (purchases.length > 1) {
    return { outcome: 'updated', skipReason: 'ambiguous_purchase_match', purchaseId: null, before, applied };
  }
  const purchase = purchases[0];
  before.purchasePrice = purchase.price;

  const matchedItem = await tx.item.findUnique({
    where: { id: candidate.matchedItemId },
  });
  if (!matchedItem || matchedItem.householdId !== run.householdId) {
    return { outcome: 'updated', skipReason: 'matched_item_missing', purchaseId: purchase.id, before, applied };
  }

  const { sets, suspicious } = resolvePurchaseQty(candidate.detectedQty, matchedItem.defaultPurchaseQty);
  // 層3の判定に使う参照単価は、run内で最初に必要になった時点でsnapshotを取り、
  // 以後dry_run/write・chunk・順序を問わず同じ値を使う（第3回B02/B06）
  const referencePrice = await getOrCreateItemSnapshot(run.id, matchedItem.id);
  const priceCheck = await resolveCandidatePriceForItem(
    { detectedPrice: item.detectedPrice, priceSource: item.priceSource ?? null },
    sets,
    suspicious,
    matchedItem.id,
    { referencePriceOverride: referencePrice }
  );
  if (!priceCheck.reliable || priceCheck.price == null) {
    return { outcome: 'updated', skipReason: 'purchase_price_unresolved', purchaseId: purchase.id, before, applied };
  }

  const purchaseUpdate = await tx.purchaseLog.updateMany({
    where: { id: purchase.id, price: null, householdId: run.householdId },
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

const ROLLBACK = Symbol('reparse_rollback');

// write: 冪等（同一(run,candidate,mode='write')の再送は保存済み結果をそのまま返し、
// 再判定・再更新しない）。同時実行で監査insertが競合した場合は自分の更新を破棄し、
// 先に確定した側の結果を返す。
// dry_run: 常に再計算し、同じ(run,candidate,mode='dry_run')行へupsertする
// （再実行のたびに監査が増えないようにする。第3回B02/B04）
async function applyOne(run: ActiveRun, item: ReparseResultItem, mode: 'dry_run' | 'write'): Promise<ApplyResult> {
  if (mode === 'write') {
    const existingAudit = await prisma.priceReparseAudit.findUnique({
      where: { runId_candidateId_mode: { runId: run.id, candidateId: item.candidateId, mode: 'write' } },
    });
    if (existingAudit) {
      return auditRowToApplyResult(existingAudit);
    }
  }

  let captured: ApplyResult | undefined;
  let rollbackReason: 'dry_run' | 'audit_race_lost' | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      captured = await computeOutcome(tx, run, item);
      if (mode === 'dry_run') {
        rollbackReason = 'dry_run';
        throw ROLLBACK;
      }
      try {
        await tx.priceReparseAudit.create({
          data: {
            runId: run.id,
            mode: 'write',
            candidateId: item.candidateId,
            purchaseId: captured.purchaseId,
            beforeDetectedPrice: captured.before.detectedPrice,
            beforePriceSource: captured.before.priceSource,
            beforePurchasePrice: captured.before.purchasePrice,
            appliedDetectedPrice: captured.applied.detectedPrice,
            appliedPriceSource: captured.applied.priceSource,
            appliedPurchasePrice: captured.applied.purchasePrice,
            outcome: captured.outcome,
            skipReason: captured.skipReason,
          },
        });
      } catch {
        // 同じ(run, candidate, write)へ同時に別プロセスが先に監査を作った。
        // 自分の更新は破棄し、勝った側の結果を後で取得する
        rollbackReason = 'audit_race_lost';
        throw ROLLBACK;
      }
    });
  } catch (e) {
    if (e !== ROLLBACK) {
      return { outcome: 'failed', skipReason: 'exception', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
    }
  }

  if (rollbackReason === 'audit_race_lost') {
    const winning = await prisma.priceReparseAudit.findUnique({
      where: { runId_candidateId_mode: { runId: run.id, candidateId: item.candidateId, mode: 'write' } },
    });
    return winning
      ? auditRowToApplyResult(winning)
      : { outcome: 'failed', skipReason: 'exception', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
  }

  if (rollbackReason === 'dry_run' && captured) {
    const c = captured;
    await prisma.priceReparseAudit.upsert({
      where: { runId_candidateId_mode: { runId: run.id, candidateId: item.candidateId, mode: 'dry_run' } },
      create: {
        runId: run.id,
        mode: 'dry_run',
        candidateId: item.candidateId,
        purchaseId: c.purchaseId,
        beforeDetectedPrice: c.before.detectedPrice,
        beforePriceSource: c.before.priceSource,
        beforePurchasePrice: c.before.purchasePrice,
        appliedDetectedPrice: c.applied.detectedPrice,
        appliedPriceSource: c.applied.priceSource,
        appliedPurchasePrice: c.applied.purchasePrice,
        outcome: `dry_run_${c.outcome}`,
        skipReason: c.skipReason,
      },
      update: {
        purchaseId: c.purchaseId,
        beforeDetectedPrice: c.before.detectedPrice,
        beforePriceSource: c.before.priceSource,
        beforePurchasePrice: c.before.purchasePrice,
        appliedDetectedPrice: c.applied.detectedPrice,
        appliedPriceSource: c.applied.priceSource,
        appliedPurchasePrice: c.applied.purchasePrice,
        outcome: `dry_run_${c.outcome}`,
        skipReason: c.skipReason,
      },
    });
  }

  return captured ?? { outcome: 'failed', skipReason: 'exception', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
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

export async function processReparseResults(
  runToken: string,
  mode: 'dry_run' | 'write',
  results: ReparseResultItem[]
): Promise<ReparseOutcomeCounts> {
  const run = await findActiveRun(runToken);

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
    let r: ApplyResult;
    try {
      r = await applyOne(run, item, mode);
    } catch {
      r = { outcome: 'failed', skipReason: 'exception', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
    }
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

// 再解析対象の一覧取得。runの owner・household・cutoff に一致する候補だけを返す（B03/B02）
export async function getReparseTargets(runToken: string, cursor: string | undefined, limit: number) {
  const run = await findActiveRun(runToken);
  return prisma.importOrderCandidate.findMany({
    where: {
      householdId: run.householdId,
      importedByEmail: run.importedByEmail,
      priceSource: null,
      detectedPrice: null,
      createdAt: { lte: run.cutoffAt },
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    orderBy: { id: 'asc' },
    take: Math.min(limit, REPARSE_LOOKUP_LIMIT),
    select: { id: true, mailMessageId: true, itemNameRaw: true, vendor: true, mailPhase: true },
  });
}

// 運用者が事前に1件だけ発行する（HTTP非公開）。production承認後、手動scriptから呼ぶ想定。
// 本task範囲では呼び出し元（一回限りのscript等）は作成しない。関数のみ用意する
export async function createReparseRun(
  importedByEmail: string,
  householdId: string,
  expiresInHours = 72
): Promise<{ id: string; runToken: string; cutoffAt: Date; expiresAt: Date }> {
  const runToken = `rrun_${randomBytes(32).toString('hex')}`;
  const cutoffAt = new Date();
  const run = await prisma.priceReparseRun.create({
    data: {
      runToken,
      importedByEmail,
      householdId,
      cutoffAt,
      expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
    },
  });
  return { id: run.id, runToken: run.runToken, cutoffAt: run.cutoffAt, expiresAt: run.expiresAt };
}
