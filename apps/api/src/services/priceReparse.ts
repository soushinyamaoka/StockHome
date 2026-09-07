import type { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma';
import type { ReparseResultItem } from '@stockhome/shared';
import { resolveCandidatePriceForItem, resolvePurchaseQty } from './candidateIntake';

const MAX_PLAUSIBLE_UNIT_PRICE = 1_000_000;
const REPARSE_LOOKUP_LIMIT = 50;

function isPlausiblePrice(price: number): boolean {
  return Number.isFinite(price) && price > 0 && Number.isInteger(price) && price <= MAX_PLAUSIBLE_UNIT_PRICE;
}

export class ReparseRunInvalidError extends Error {}

interface ActiveRun {
  id: string;
  importedByEmail: string;
}

// runTokenを検証し、有効なら{ id, importedByEmail }を返す。
// 無効・期限切れ・失効済みはReparseRunInvalidErrorを投げる（B03）
async function findActiveRun(runToken: string): Promise<ActiveRun> {
  const run = await prisma.priceReparseRun.findUnique({ where: { runToken } });
  if (!run || run.revokedAt || run.expiresAt.getTime() <= Date.now()) {
    throw new ReparseRunInvalidError('invalid or expired run token');
  }
  return { id: run.id, importedByEmail: run.importedByEmail };
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

function emptyResult(outcome: ApplyResult['outcome'], skipReason: string | null): ApplyResult {
  return { outcome, skipReason, purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
}

// 1候補分の判定・更新をtransaction内で行う。
// write時はPriceReparseAuditへの書き込みも同一transaction内で行い、
// data更新と監査が必ず両方成功するか両方失敗するかのどちらかになるようにする（B05）。
// dry_runは呼び出し側でtransactionを必ずrollbackするため、ここでは監査を書かない
// （dry_runの監査は呼び出し側applyOneが独立して書く）
async function applyOneInTx(
  tx: Prisma.TransactionClient,
  run: ActiveRun,
  item: ReparseResultItem,
  mode: 'dry_run' | 'write'
): Promise<ApplyResult> {
  if (item.skipReason) {
    return emptyResult('skipped', item.skipReason);
  }
  if (item.detectedPrice != null && !isPlausiblePrice(item.detectedPrice)) {
    return emptyResult('failed', 'invalid_price_rejected');
  }

  const candidate = await tx.importOrderCandidate.findUnique({ where: { id: item.candidateId } });
  if (!candidate) {
    return emptyResult('conflict', 'candidate_not_found');
  }
  // 対象runのowner以外の候補は一切触らない（B03: candidate所有者の確認）
  if (candidate.importedByEmail !== run.importedByEmail) {
    return emptyResult('conflict', 'candidate_owner_mismatch');
  }
  if (candidate.priceSource != null || candidate.detectedPrice != null) {
    return emptyResult('conflict', 'already_has_price');
  }
  const before: BeforeAfter = {
    detectedPrice: candidate.detectedPrice,
    priceSource: candidate.priceSource,
    purchasePrice: null,
  };

  // where句に detectedPrice: null も含める（B02/B04: priceSourceだけでは
  // 「price はあるが source が無い」候補への再書き込みを防げない）
  const candidateUpdate = await tx.importOrderCandidate.updateMany({
    where: { id: item.candidateId, priceSource: null, detectedPrice: null },
    data: { detectedPrice: item.detectedPrice ?? null, priceSource: item.priceSource ?? null },
  });
  if (candidateUpdate.count !== 1) {
    return { ...emptyResult('conflict', 'concurrent_update'), before };
  }
  const applied: BeforeAfter = {
    detectedPrice: item.detectedPrice ?? null,
    priceSource: item.priceSource ?? null,
    purchasePrice: null,
  };

  // write時だけ、このtransaction内でPriceReparseAuditへ書く。
  // ここで例外が起きればcandidateUpdateも含めて全てrollbackされる（B05）
  const finish = async (result: ApplyResult): Promise<ApplyResult> => {
    if (mode === 'write') {
      await tx.priceReparseAudit.create({
        data: {
          runId: run.id,
          candidateId: item.candidateId,
          purchaseId: result.purchaseId,
          beforeDetectedPrice: result.before.detectedPrice,
          beforePriceSource: result.before.priceSource,
          beforePurchasePrice: result.before.purchasePrice,
          appliedDetectedPrice: result.applied.detectedPrice,
          appliedPriceSource: result.applied.priceSource,
          appliedPurchasePrice: result.applied.purchasePrice,
          outcome: result.outcome,
          skipReason: result.skipReason,
        },
      });
    }
    return result;
  };

  if (item.detectedPrice == null) {
    return finish({ outcome: 'unchanged', skipReason: 'no_price_found', purchaseId: null, before, applied });
  }
  if (!['confirmed', 'auto_confirmed'].includes(candidate.candidateStatus) || !candidate.matchedItemId) {
    return finish({ outcome: 'updated', skipReason: null, purchaseId: null, before, applied });
  }

  // candidate.id だけでなく legacyId（移行データ）経由の紐付けも見る（B02/B06）
  const linkIds = [candidate.id, candidate.legacyId].filter((v): v is string => v != null);
  const purchases = await tx.purchaseLog.findMany({
    where: { importCandidateId: { in: linkIds }, price: null },
  });
  if (purchases.length === 0) {
    return finish({ outcome: 'updated', skipReason: null, purchaseId: null, before, applied });
  }
  if (purchases.length > 1) {
    // 複数の未確定購入が同じ候補に紐づく状態は想定外。無条件に1件を選ばず保留する
    return finish({ outcome: 'updated', skipReason: 'ambiguous_purchase_match', purchaseId: null, before, applied });
  }
  const purchase = purchases[0];
  before.purchasePrice = purchase.price;

  const matchedItem = await tx.item.findUnique({ where: { id: candidate.matchedItemId } });
  if (!matchedItem) {
    return finish({ outcome: 'updated', skipReason: 'matched_item_missing', purchaseId: purchase.id, before, applied });
  }

  // sets は purchase.qty から逆算せず、候補が持つ detectedQty（取込当時の値）から
  // 既存の resolvePurchaseQty で再計算する。qtySuspicious も固定せず実際の判定を使う（B02/B06）
  const { sets, suspicious } = resolvePurchaseQty(candidate.detectedQty, matchedItem.defaultPurchaseQty);
  const priceCheck = await resolveCandidatePriceForItem(
    { detectedPrice: item.detectedPrice, priceSource: item.priceSource ?? null },
    sets,
    suspicious,
    matchedItem.id
  );
  if (!priceCheck.reliable || priceCheck.price == null) {
    return finish({ outcome: 'updated', skipReason: 'purchase_price_unresolved', purchaseId: purchase.id, before, applied });
  }

  const purchaseUpdate = await tx.purchaseLog.updateMany({
    where: { id: purchase.id, price: null },
    data: { price: priceCheck.price },
  });
  if (purchaseUpdate.count !== 1) {
    return finish({ outcome: 'updated', skipReason: 'purchase_concurrent_update', purchaseId: purchase.id, before, applied });
  }

  return finish({
    outcome: 'updated',
    skipReason: null,
    purchaseId: purchase.id,
    before,
    applied: { ...applied, purchasePrice: priceCheck.price },
  });
}

const DRY_RUN_ROLLBACK = Symbol('dry_run_rollback');

async function applyOne(run: ActiveRun, item: ReparseResultItem, mode: 'dry_run' | 'write'): Promise<ApplyResult> {
  let captured: ApplyResult | undefined;
  try {
    await prisma.$transaction(async (tx) => {
      captured = await applyOneInTx(tx, run, item, mode);
      if (mode === 'dry_run') throw DRY_RUN_ROLLBACK;
    });
  } catch (e) {
    if (e === DRY_RUN_ROLLBACK) {
      // dry_run: データ変更は破棄されたが、判定結果の監査だけは独立して残す
      // （このinsertが失敗しても業務dataには影響しない。dry_runは元々書かない）
      if (captured) {
        const c = captured;
        await prisma.priceReparseAudit.create({
          data: {
            runId: run.id,
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
        });
      }
    } else {
      // transaction自体が失敗（DB接続断等）。このrowは何も永続化されていない
      return emptyResult('failed', 'exception');
    }
  }
  return captured ?? emptyResult('failed', 'exception');
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
      r = emptyResult('failed', 'exception');
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

// 再解析対象の一覧取得。runTokenが有効な場合のみ、そのrunのownerに紐づく候補だけを返す（B03）
export async function getReparseTargets(runToken: string, cursor: string | undefined, limit: number) {
  const run = await findActiveRun(runToken);
  return prisma.importOrderCandidate.findMany({
    where: {
      importedByEmail: run.importedByEmail,
      priceSource: null,
      detectedPrice: null,
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
): Promise<{ id: string; runToken: string; expiresAt: Date }> {
  const runToken = `rrun_${randomBytes(32).toString('hex')}`;
  const run = await prisma.priceReparseRun.create({
    data: {
      runToken,
      importedByEmail,
      householdId,
      expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
    },
  });
  return { id: run.id, runToken: run.runToken, expiresAt: run.expiresAt };
}
