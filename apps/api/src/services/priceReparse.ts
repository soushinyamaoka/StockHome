import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma';
import type { ReparseResultItem } from '@stockhome/shared';
import { resolveCandidatePriceForItem, resolvePurchaseQty, getRecentUnitPriceMedian } from './candidateIntake';

const MAX_PLAUSIBLE_UNIT_PRICE = 1_000_000;
const REPARSE_LOOKUP_LIMIT = 50;
const CREATE_RUN_MAX_ATTEMPTS = 3;

function isPlausiblePrice(price: number): boolean {
  return Number.isFinite(price) && price > 0 && Number.isInteger(price) && price <= MAX_PLAUSIBLE_UNIT_PRICE;
}

function isUniqueConstraintViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

// SERIALIZABLE transactionでPostgresが書き込みskewを検出したときのエラーコード。
// Prisma Clientはこれを P2034 として表す（第5回レビューR5-03対応）
function isSerializationFailure(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
}

export class ReparseRunInvalidError extends Error {}

interface RunRecord {
  id: string;
  householdId: string;
  importedByEmail: string;
  cutoffAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

interface ActiveRun {
  id: string;
  householdId: string;
  importedByEmail: string;
  cutoffAt: Date;
}

// runTokenが指すrunをそのまま返す（期限切れ・失効の判定はしない）。
// getReparseRunProgressのように、期限切れ後も進捗確認したい呼び出し元が使う
// （第5回レビューR5-02対応）
async function findRunByToken(runToken: string): Promise<RunRecord> {
  const run = await prisma.priceReparseRun.findUnique({ where: { runToken } });
  if (!run) {
    throw new ReparseRunInvalidError('run token not found');
  }
  return run;
}

// 有効な（未失効・未期限切れ）runだけを返す。新規に対象を取得・書き込みを行う
// エンドポイントはこちらを使う
async function findActiveRun(runToken: string): Promise<ActiveRun> {
  const run = await findRunByToken(runToken);
  if (run.revokedAt || run.expiresAt.getTime() <= Date.now()) {
    throw new ReparseRunInvalidError('invalid or expired run token');
  }
  return { id: run.id, householdId: run.householdId, importedByEmail: run.importedByEmail, cutoffAt: run.cutoffAt };
}

// 品目の参照単価snapshotを取得する。無ければ計算して保存し、以後同じrunでは
// dry_run/write・chunk・処理順序を問わず同じ値を使い回す（第3回レビューB02/B06）。
// 同時に複数chunkが同じ品目を初めて処理しようとした場合はunique制約(P2002)で競合するため、
// その場合だけ既存行を再取得する。それ以外の例外（DB接続断等）は再throwし、呼び出し元の
// transaction全体を失敗させる（第5回レビューR5-04対応。以前は全例外を競合とみなし、
// 再取得できなければ計算値をそのまま返してしまっていた）
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
  } catch (e) {
    if (!isUniqueConstraintViolation(e)) throw e;
    const raced = await prisma.priceReparseItemSnapshot.findUnique({
      where: { runId_itemId: { runId, itemId } },
    });
    if (!raced) {
      throw new Error(`reparse item snapshot race detected without a winning row (run=${runId}, item=${itemId})`);
    }
    return raced.referencePrice;
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
// 早期returnも含め、ここでは監査を書かない（呼び出し元が必ず1回だけ書く。B05）。
// household・owner・cutoffの境界チェックは、skip/invalid判定を含む「どのoutcomeを
// 返す場合でも」必ず最初に行う（第4回R4-02）。matched itemを使う候補では、
// candidateへの価格書き込み（updateMany）より前にmatched itemのhouseholdを確認し、
// 不一致ならcandidate・purchaseとも一切変更せずconflictにする
// （第5回レビューR5-01対応。以前はcandidate更新後に確認していたため、不一致でも
// candidate更新が確定してしまっていた）
async function computeOutcome(tx: Prisma.TransactionClient, run: ActiveRun, item: ReparseResultItem): Promise<ApplyResult> {
  const candidate = await tx.importOrderCandidate.findUnique({ where: { id: item.candidateId } });
  if (!candidate) {
    return { outcome: 'conflict', skipReason: 'candidate_not_found', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
  }
  if (candidate.householdId !== run.householdId || candidate.importedByEmail !== run.importedByEmail) {
    return { outcome: 'conflict', skipReason: 'candidate_owner_mismatch', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
  }
  if (candidate.createdAt.getTime() > run.cutoffAt.getTime()) {
    return { outcome: 'conflict', skipReason: 'candidate_after_cutoff', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
  }

  const manifestMember = await tx.priceReparseTarget.findUnique({
    where: { runId_candidateId: { runId: run.id, candidateId: item.candidateId } },
  });
  if (!manifestMember) {
    // run作成時点で対象外だった候補は、household・owner・cutoffが一致していても
    // 固定manifestに所属しない限り処理対象として認可しない（第6回レビューR6-01対応）
    return { outcome: 'conflict', skipReason: 'candidate_not_in_manifest', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
  }

  if (item.skipReason) {
    return { outcome: 'skipped', skipReason: item.skipReason, purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
  }
  if (item.detectedPrice != null && !isPlausiblePrice(item.detectedPrice)) {
    return { outcome: 'failed', skipReason: 'invalid_price_rejected', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
  }
  if (candidate.priceSource != null || candidate.detectedPrice != null) {
    return { outcome: 'conflict', skipReason: 'already_has_price', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
  }

  const usesMatchedItem =
    ['confirmed', 'auto_confirmed'].includes(candidate.candidateStatus) && candidate.matchedItemId != null;
  let matchedItem: { id: string; householdId: string; defaultPurchaseQty: number } | null = null;
  if (usesMatchedItem) {
    matchedItem = await tx.item.findUnique({ where: { id: candidate.matchedItemId as string } });
    if (!matchedItem || matchedItem.householdId !== run.householdId) {
      // candidate更新（updateMany）より前に検知するため、ここではcandidate・purchaseの
      // どちらも一切変更していない（第5回レビューR5-01対応）
      return { outcome: 'conflict', skipReason: 'matched_item_missing', purchaseId: null, before: EMPTY_BA, applied: EMPTY_BA };
    }
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
  if (!usesMatchedItem || !matchedItem) {
    return { outcome: 'updated', skipReason: null, purchaseId: null, before, applied };
  }

  const linkIds = [candidate.id, candidate.legacyId].filter((v): v is string => v != null);
  const purchases = await tx.purchaseLog.findMany({
    where: {
      importCandidateId: { in: linkIds },
      price: null,
      householdId: run.householdId,
      itemId: matchedItem.id,
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

  const { sets, suspicious } = resolvePurchaseQty(candidate.detectedQty, matchedItem.defaultPurchaseQty);
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

// write: 冪等（同一(run,candidate,mode='write')の再送は保存済み結果をそのまま返す）。
// ただしcandidate_not_in_manifestは「業務対象外」として扱い、data・監査とも
// 一切変更せずに拒否する（第7回レビューR7-02対応。第6回レビュー§13.3が指定した
// 「manifest非所属candidateをdata/audit不変で拒否する」設計に合わせる。dry_run/write
// どちらのmodeでも同じ扱いにする。このため、manifest外candidateIdへの再送は
// 毎回同じ判定を再実行するが、判定自体は読み取りだけで安価であり問題ない）
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
  let auditRaceLost = false;
  try {
    await prisma.$transaction(async (tx) => {
      captured = await computeOutcome(tx, run, item);
      if (captured.skipReason === 'candidate_not_in_manifest') {
        throw ROLLBACK;
      }
      if (mode === 'dry_run') {
        throw ROLLBACK;
      }
      const toWrite = captured;
      try {
        await tx.priceReparseAudit.create({
          data: {
            runId: run.id,
            mode: 'write',
            candidateId: item.candidateId,
            purchaseId: toWrite.purchaseId,
            beforeDetectedPrice: toWrite.before.detectedPrice,
            beforePriceSource: toWrite.before.priceSource,
            beforePurchasePrice: toWrite.before.purchasePrice,
            appliedDetectedPrice: toWrite.applied.detectedPrice,
            appliedPriceSource: toWrite.applied.priceSource,
            appliedPurchasePrice: toWrite.applied.purchasePrice,
            outcome: toWrite.outcome,
            skipReason: toWrite.skipReason,
          },
        });
      } catch (e) {
        if (!isUniqueConstraintViolation(e)) throw e;
        auditRaceLost = true;
        throw ROLLBACK;
      }
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }

  if (auditRaceLost) {
    const winning = await prisma.priceReparseAudit.findUnique({
      where: { runId_candidateId_mode: { runId: run.id, candidateId: item.candidateId, mode: 'write' } },
    });
    if (!winning) {
      throw new Error(`reparse audit race detected without a winning row (run=${run.id}, candidate=${item.candidateId})`);
    }
    return auditRowToApplyResult(winning);
  }

  if (captured && captured.skipReason === 'candidate_not_in_manifest') {
    return captured;
  }

  if (mode === 'dry_run') {
    if (!captured) {
      throw new Error(`reparse computeOutcome produced no result (run=${run.id}, candidate=${item.candidateId})`);
    }
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
    return c;
  }

  if (!captured) {
    throw new Error(`reparse computeOutcome produced no result (run=${run.id}, candidate=${item.candidateId})`);
  }
  return captured;
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
    const r = await applyOne(run, item, mode);
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

// 再解析対象の一覧取得。固定manifestのうち、mode='write'監査がまだ付いていない
// candidateだけをID昇順で返す（第6回レビューR6-01対応）
export async function getReparseTargets(runToken: string, cursor: string | undefined, limit: number) {
  const run = await findActiveRun(runToken);

  const [targets, processedAudits] = await Promise.all([
    prisma.priceReparseTarget.findMany({ where: { runId: run.id }, select: { candidateId: true } }),
    prisma.priceReparseAudit.findMany({ where: { runId: run.id, mode: 'write' }, select: { candidateId: true } }),
  ]);
  const processedIds = new Set(processedAudits.map((audit) => audit.candidateId));
  const remainingIds = targets
    .map((target) => target.candidateId)
    .filter((id) => !processedIds.has(id))
    .sort();
  const pageIds = remainingIds
    .filter((id) => (cursor ? id > cursor : true))
    .slice(0, Math.min(limit, REPARSE_LOOKUP_LIMIT));

  if (pageIds.length === 0) return [];

  const candidates = await prisma.importOrderCandidate.findMany({
    where: { id: { in: pageIds } },
    select: { id: true, mailMessageId: true, itemNameRaw: true, vendor: true, mailPhase: true },
  });
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return pageIds
    .map((id) => byId.get(id))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate != null);
}

export interface ReparseRunProgress {
  totalTargets: number;
  processedCount: number;
  remainingCount: number;
  complete: boolean;
}

// runの進捗を、createReparseRun時点で固定したprice_reparse_targets manifestと
// mode='write'監査の存在だけから算出する（第5回レビューR5-02対応）。
// - totalTargets: manifestの件数（run作成後に他経路で価格が確定した候補も含めて
//   不変。動的なNULL条件を使わないため、母数が外部要因で変化しない）
// - processedCount: manifestに含まれる候補のうち、このrunのmode='write'監査が
//   付いているものの数（別経路で価格が確定しただけではprocessedにならない）
// - findActiveRunではなくfindRunByTokenを使うため、期限切れ・失効後のrunでも
//   進捗を取得できる
export async function getReparseRunProgress(runToken: string): Promise<ReparseRunProgress> {
  const run = await findRunByToken(runToken);

  const [targets, processedAudits] = await Promise.all([
    prisma.priceReparseTarget.findMany({ where: { runId: run.id }, select: { candidateId: true } }),
    prisma.priceReparseAudit.findMany({
      where: { runId: run.id, mode: 'write' },
      select: { candidateId: true },
    }),
  ]);

  const targetIds = new Set(targets.map((t) => t.candidateId));
  const processedIds = new Set(processedAudits.map((a) => a.candidateId).filter((id) => targetIds.has(id)));
  const totalTargets = targetIds.size;
  const processedCount = processedIds.size;

  return {
    totalTargets,
    processedCount,
    remainingCount: totalTargets - processedCount,
    complete: totalTargets === 0 || processedCount === totalTargets,
  };
}

// production承認後、運用者が事前に1件だけ発行する（HTTP非公開）。SERIALIZABLE
// transactionで「同一householdの有効run有無チェック」「run作成」「対象manifestの
// 書き込み」を直列化し、同時発行を防ぐ（第5回レビューR5-03対応。findFirst→createの
// 2queryだけではTOCTOUで両方が成功し得た）。P2034（serialization failure）は
// Postgresが書き込みskewを検出した合図であり、再試行すれば安全に解決できるため
// 最大3回まで再試行する。run作成と同時に対象候補IDをprice_reparse_targetsへ
// 書き込み、対象集合をrun開始時点で固定する（第5回レビューR5-02対応）
export async function createReparseRun(
  importedByEmail: string,
  householdId: string,
  expiresInHours = 72
): Promise<{ id: string; runToken: string; cutoffAt: Date; expiresAt: Date }> {
  for (let attempt = 1; attempt <= CREATE_RUN_MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const now = new Date();
          const activeRun = await tx.priceReparseRun.findFirst({
            where: { householdId, revokedAt: null, expiresAt: { gt: now } },
          });
          if (activeRun) {
            throw new Error(
              `an active price reparse run already exists for this household (id=${activeRun.id}). revoke it (set revokedAt) before creating a new one.`
            );
          }

          const runToken = `rrun_${randomBytes(32).toString('hex')}`;
          const run = await tx.priceReparseRun.create({
            data: {
              runToken,
              importedByEmail,
              householdId,
              cutoffAt: now,
              expiresAt: new Date(now.getTime() + expiresInHours * 60 * 60 * 1000),
            },
          });

          const eligible = await tx.importOrderCandidate.findMany({
            where: {
              householdId,
              importedByEmail,
              priceSource: null,
              detectedPrice: null,
              createdAt: { lte: now },
            },
            select: { id: true },
          });
          if (eligible.length > 0) {
            await tx.priceReparseTarget.createMany({
              data: eligible.map((c) => ({ runId: run.id, candidateId: c.id })),
            });
          }

          return { id: run.id, runToken: run.runToken, cutoffAt: run.cutoffAt, expiresAt: run.expiresAt };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (e) {
      if (isSerializationFailure(e) && attempt < CREATE_RUN_MAX_ATTEMPTS) continue;
      throw e;
    }
  }
  throw new Error('unreachable: createReparseRun exhausted retries without returning or throwing');
}

async function assertNoOtherActiveRun(
  tx: Prisma.TransactionClient,
  householdId: string,
  excludeRunId: string,
  now: Date
): Promise<void> {
  const otherActiveRun = await tx.priceReparseRun.findFirst({
    where: { householdId, id: { not: excludeRunId }, revokedAt: null, expiresAt: { gt: now } },
  });
  if (otherActiveRun) {
    throw new Error(
      `another active price reparse run already exists for this household (id=${otherActiveRun.id}). resolve it first.`
    );
  }
}

// 期限切れ（revokedAtは未設定のまま単にexpiresAtが過去）になったrunだけを、同じ
// manifest・監査履歴・runTokenのまま再開できるようにする（第6回レビューR6-02対応）。
// **失効済み（revokedAtが設定済み）のrunはこの関数では絶対に扱わない
// （第7回レビューR7-01対応）。** token漏えい・誤配布・緊急停止時の無効化を、
// 期限延長操作自体で覆せてしまうことを防ぐ。失効済みrunを再開したい場合は
// rotateReparseRunTokenを使う
export async function extendReparseRun(
  runToken: string,
  additionalHours = 72
): Promise<{ id: string; expiresAt: Date }> {
  for (let attempt = 1; attempt <= CREATE_RUN_MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const run = await tx.priceReparseRun.findUnique({ where: { runToken } });
          if (!run) {
            throw new ReparseRunInvalidError('run token not found');
          }
          if (run.revokedAt) {
            throw new Error(
              `run ${run.id} has been revoked and cannot be extended with the same token. use rotateReparseRunToken to reissue a new token for a revoked run.`
            );
          }
          const now = new Date();
          await assertNoOtherActiveRun(tx, run.householdId, run.id, now);
          const updated = await tx.priceReparseRun.update({
            where: { id: run.id },
            data: { expiresAt: new Date(now.getTime() + additionalHours * 60 * 60 * 1000) },
          });
          return { id: updated.id, expiresAt: updated.expiresAt };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (e) {
      if (isSerializationFailure(e) && attempt < CREATE_RUN_MAX_ATTEMPTS) continue;
      throw e;
    }
  }
  throw new Error('unreachable: extendReparseRun exhausted retries without returning or throwing');
}

// 失効済み（revokedAt設定済み）のrunを、同じrun ID・manifest・監査履歴を維持したまま
// 新しいrunTokenで再開する（第7回レビューR7-01対応。extendReparseRunとは明確に分離し、
// 失効理由を問わず「同じtokenを復活させる」ことは一切行わない）。runTokenをUPDATEで
// 新しい値へ書き換えるため、旧tokenはDB上に存在しなくなり、以後
// ReparseRunInvalidErrorで永久に拒否される。失効済みでないrunに対して呼ばれた場合は
// エラーとする（期限切れだけのrunはextendReparseRunを使う）
export async function rotateReparseRunToken(
  oldRunToken: string,
  expiresInHours = 72
): Promise<{ id: string; runToken: string; expiresAt: Date }> {
  for (let attempt = 1; attempt <= CREATE_RUN_MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const run = await tx.priceReparseRun.findUnique({ where: { runToken: oldRunToken } });
          if (!run) {
            throw new ReparseRunInvalidError('run token not found');
          }
          if (!run.revokedAt) {
            throw new Error(
              `run ${run.id} is not revoked. use extendReparseRun to extend an expired-but-not-revoked run instead of rotating its token.`
            );
          }
          const now = new Date();
          await assertNoOtherActiveRun(tx, run.householdId, run.id, now);
          const newRunToken = `rrun_${randomBytes(32).toString('hex')}`;
          const updated = await tx.priceReparseRun.update({
            where: { id: run.id },
            data: {
              runToken: newRunToken,
              revokedAt: null,
              expiresAt: new Date(now.getTime() + expiresInHours * 60 * 60 * 1000),
            },
          });
          return { id: updated.id, runToken: updated.runToken, expiresAt: updated.expiresAt };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (e) {
      if (isSerializationFailure(e) && attempt < CREATE_RUN_MAX_ATTEMPTS) continue;
      throw e;
    }
  }
  throw new Error('unreachable: rotateReparseRunToken exhausted retries without returning or throwing');
}
