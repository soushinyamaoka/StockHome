// 過去候補の単価再解析（notice 20260907-STOCKHOME-006 B06対応）。
// ローカルDocker Postgres（DATABASE_URL、apps/api/.env）に対して実行する。
// 各テストは独立した household/item を作成し、終了時に作成データを削除する。
//
// 実行方法: npm test --workspace=@stockhome/api
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReparseResultItem } from '@stockhome/shared';
import { prisma } from '../lib/prisma';
import { getReparseTargets, processReparseResults } from './priceReparse';

let scopeCounter = 0;

interface TestScope {
  tag: string;
  householdId: string;
  itemId: string;
  cleanup: () => Promise<void>;
}

async function createTestScope(defaultPurchaseQty = 1): Promise<TestScope> {
  scopeCounter += 1;
  const tag = `price-reparse-${Date.now()}-${scopeCounter}`;
  const household = await prisma.household.create({ data: { name: `test-household-${tag}` } });
  const item = await prisma.item.create({
    data: {
      householdId: household.id,
      itemName: `test-item-${tag}`,
      daysPerUnit: 10,
      defaultPurchaseQty,
    },
  });
  return {
    tag,
    householdId: household.id,
    itemId: item.id,
    cleanup: async () => {
      await prisma.priceReparseAudit.deleteMany({ where: { runId: { startsWith: tag } } });
      await prisma.household.delete({ where: { id: household.id } });
    },
  };
}

async function createCandidate(
  scope: TestScope,
  options: {
    id?: string;
    importedByEmail?: string;
    detectedPrice?: number | null;
    priceSource?: string | null;
    candidateStatus?: string;
    matchedItemId?: string | null;
    itemNameRaw?: string | null;
  } = {}
) {
  return prisma.importOrderCandidate.create({
    data: {
      ...(options.id ? { id: options.id } : {}),
      householdId: scope.householdId,
      vendor: 'amazon',
      mailMessageId: `message-${scope.tag}-${Math.random()}`,
      importedByEmail: options.importedByEmail ?? 'owner@example.invalid',
      mailDate: new Date('2026-09-01T00:00:00.000Z'),
      mailType: 'order_confirm',
      mailPhase: 'ordered',
      itemNameRaw: options.itemNameRaw ?? `item-${scope.tag}`,
      detectedPrice: options.detectedPrice ?? null,
      priceSource: options.priceSource ?? null,
      candidateStatus: options.candidateStatus ?? 'detected',
      matchedItemId: options.matchedItemId ?? null,
    },
  });
}

async function createPurchase(scope: TestScope, candidateId: string, qty: number) {
  return prisma.purchaseLog.create({
    data: {
      householdId: scope.householdId,
      itemId: scope.itemId,
      purchasedAt: new Date('2026-09-01T00:00:00.000Z'),
      qty,
      price: null,
      source: 'gmail',
      sourceType: 'gmail_auto',
      importCandidateId: candidateId,
    },
  });
}

async function getOnlyAudit(runId: string) {
  const rows = await prisma.priceReparseAudit.findMany({ where: { runId } });
  assert.equal(rows.length, 1);
  return rows[0];
}

test('候補のみ更新: detectedPriceとpriceSourceを更新してupdatedを記録する', async () => {
  const scope = await createTestScope();
  const runId = `${scope.tag}-candidate-only`;
  try {
    const candidate = await createCandidate(scope);
    const counts = await processReparseResults(runId, 'write', [
      { candidateId: candidate.id, detectedPrice: 500, priceSource: '本体価格' },
    ]);

    assert.equal(counts.updatedCandidate, 1);
    assert.equal(counts.updatedPurchase, 0);
    const reloaded = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    assert.equal(reloaded.detectedPrice, 500);
    assert.equal(reloaded.priceSource, '本体価格');
    assert.equal((await getOnlyAudit(runId)).outcome, 'updated');
  } finally {
    await scope.cleanup();
  }
});

test('購入に反映（sets=1）: NULLのpurchase priceへ確定値を設定する', async () => {
  const scope = await createTestScope();
  const runId = `${scope.tag}-sets-one`;
  try {
    const candidate = await createCandidate(scope, { candidateStatus: 'confirmed', matchedItemId: scope.itemId });
    const purchase = await createPurchase(scope, candidate.id, 1);
    const counts = await processReparseResults(runId, 'write', [
      { candidateId: candidate.id, detectedPrice: 640, priceSource: '商品ブロック(JPY表記)' },
    ]);

    assert.equal(counts.updatedCandidate, 1);
    assert.equal(counts.updatedPurchase, 1);
    assert.equal((await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } })).price, 640);
    assert.equal((await getOnlyAudit(runId)).outcome, 'updated');
  } finally {
    await scope.cleanup();
  }
});

test('購入に反映（sets=2・本体価格）: 層1判定の単価を設定する', async () => {
  const scope = await createTestScope();
  const runId = `${scope.tag}-sets-two-label`;
  try {
    const candidate = await createCandidate(scope, { candidateStatus: 'auto_confirmed', matchedItemId: scope.itemId });
    const purchase = await createPurchase(scope, candidate.id, 2);
    const counts = await processReparseResults(runId, 'write', [
      { candidateId: candidate.id, detectedPrice: 800, priceSource: '本体価格' },
    ]);

    assert.equal(counts.updatedPurchase, 1);
    assert.equal((await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } })).price, 800);
  } finally {
    await scope.cleanup();
  }
});

test('購入は未反映（sets=2・ラベル無し・履歴無し）: candidateだけ更新して保留する', async () => {
  const scope = await createTestScope();
  const runId = `${scope.tag}-sets-two-unresolved`;
  try {
    const candidate = await createCandidate(scope, { candidateStatus: 'confirmed', matchedItemId: scope.itemId });
    const purchase = await createPurchase(scope, candidate.id, 2);
    const counts = await processReparseResults(runId, 'write', [
      { candidateId: candidate.id, detectedPrice: 900 },
    ]);

    assert.equal(counts.updatedCandidate, 1);
    assert.equal(counts.updatedPurchase, 0);
    assert.equal(counts.bySkipReason.purchase_price_unresolved, 1);
    assert.equal((await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } })).price, null);
    const audit = await getOnlyAudit(runId);
    assert.equal(audit.outcome, 'updated');
    assert.equal(audit.skipReason, 'purchase_price_unresolved');
  } finally {
    await scope.cleanup();
  }
});

test('既にpriceSourceがある候補: conflictとして既存値を保持する', async () => {
  const scope = await createTestScope();
  const runId = `${scope.tag}-existing-source`;
  try {
    const candidate = await createCandidate(scope, { detectedPrice: 300, priceSource: '既存' });
    const counts = await processReparseResults(runId, 'write', [
      { candidateId: candidate.id, detectedPrice: 700, priceSource: '本体価格' },
    ]);

    assert.equal(counts.conflict, 1);
    assert.equal(counts.bySkipReason.already_has_price_source, 1);
    const reloaded = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    assert.equal(reloaded.detectedPrice, 300);
    assert.equal(reloaded.priceSource, '既存');
  } finally {
    await scope.cleanup();
  }
});

test('同時実行: 同一candidateIdは片方だけupdated、もう片方はconflictになる', async () => {
  const scope = await createTestScope();
  try {
    const candidate = await createCandidate(scope);
    const item = { candidateId: candidate.id, detectedPrice: 500, priceSource: '本体価格' };
    const [a, b] = await Promise.all([
      processReparseResults(`${scope.tag}-concurrent-a`, 'write', [item]),
      processReparseResults(`${scope.tag}-concurrent-b`, 'write', [item]),
    ]);

    assert.equal(a.updatedCandidate + b.updatedCandidate, 1);
    assert.equal(a.conflict + b.conflict, 1);
    const audits = await prisma.priceReparseAudit.findMany({ where: { runId: { startsWith: `${scope.tag}-concurrent-` } } });
    assert.deepEqual(audits.map((row) => row.outcome).sort(), ['conflict', 'updated']);
  } finally {
    await scope.cleanup();
  }
});

test('異常値: 0・負数・非整数・上限超過を拒否してDBを変更しない', async () => {
  const scope = await createTestScope();
  const runId = `${scope.tag}-invalid-prices`;
  try {
    const candidates = await Promise.all([createCandidate(scope), createCandidate(scope), createCandidate(scope), createCandidate(scope)]);
    const invalidPrices = [0, -1, 1.5, 1_000_001];
    const results = candidates.map((candidate, index) => ({
      candidateId: candidate.id,
      detectedPrice: invalidPrices[index],
      priceSource: '本体価格',
    })) as ReparseResultItem[];
    const counts = await processReparseResults(runId, 'write', results);

    assert.equal(counts.failed, 4);
    assert.equal(counts.bySkipReason.invalid_price_rejected, 4);
    const reloaded = await prisma.importOrderCandidate.findMany({ where: { id: { in: candidates.map((c) => c.id) } } });
    assert.ok(reloaded.every((candidate) => candidate.detectedPrice == null && candidate.priceSource == null));
    const audits = await prisma.priceReparseAudit.findMany({ where: { runId } });
    assert.equal(audits.length, 4);
    assert.ok(audits.every((audit) => audit.outcome === 'failed' && audit.skipReason === 'invalid_price_rejected'));
  } finally {
    await scope.cleanup();
  }
});

test('skipReasonあり: candidateを変更せずskippedを記録する', async () => {
  const scope = await createTestScope();
  const runId = `${scope.tag}-skip`;
  try {
    const candidate = await createCandidate(scope);
    const counts = await processReparseResults(runId, 'write', [
      { candidateId: candidate.id, skipReason: 'message_not_found' },
    ]);

    assert.equal(counts.skipped, 1);
    assert.equal(counts.bySkipReason.message_not_found, 1);
    const reloaded = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    assert.equal(reloaded.detectedPrice, null);
    assert.equal(reloaded.priceSource, null);
    assert.equal((await getOnlyAudit(runId)).outcome, 'skipped');
  } finally {
    await scope.cleanup();
  }
});

test('dry_run: writeと同じ判定後にcandidate/purchaseをrollbackし監査だけ記録する', async () => {
  const scope = await createTestScope();
  const runId = `${scope.tag}-dry-run`;
  try {
    const candidate = await createCandidate(scope, { candidateStatus: 'confirmed', matchedItemId: scope.itemId });
    const purchase = await createPurchase(scope, candidate.id, 1);
    const counts = await processReparseResults(runId, 'dry_run', [
      { candidateId: candidate.id, detectedPrice: 750, priceSource: '本体価格' },
    ]);

    assert.equal(counts.updatedCandidate, 1);
    assert.equal(counts.updatedPurchase, 1);
    const reloadedCandidate = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    const reloadedPurchase = await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } });
    assert.equal(reloadedCandidate.detectedPrice, null);
    assert.equal(reloadedCandidate.priceSource, null);
    assert.equal(reloadedPurchase.price, null);
    const audit = await getOnlyAudit(runId);
    assert.equal(audit.outcome, 'dry_run_updated');
    assert.equal(audit.appliedDetectedPrice, 750);
    assert.equal(audit.appliedPurchasePrice, 750);
  } finally {
    await scope.cleanup();
  }
});

test('再実行（冪等性）: 2回目は全件conflictでpurchase priceを上書きしない', async () => {
  const scope = await createTestScope();
  try {
    const candidateA = await createCandidate(scope, { candidateStatus: 'confirmed', matchedItemId: scope.itemId });
    const candidateB = await createCandidate(scope);
    const purchase = await createPurchase(scope, candidateA.id, 1);
    const results = [
      { candidateId: candidateA.id, detectedPrice: 420, priceSource: '本体価格' },
      { candidateId: candidateB.id, detectedPrice: 520, priceSource: '本体価格' },
    ];

    const first = await processReparseResults(`${scope.tag}-idempotent-first`, 'write', results);
    const second = await processReparseResults(`${scope.tag}-idempotent-second`, 'write', results);
    assert.equal(first.updatedCandidate, 2);
    assert.equal(first.updatedPurchase, 1);
    assert.equal(second.conflict, 2);
    assert.equal(second.updatedCandidate, 0);
    assert.equal((await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } })).price, 420);
  } finally {
    await scope.cleanup();
  }
});

test('getReparseTargets: email・NULL条件で絞り込みcursorページネーションする', async () => {
  const scope = await createTestScope();
  const email = 'target@example.invalid';
  try {
    await createCandidate(scope, { id: `${scope.tag}-001`, importedByEmail: email, itemNameRaw: 'target-1' });
    await createCandidate(scope, { id: `${scope.tag}-002`, importedByEmail: email, itemNameRaw: 'target-2' });
    await createCandidate(scope, { id: `${scope.tag}-003`, importedByEmail: email, itemNameRaw: 'target-3' });
    await createCandidate(scope, { id: `${scope.tag}-004`, importedByEmail: 'other@example.invalid' });
    await createCandidate(scope, { id: `${scope.tag}-005`, importedByEmail: email, priceSource: '既存' });
    await createCandidate(scope, { id: `${scope.tag}-006`, importedByEmail: email, detectedPrice: 100 });

    const firstPage = await getReparseTargets(email, undefined, 2);
    assert.deepEqual(firstPage.map((candidate) => candidate.id), [`${scope.tag}-001`, `${scope.tag}-002`]);
    const secondPage = await getReparseTargets(email, firstPage[1].id, 2);
    assert.deepEqual(secondPage.map((candidate) => candidate.id), [`${scope.tag}-003`]);
    assert.deepEqual(Object.keys(firstPage[0]).sort(), ['id', 'itemNameRaw', 'mailMessageId', 'mailPhase', 'vendor'].sort());
  } finally {
    await scope.cleanup();
  }
});
