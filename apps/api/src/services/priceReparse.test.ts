import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import type { ReparseResultItem } from '@stockhome/shared';
import { reparseCandidatesPayloadSchema, reparseResultItemSchema } from '@stockhome/shared';
import { prisma } from '../lib/prisma';
import { CERTAIN_UNIT_PRICE_SOURCES } from './candidateIntake';
import {
  createReparseRun,
  getReparseRunProgress,
  getReparseTargets,
  processReparseResults,
  ReparseRunInvalidError,
} from './priceReparse';

let scopeCounter = 0;
const OWNER_EMAIL = 'owner@example.invalid';
const CERTAIN_PRICE_SOURCE = [...CERTAIN_UNIT_PRICE_SOURCES][0];

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
      const runs = await prisma.priceReparseRun.findMany({
        where: { householdId: household.id },
        select: { id: true },
      });
      const runIds = runs.map((run) => run.id);
      if (runIds.length > 0) {
        await prisma.priceReparseTarget.deleteMany({ where: { runId: { in: runIds } } });
        await prisma.priceReparseAudit.deleteMany({ where: { runId: { in: runIds } } });
        await prisma.priceReparseItemSnapshot.deleteMany({ where: { runId: { in: runIds } } });
      }
      await prisma.priceReparseRun.deleteMany({ where: { householdId: household.id } });
      await prisma.household.delete({ where: { id: household.id } });
    },
  };
}

async function createRun(
  scope: TestScope,
  options: { importedByEmail?: string; cutoffAt?: Date; expiresAt?: Date; revokedAt?: Date | null } = {}
) {
  return prisma.priceReparseRun.create({
    data: {
      runToken: `rrun_test_${scope.tag}_${Math.random().toString(16).slice(2)}`,
      householdId: scope.householdId,
      importedByEmail: options.importedByEmail ?? OWNER_EMAIL,
      cutoffAt: options.cutoffAt ?? new Date(Date.now() + 60 * 60 * 1000),
      expiresAt: options.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
      revokedAt: options.revokedAt ?? null,
    },
  });
}

async function createCandidate(
  scope: TestScope,
  options: {
    id?: string;
    legacyId?: string | null;
    importedByEmail?: string;
    detectedQty?: number | null;
    detectedPrice?: number | null;
    priceSource?: string | null;
    candidateStatus?: string;
    matchedItemId?: string | null;
    itemNameRaw?: string | null;
    createdAt?: Date;
  } = {}
) {
  return prisma.importOrderCandidate.create({
    data: {
      ...(options.id ? { id: options.id } : {}),
      legacyId: options.legacyId ?? null,
      householdId: scope.householdId,
      vendor: 'amazon',
      mailMessageId: `message-${scope.tag}-${Math.random()}`,
      importedByEmail: options.importedByEmail ?? OWNER_EMAIL,
      mailDate: new Date('2026-09-01T00:00:00.000Z'),
      mailType: 'order_confirm',
      mailPhase: 'ordered',
      itemNameRaw: options.itemNameRaw ?? `item-${scope.tag}`,
      detectedQty: options.detectedQty ?? null,
      detectedPrice: options.detectedPrice ?? null,
      priceSource: options.priceSource ?? null,
      candidateStatus: options.candidateStatus ?? 'detected',
      matchedItemId: options.matchedItemId ?? null,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    },
  });
}

async function createPurchase(
  scope: TestScope,
  candidateId: string | null,
  qty: number,
  price: number | null = null
) {
  return prisma.purchaseLog.create({
    data: {
      householdId: scope.householdId,
      itemId: scope.itemId,
      purchasedAt: new Date('2026-09-01T00:00:00.000Z'),
      qty,
      price,
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

async function withTransactionDelegateMock<T>(
  patch: (tx: Prisma.TransactionClient) => () => void,
  fn: () => Promise<T>
): Promise<T> {
  type TransactionCallback = (tx: Prisma.TransactionClient) => Promise<unknown>;
  type TransactionMethod = (callback: TransactionCallback) => Promise<unknown>;
  const client = prisma as unknown as { $transaction: TransactionMethod };
  const originalTransaction = prisma.$transaction.bind(prisma) as TransactionMethod;
  client.$transaction = async (callback) =>
    originalTransaction(async (tx) => {
      const restore = patch(tx);
      try {
        return await callback(tx);
      } finally {
        restore();
      }
    });
  try {
    return await fn();
  } finally {
    client.$transaction = originalTransaction;
  }
}

test('candidate-only update records detectedPrice and priceSource', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope);
    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, detectedPrice: 500, priceSource: CERTAIN_PRICE_SOURCE },
    ]);

    assert.equal(counts.updatedCandidate, 1);
    assert.equal(counts.updatedPurchase, 0);
    const reloaded = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    assert.equal(reloaded.detectedPrice, 500);
    assert.equal(reloaded.priceSource, CERTAIN_PRICE_SOURCE);
    assert.equal((await getOnlyAudit(run.id)).outcome, 'updated');
  } finally {
    await scope.cleanup();
  }
});

test('sets=1 updates a purchase with a reliable price', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope, {
      candidateStatus: 'confirmed',
      matchedItemId: scope.itemId,
      detectedQty: 1,
    });
    const purchase = await createPurchase(scope, candidate.id, 1);
    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, detectedPrice: 640 },
    ]);

    assert.equal(counts.updatedCandidate, 1);
    assert.equal(counts.updatedPurchase, 1);
    assert.equal((await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } })).price, 640);
  } finally {
    await scope.cleanup();
  }
});

test('sets=2 with a certain unit-price label updates the purchase', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope, {
      candidateStatus: 'auto_confirmed',
      matchedItemId: scope.itemId,
      detectedQty: 2,
    });
    const purchase = await createPurchase(scope, candidate.id, 2);
    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, detectedPrice: 800, priceSource: CERTAIN_PRICE_SOURCE },
    ]);

    assert.equal(counts.updatedPurchase, 1);
    assert.equal((await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } })).price, 800);
  } finally {
    await scope.cleanup();
  }
});

test('unreliable sets=2 price updates only the candidate', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope, {
      candidateStatus: 'confirmed',
      matchedItemId: scope.itemId,
      detectedQty: 2,
    });
    const purchase = await createPurchase(scope, candidate.id, 2);
    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, detectedPrice: 900 },
    ]);

    assert.equal(counts.updatedCandidate, 1);
    assert.equal(counts.updatedPurchase, 0);
    assert.equal(counts.bySkipReason.purchase_price_unresolved, 1);
    assert.equal((await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } })).price, null);
  } finally {
    await scope.cleanup();
  }
});

test('an existing priceSource causes a conflict and is preserved', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope, { detectedPrice: 300, priceSource: 'existing' });
    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, detectedPrice: 700, priceSource: CERTAIN_PRICE_SOURCE },
    ]);

    assert.equal(counts.conflict, 1);
    assert.equal(counts.bySkipReason.already_has_price, 1);
    const reloaded = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    assert.equal(reloaded.detectedPrice, 300);
    assert.equal(reloaded.priceSource, 'existing');
  } finally {
    await scope.cleanup();
  }
});

test('concurrent write retries return the same saved outcome', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope);
    const item = { candidateId: candidate.id, detectedPrice: 500, priceSource: CERTAIN_PRICE_SOURCE };
    const [a, b] = await Promise.all([
      processReparseResults(run.runToken, 'write', [item]),
      processReparseResults(run.runToken, 'write', [item]),
    ]);

    assert.equal(a.updatedCandidate + b.updatedCandidate, 2);
    assert.equal(a.conflict + b.conflict, 0);
    assert.equal((await prisma.priceReparseAudit.findMany({ where: { runId: run.id } })).length, 1);
  } finally {
    await scope.cleanup();
  }
});

test('invalid prices are rejected without changing candidates', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidates = await Promise.all([
      createCandidate(scope),
      createCandidate(scope),
      createCandidate(scope),
      createCandidate(scope),
    ]);
    const invalidPrices = [0, -1, 1.5, 1_000_001];
    const results = candidates.map((candidate, index) => ({
      candidateId: candidate.id,
      detectedPrice: invalidPrices[index],
      priceSource: CERTAIN_PRICE_SOURCE,
    })) as ReparseResultItem[];
    const counts = await processReparseResults(run.runToken, 'write', results);

    assert.equal(counts.failed, 4);
    assert.equal(counts.bySkipReason.invalid_price_rejected, 4);
    assert.equal((await prisma.priceReparseAudit.findMany({ where: { runId: run.id } })).length, 4);
    const reloaded = await prisma.importOrderCandidate.findMany({
      where: { id: { in: candidates.map((candidate) => candidate.id) } },
    });
    assert.ok(reloaded.every((candidate) => candidate.detectedPrice == null && candidate.priceSource == null));
  } finally {
    await scope.cleanup();
  }
});

test('a supported skipReason skips without changing the candidate', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope);
    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, skipReason: 'message_not_found' },
    ]);

    assert.equal(counts.skipped, 1);
    assert.equal(counts.bySkipReason.message_not_found, 1);
    assert.equal((await getOnlyAudit(run.id)).outcome, 'skipped');
    const reloaded = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    assert.equal(reloaded.detectedPrice, null);
    assert.equal(reloaded.priceSource, null);
  } finally {
    await scope.cleanup();
  }
});

test('dry_run rolls back candidate and purchase but records its audit', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope, {
      candidateStatus: 'confirmed',
      matchedItemId: scope.itemId,
      detectedQty: 1,
    });
    const purchase = await createPurchase(scope, candidate.id, 1);
    const counts = await processReparseResults(run.runToken, 'dry_run', [
      { candidateId: candidate.id, detectedPrice: 750 },
    ]);

    assert.equal(counts.updatedCandidate, 1);
    assert.equal(counts.updatedPurchase, 1);
    assert.equal((await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).detectedPrice, null);
    assert.equal((await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } })).price, null);
    const audit = await getOnlyAudit(run.id);
    assert.equal(audit.outcome, 'dry_run_updated');
    assert.equal(audit.appliedDetectedPrice, 750);
    assert.equal(audit.appliedPurchasePrice, 750);
  } finally {
    await scope.cleanup();
  }
});

test('repeated writes are idempotent', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidateA = await createCandidate(scope, {
      candidateStatus: 'confirmed',
      matchedItemId: scope.itemId,
      detectedQty: 1,
    });
    const candidateB = await createCandidate(scope);
    const purchase = await createPurchase(scope, candidateA.id, 1);
    const results = [
      { candidateId: candidateA.id, detectedPrice: 420, priceSource: CERTAIN_PRICE_SOURCE },
      { candidateId: candidateB.id, detectedPrice: 520, priceSource: CERTAIN_PRICE_SOURCE },
    ];

    const first = await processReparseResults(run.runToken, 'write', results);
    const firstAudits = await prisma.priceReparseAudit.findMany({
      where: { runId: run.id, mode: 'write' },
      orderBy: { candidateId: 'asc' },
    });
    const second = await processReparseResults(run.runToken, 'write', results);
    const secondAudits = await prisma.priceReparseAudit.findMany({
      where: { runId: run.id, mode: 'write' },
      orderBy: { candidateId: 'asc' },
    });
    assert.equal(first.updatedCandidate, 2);
    assert.equal(first.updatedPurchase, 1);
    assert.equal(second.updatedCandidate, 2);
    assert.equal(second.updatedPurchase, 1);
    assert.equal(second.conflict, 0);
    assert.deepEqual(secondAudits, firstAudits);
    assert.equal((await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } })).price, 420);
  } finally {
    await scope.cleanup();
  }
});

test('getReparseTargets filters by run owner and paginates eligible candidates', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    await createCandidate(scope, { id: `${scope.tag}-001`, itemNameRaw: 'target-1' });
    await createCandidate(scope, { id: `${scope.tag}-002`, itemNameRaw: 'target-2' });
    await createCandidate(scope, { id: `${scope.tag}-003`, itemNameRaw: 'target-3' });
    await createCandidate(scope, { id: `${scope.tag}-004`, importedByEmail: 'other@example.invalid' });
    await createCandidate(scope, { id: `${scope.tag}-005`, priceSource: 'existing' });
    await createCandidate(scope, { id: `${scope.tag}-006`, detectedPrice: 100 });

    const firstPage = await getReparseTargets(run.runToken, undefined, 2);
    assert.deepEqual(firstPage.map((candidate) => candidate.id), [`${scope.tag}-001`, `${scope.tag}-002`]);
    const secondPage = await getReparseTargets(run.runToken, firstPage[1].id, 2);
    assert.deepEqual(secondPage.map((candidate) => candidate.id), [`${scope.tag}-003`]);
    assert.deepEqual(Object.keys(firstPage[0]).sort(), ['id', 'itemNameRaw', 'mailMessageId', 'mailPhase', 'vendor'].sort());
  } finally {
    await scope.cleanup();
  }
});

test('missing, expired, and revoked run tokens are rejected by both entry points', async () => {
  const scope = await createTestScope();
  try {
    const expired = await createRun(scope, { expiresAt: new Date(Date.now() - 1000) });
    const revoked = await createRun(scope, { revokedAt: new Date() });
    const tokens = [`rrun_missing_${scope.tag}`, expired.runToken, revoked.runToken];

    for (const token of tokens) {
      await assert.rejects(() => getReparseTargets(token, undefined, 20), ReparseRunInvalidError);
      await assert.rejects(() => processReparseResults(token, 'write', []), ReparseRunInvalidError);
    }
  } finally {
    await scope.cleanup();
  }
});

test('a candidate owned by another email is rejected without updates', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope, { importedByEmail: 'other@example.invalid' });
    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, detectedPrice: 500, priceSource: CERTAIN_PRICE_SOURCE },
    ]);

    assert.equal(counts.conflict, 1);
    assert.equal(counts.bySkipReason.candidate_owner_mismatch, 1);
    assert.equal((await getOnlyAudit(run.id)).skipReason, 'candidate_owner_mismatch');
    const reloaded = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    assert.equal(reloaded.detectedPrice, null);
    assert.equal(reloaded.priceSource, null);
  } finally {
    await scope.cleanup();
  }
});

test('a candidate in another household with the same owner email is rejected without updates', async () => {
  const runScope = await createTestScope();
  const candidateScope = await createTestScope();
  try {
    const run = await createRun(runScope);
    const candidate = await createCandidate(candidateScope, { importedByEmail: OWNER_EMAIL });
    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, detectedPrice: 505, priceSource: CERTAIN_PRICE_SOURCE },
    ]);

    assert.equal(counts.conflict, 1);
    assert.equal(counts.bySkipReason.candidate_owner_mismatch, 1);
    const reloaded = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    assert.equal(reloaded.detectedPrice, null);
    assert.equal(reloaded.priceSource, null);
    assert.equal((await getOnlyAudit(run.id)).skipReason, 'candidate_owner_mismatch');
  } finally {
    await runScope.cleanup();
    await candidateScope.cleanup();
  }
});

test('a missing candidate records a write audit', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidateId = `missing-${scope.tag}`;
    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId, detectedPrice: 510 },
    ]);

    assert.equal(counts.conflict, 1);
    assert.equal(counts.bySkipReason.candidate_not_found, 1);
    const audit = await getOnlyAudit(run.id);
    assert.equal(audit.candidateId, candidateId);
    assert.equal(audit.outcome, 'conflict');
    assert.equal(audit.skipReason, 'candidate_not_found');
  } finally {
    await scope.cleanup();
  }
});

test('an existing detectedPrice without priceSource cannot be overwritten', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope, { detectedPrice: 300, priceSource: null });
    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, detectedPrice: 700 },
    ]);

    assert.equal(counts.conflict, 1);
    assert.equal(counts.bySkipReason.already_has_price, 1);
    assert.equal((await getOnlyAudit(run.id)).skipReason, 'already_has_price');
    const reloaded = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    assert.equal(reloaded.detectedPrice, 300);
    assert.equal(reloaded.priceSource, null);
  } finally {
    await scope.cleanup();
  }
});

test('a price-only write retry returns the first saved outcome without replacing it', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope);
    const first = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, detectedPrice: 500 },
    ]);
    const second = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, detectedPrice: 700 },
    ]);

    assert.equal(first.updatedCandidate, 1);
    assert.equal(second.updatedCandidate, 1);
    assert.equal(second.conflict, 0);
    const reloaded = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    assert.equal(reloaded.detectedPrice, 500);
    assert.equal(reloaded.priceSource, null);
  } finally {
    await scope.cleanup();
  }
});

test('a purchase linked through candidate legacyId is updated', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const legacyId = `legacy-${scope.tag}`;
    const candidate = await createCandidate(scope, {
      legacyId,
      candidateStatus: 'confirmed',
      matchedItemId: scope.itemId,
      detectedQty: 1,
    });
    const purchase = await createPurchase(scope, legacyId, 1);
    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, detectedPrice: 610 },
    ]);

    assert.equal(counts.updatedPurchase, 1);
    assert.equal((await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } })).price, 610);
  } finally {
    await scope.cleanup();
  }
});

test('multiple unresolved purchases are left unchanged as ambiguous', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope, {
      candidateStatus: 'confirmed',
      matchedItemId: scope.itemId,
      detectedQty: 1,
    });
    const firstPurchase = await createPurchase(scope, candidate.id, 1);
    const secondPurchase = await createPurchase(scope, candidate.id, 1);
    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, detectedPrice: 620 },
    ]);

    assert.equal(counts.updatedCandidate, 1);
    assert.equal(counts.updatedPurchase, 0);
    assert.equal(counts.bySkipReason.ambiguous_purchase_match, 1);
    const purchases = await prisma.purchaseLog.findMany({
      where: { id: { in: [firstPurchase.id, secondPurchase.id] } },
    });
    assert.ok(purchases.every((purchase) => purchase.price == null));
  } finally {
    await scope.cleanup();
  }
});

test('purchases with a different household or item are not updated', async () => {
  const scope = await createTestScope();
  const otherScope = await createTestScope();
  try {
    const run = await createRun(scope);
    const otherItem = await prisma.item.create({
      data: {
        householdId: scope.householdId,
        itemName: `other-item-${scope.tag}`,
        daysPerUnit: 10,
        defaultPurchaseQty: 1,
      },
    });
    const candidate = await createCandidate(scope, {
      candidateStatus: 'confirmed',
      matchedItemId: scope.itemId,
      detectedQty: 1,
    });
    const wrongHouseholdPurchase = await prisma.purchaseLog.create({
      data: {
        householdId: otherScope.householdId,
        itemId: otherScope.itemId,
        purchasedAt: new Date('2026-09-01T00:00:00.000Z'),
        qty: 1,
        price: null,
        source: 'gmail',
        sourceType: 'gmail_auto',
        importCandidateId: candidate.id,
      },
    });
    const wrongItemPurchase = await prisma.purchaseLog.create({
      data: {
        householdId: scope.householdId,
        itemId: otherItem.id,
        purchasedAt: new Date('2026-09-01T00:00:00.000Z'),
        qty: 1,
        price: null,
        source: 'gmail',
        sourceType: 'gmail_auto',
        importCandidateId: candidate.id,
      },
    });

    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, detectedPrice: 615 },
    ]);

    assert.equal(counts.updatedCandidate, 1);
    assert.equal(counts.updatedPurchase, 0);
    const purchases = await prisma.purchaseLog.findMany({
      where: { id: { in: [wrongHouseholdPurchase.id, wrongItemPurchase.id] } },
    });
    assert.ok(purchases.every((purchase) => purchase.price == null));
  } finally {
    await scope.cleanup();
    await otherScope.cleanup();
  }
});

test('sets are recalculated from candidate.detectedQty after defaultPurchaseQty changes', async () => {
  const scope = await createTestScope(1);
  try {
    const run = await createRun(scope);
    await createPurchase(scope, null, 1, 100);
    const candidate = await createCandidate(scope, {
      candidateStatus: 'confirmed',
      matchedItemId: scope.itemId,
      detectedQty: 2,
    });
    const purchase = await createPurchase(scope, candidate.id, 2);
    await prisma.item.update({ where: { id: scope.itemId }, data: { defaultPurchaseQty: 4 } });

    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, detectedPrice: 200 },
    ]);

    assert.equal(counts.updatedPurchase, 1);
    assert.equal((await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } })).price, 100);
  } finally {
    await scope.cleanup();
  }
});

test('a suspicious detectedQty prevents purchase price propagation', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope, {
      candidateStatus: 'confirmed',
      matchedItemId: scope.itemId,
      detectedQty: 13,
    });
    const purchase = await createPurchase(scope, candidate.id, 13);
    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, detectedPrice: 650, priceSource: CERTAIN_PRICE_SOURCE },
    ]);

    assert.equal(counts.updatedCandidate, 1);
    assert.equal(counts.updatedPurchase, 0);
    assert.equal(counts.bySkipReason.purchase_price_unresolved, 1);
    assert.equal((await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } })).price, null);
  } finally {
    await scope.cleanup();
  }
});

test('dry_run records owner conflicts as dry_run_conflict audits', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope, { importedByEmail: 'other@example.invalid' });
    const counts = await processReparseResults(run.runToken, 'dry_run', [
      { candidateId: candidate.id, detectedPrice: 500 },
    ]);

    assert.equal(counts.conflict, 1);
    assert.equal(counts.bySkipReason.candidate_owner_mismatch, 1);
    const audit = await getOnlyAudit(run.id);
    assert.equal(audit.outcome, 'dry_run_conflict');
    assert.equal(audit.skipReason, 'candidate_owner_mismatch');
  } finally {
    await scope.cleanup();
  }
});

test('repeated dry runs keep one audit row and overwrite it with the latest result', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope);

    const first = await processReparseResults(run.runToken, 'dry_run', [
      { candidateId: candidate.id, detectedPrice: 500 },
    ]);
    const second = await processReparseResults(run.runToken, 'dry_run', [
      { candidateId: candidate.id, detectedPrice: 700 },
    ]);

    assert.equal(first.updatedCandidate, 1);
    assert.equal(second.updatedCandidate, 1);
    const audit = await getOnlyAudit(run.id);
    assert.equal(audit.mode, 'dry_run');
    assert.equal(audit.outcome, 'dry_run_updated');
    assert.equal(audit.appliedDetectedPrice, 700);
    assert.equal((await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).detectedPrice, null);
  } finally {
    await scope.cleanup();
  }
});

test('a run snapshot keeps layer-3 purchase decisions consistent across dry-run and write chunks', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    await createPurchase(scope, null, 1, 100);
    const labeledCandidate = await createCandidate(scope, {
      candidateStatus: 'confirmed',
      matchedItemId: scope.itemId,
      detectedQty: 2,
    });
    const historyCandidate = await createCandidate(scope, {
      candidateStatus: 'confirmed',
      matchedItemId: scope.itemId,
      detectedQty: 2,
    });
    const labeledPurchase = await createPurchase(scope, labeledCandidate.id, 2);
    const historyPurchase = await createPurchase(scope, historyCandidate.id, 2);
    const labeledResult = {
      candidateId: labeledCandidate.id,
      detectedPrice: 200,
      priceSource: CERTAIN_PRICE_SOURCE,
    };
    const historyResult = { candidateId: historyCandidate.id, detectedPrice: 200 };

    const dryRunFirst = await processReparseResults(run.runToken, 'dry_run', [labeledResult]);
    const dryRunSecond = await processReparseResults(run.runToken, 'dry_run', [historyResult]);
    const writeFirst = await processReparseResults(run.runToken, 'write', [labeledResult]);
    const writeSecond = await processReparseResults(run.runToken, 'write', [historyResult]);

    assert.equal(dryRunFirst.updatedPurchase + dryRunSecond.updatedPurchase, 2);
    assert.equal(writeFirst.updatedPurchase + writeSecond.updatedPurchase, 2);
    assert.equal((await prisma.priceReparseItemSnapshot.findMany({ where: { runId: run.id } })).length, 1);
    assert.equal((await prisma.purchaseLog.findUniqueOrThrow({ where: { id: labeledPurchase.id } })).price, 200);
    assert.equal((await prisma.purchaseLog.findUniqueOrThrow({ where: { id: historyPurchase.id } })).price, 100);
  } finally {
    await scope.cleanup();
  }
});

test('candidates created after the run cutoff are excluded and rejected', async () => {
  const scope = await createTestScope();
  try {
    const cutoffAt = new Date(Date.now() - 1000);
    const run = await createRun(scope, { cutoffAt });
    const candidate = await createCandidate(scope, {
      id: `${scope.tag}-after-cutoff`,
      createdAt: new Date(cutoffAt.getTime() + 500),
    });

    const targets = await getReparseTargets(run.runToken, undefined, 20);
    assert.ok(!targets.some((target) => target.id === candidate.id));
    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, detectedPrice: 720 },
    ]);
    assert.equal(counts.conflict, 1);
    assert.equal(counts.bySkipReason.candidate_after_cutoff, 1);
    assert.equal((await getOnlyAudit(run.id)).skipReason, 'candidate_after_cutoff');
  } finally {
    await scope.cleanup();
  }
});

test('a skipReason cannot bypass the run household boundary', async () => {
  const runScope = await createTestScope();
  const candidateScope = await createTestScope();
  try {
    const run = await createRun(runScope);
    const candidate = await createCandidate(candidateScope, { importedByEmail: OWNER_EMAIL });
    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, skipReason: 'message_not_found' },
    ]);

    assert.equal(counts.conflict, 1);
    assert.equal(counts.skipped, 0);
    assert.equal(counts.bySkipReason.candidate_owner_mismatch, 1);
    const audit = await getOnlyAudit(run.id);
    assert.equal(audit.candidateId, candidate.id);
    assert.equal(audit.skipReason, 'candidate_owner_mismatch');
  } finally {
    await runScope.cleanup();
    await candidateScope.cleanup();
  }
});

test('an invalid price cannot bypass the run household boundary', async () => {
  const runScope = await createTestScope();
  const candidateScope = await createTestScope();
  try {
    const run = await createRun(runScope);
    const candidate = await createCandidate(candidateScope, { importedByEmail: OWNER_EMAIL });
    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, detectedPrice: 0, priceSource: CERTAIN_PRICE_SOURCE },
    ]);

    assert.equal(counts.conflict, 1);
    assert.equal(counts.failed, 0);
    assert.equal(counts.bySkipReason.candidate_owner_mismatch, 1);
    const audit = await getOnlyAudit(run.id);
    assert.equal(audit.candidateId, candidate.id);
    assert.equal(audit.skipReason, 'candidate_owner_mismatch');
  } finally {
    await runScope.cleanup();
    await candidateScope.cleanup();
  }
});

test('a matched item in another household is rejected before any write', async () => {
  const scope = await createTestScope();
  const otherScope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope, {
      candidateStatus: 'confirmed',
      matchedItemId: otherScope.itemId,
      detectedQty: 1,
    });
    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: candidate.id, detectedPrice: 735, priceSource: CERTAIN_PRICE_SOURCE },
    ]);

    assert.equal(counts.conflict, 1);
    assert.equal(counts.updatedCandidate, 0);
    assert.equal(counts.bySkipReason.matched_item_missing, 1);
    const audit = await getOnlyAudit(run.id);
    assert.equal(audit.outcome, 'conflict');
    assert.equal(audit.skipReason, 'matched_item_missing');
    assert.equal(audit.purchaseId, null);
    const reloaded = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    assert.equal(reloaded.detectedPrice, null);
    assert.equal(reloaded.priceSource, null);
  } finally {
    await scope.cleanup();
    await otherScope.cleanup();
  }
});

test('a database exception during outcome computation rejects the whole chunk', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope);
    const expected = new Error('simulated candidate lookup failure');

    await withTransactionDelegateMock(
      (tx) => {
        const delegate = tx.importOrderCandidate as unknown as {
          findUnique: (...args: unknown[]) => Promise<unknown>;
        };
        const originalFindUnique = delegate.findUnique;
        delegate.findUnique = async () => {
          throw expected;
        };
        return () => {
          delegate.findUnique = originalFindUnique;
        };
      },
      () =>
        assert.rejects(
          () => processReparseResults(run.runToken, 'write', [{ candidateId: candidate.id, detectedPrice: 740 }]),
          (error) => error === expected
        )
    );

    assert.equal((await prisma.priceReparseAudit.findMany({ where: { runId: run.id } })).length, 0);
  } finally {
    await scope.cleanup();
  }
});

test('a non-P2002 audit insert exception rejects the chunk without an audit row', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope);
    const expected = new Error('simulated audit insert failure');

    await withTransactionDelegateMock(
      (tx) => {
        const delegate = tx.priceReparseAudit as unknown as {
          create: (...args: unknown[]) => Promise<unknown>;
        };
        const originalCreate = delegate.create;
        delegate.create = async () => {
          throw expected;
        };
        return () => {
          delegate.create = originalCreate;
        };
      },
      () =>
        assert.rejects(
          () =>
            processReparseResults(run.runToken, 'write', [
              { candidateId: candidate.id, detectedPrice: 745, priceSource: CERTAIN_PRICE_SOURCE },
            ]),
          (error) => error === expected
        )
    );

    assert.equal((await prisma.priceReparseAudit.findMany({ where: { runId: run.id } })).length, 0);
    const reloaded = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    assert.equal(reloaded.detectedPrice, null);
    assert.equal(reloaded.priceSource, null);
  } finally {
    await scope.cleanup();
  }
});

test('a non-P2002 item snapshot exception rolls back candidate changes and audit creation', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    await createPurchase(scope, null, 1, 100);
    const candidate = await createCandidate(scope, {
      candidateStatus: 'confirmed',
      matchedItemId: scope.itemId,
      detectedQty: 1,
    });
    const purchase = await createPurchase(scope, candidate.id, 1);
    const expected = new Error('simulated item snapshot insert failure');
    const delegate = prisma.priceReparseItemSnapshot as unknown as {
      create: (...args: unknown[]) => Promise<unknown>;
    };
    const originalCreate = delegate.create;
    delegate.create = async () => {
      throw expected;
    };

    try {
      await assert.rejects(
        () =>
          processReparseResults(run.runToken, 'write', [
            { candidateId: candidate.id, detectedPrice: 745, priceSource: CERTAIN_PRICE_SOURCE },
          ]),
        (error) => error === expected
      );
    } finally {
      delegate.create = originalCreate;
    }

    assert.equal((await prisma.priceReparseAudit.findMany({ where: { runId: run.id } })).length, 0);
    const reloaded = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    assert.equal(reloaded.detectedPrice, null);
    assert.equal(reloaded.priceSource, null);
    assert.equal((await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } })).price, null);
  } finally {
    await scope.cleanup();
  }
});

test('getReparseRunProgress reports an empty run as complete', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    assert.deepEqual(await getReparseRunProgress(run.runToken), {
      totalTargets: 0,
      processedCount: 0,
      remainingCount: 0,
      complete: true,
    });
  } finally {
    await scope.cleanup();
  }
});

test('getReparseRunProgress preserves the target total across mixed write outcomes', async () => {
  const scope = await createTestScope();
  try {
    const updated = await createCandidate(scope);
    const skipped = await createCandidate(scope);
    const failed = await createCandidate(scope);
    const run = await createReparseRun(OWNER_EMAIL, scope.householdId);

    assert.deepEqual(await getReparseRunProgress(run.runToken), {
      totalTargets: 3,
      processedCount: 0,
      remainingCount: 3,
      complete: false,
    });

    const counts = await processReparseResults(run.runToken, 'write', [
      { candidateId: updated.id, detectedPrice: 750, priceSource: CERTAIN_PRICE_SOURCE },
      { candidateId: skipped.id, skipReason: 'message_not_found' },
      { candidateId: failed.id, detectedPrice: -1 },
    ]);
    assert.equal(counts.updatedCandidate, 1);
    assert.equal(counts.skipped, 1);
    assert.equal(counts.failed, 1);
    assert.deepEqual(await getReparseRunProgress(run.runToken), {
      totalTargets: 3,
      processedCount: 3,
      remainingCount: 0,
      complete: true,
    });
    const reloaded = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: updated.id } });
    assert.equal(reloaded.detectedPrice, 750);
    assert.equal(reloaded.priceSource, CERTAIN_PRICE_SOURCE);
  } finally {
    await scope.cleanup();
  }
});

test('createReparseRun freezes the target manifest before later candidates are created', async () => {
  const scope = await createTestScope();
  try {
    const eligible = await createCandidate(scope);
    const before = Date.now();
    const run = await createReparseRun(OWNER_EMAIL, scope.householdId, 1);
    const createdAfterRun = await createCandidate(scope);

    const targets = await prisma.priceReparseTarget.findMany({
      where: { runId: run.id },
      orderBy: { candidateId: 'asc' },
    });
    assert.deepEqual(targets.map((target) => target.candidateId), [eligible.id]);
    assert.ok(!targets.some((target) => target.candidateId === createdAfterRun.id));
    assert.match(run.runToken, /^rrun_[0-9a-f]{64}$/);
    assert.ok(run.expiresAt.getTime() > before);
  } finally {
    await scope.cleanup();
  }
});

test('getReparseRunProgress keeps an externally priced target unprocessed in the fixed manifest', async () => {
  const scope = await createTestScope();
  try {
    const candidate = await createCandidate(scope);
    const run = await createReparseRun(OWNER_EMAIL, scope.householdId);

    await prisma.importOrderCandidate.update({
      where: { id: candidate.id },
      data: { detectedPrice: 760, priceSource: CERTAIN_PRICE_SOURCE },
    });

    assert.deepEqual(await getReparseRunProgress(run.runToken), {
      totalTargets: 1,
      processedCount: 0,
      remainingCount: 1,
      complete: false,
    });
  } finally {
    await scope.cleanup();
  }
});

test('getReparseRunProgress remains available after the run expires', async () => {
  const scope = await createTestScope();
  try {
    const candidate = await createCandidate(scope);
    const run = await createRun(scope, { expiresAt: new Date(Date.now() - 1000) });
    await prisma.priceReparseTarget.create({
      data: { runId: run.id, candidateId: candidate.id },
    });

    assert.deepEqual(await getReparseRunProgress(run.runToken), {
      totalTargets: 1,
      processedCount: 0,
      remainingCount: 1,
      complete: false,
    });
  } finally {
    await scope.cleanup();
  }
});

test('concurrent createReparseRun calls create only one active run per household', async () => {
  const scope = await createTestScope();
  try {
    const results = await Promise.allSettled([
      createReparseRun(OWNER_EMAIL, scope.householdId),
      createReparseRun(OWNER_EMAIL, scope.householdId),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(await prisma.priceReparseRun.count({ where: { householdId: scope.householdId } }), 1);
  } finally {
    await scope.cleanup();
  }
});

test('createReparseRun rejects an active household run and succeeds after revocation', async () => {
  const scope = await createTestScope();
  try {
    const active = await createRun(scope);
    await assert.rejects(
      () => createReparseRun(OWNER_EMAIL, scope.householdId),
      /an active price reparse run already exists/
    );

    await prisma.priceReparseRun.update({ where: { id: active.id }, data: { revokedAt: new Date() } });
    const replacement = await createReparseRun(OWNER_EMAIL, scope.householdId);
    assert.equal(replacement.id.length > 0, true);
    assert.ok(replacement.expiresAt.getTime() > replacement.cutoffAt.getTime());
  } finally {
    await scope.cleanup();
  }
});

test('reparseResultItemSchema rejects an unsupported skipReason', () => {
  const parsed = reparseResultItemSchema.safeParse({
    candidateId: 'candidate-1',
    skipReason: 'arbitrary_free_text',
  });
  assert.equal(parsed.success, false);
});

test('reparse payload rejects priceSource without detectedPrice', () => {
  const parsed = reparseCandidatesPayloadSchema.safeParse({
    mode: 'write',
    results: [{ candidateId: 'candidate-1', priceSource: CERTAIN_PRICE_SOURCE }],
  });
  assert.equal(parsed.success, false);
});

test('reparse payload rejects skipReason together with price fields', () => {
  const parsed = reparseCandidatesPayloadSchema.safeParse({
    mode: 'write',
    results: [{ candidateId: 'candidate-1', detectedPrice: 500, skipReason: 'message_not_found' }],
  });
  assert.equal(parsed.success, false);
});
