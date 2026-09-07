import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReparseResultItem } from '@stockhome/shared';
import { reparseResultItemSchema } from '@stockhome/shared';
import { prisma } from '../lib/prisma';
import { CERTAIN_UNIT_PRICE_SOURCES } from './candidateIntake';
import {
  createReparseRun,
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
        await prisma.priceReparseAudit.deleteMany({ where: { runId: { in: runIds } } });
      }
      await prisma.priceReparseRun.deleteMany({ where: { householdId: household.id } });
      await prisma.household.delete({ where: { id: household.id } });
    },
  };
}

async function createRun(
  scope: TestScope,
  options: { importedByEmail?: string; expiresAt?: Date; revokedAt?: Date | null } = {}
) {
  return prisma.priceReparseRun.create({
    data: {
      runToken: `rrun_test_${scope.tag}_${Math.random().toString(16).slice(2)}`,
      householdId: scope.householdId,
      importedByEmail: options.importedByEmail ?? OWNER_EMAIL,
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

test('concurrent writes allow only one candidate update', async () => {
  const scope = await createTestScope();
  try {
    const run = await createRun(scope);
    const candidate = await createCandidate(scope);
    const item = { candidateId: candidate.id, detectedPrice: 500, priceSource: CERTAIN_PRICE_SOURCE };
    const [a, b] = await Promise.all([
      processReparseResults(run.runToken, 'write', [item]),
      processReparseResults(run.runToken, 'write', [item]),
    ]);

    assert.equal(a.updatedCandidate + b.updatedCandidate, 1);
    assert.equal(a.conflict + b.conflict, 1);
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
    const second = await processReparseResults(run.runToken, 'write', results);
    assert.equal(first.updatedCandidate, 2);
    assert.equal(first.updatedPurchase, 1);
    assert.equal(second.conflict, 2);
    assert.equal(second.updatedCandidate, 0);
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
    const reloaded = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    assert.equal(reloaded.detectedPrice, null);
    assert.equal(reloaded.priceSource, null);
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
    const reloaded = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    assert.equal(reloaded.detectedPrice, 300);
    assert.equal(reloaded.priceSource, null);
  } finally {
    await scope.cleanup();
  }
});

test('a price-only update cannot be replaced by a second price-only update', async () => {
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
    assert.equal(second.conflict, 1);
    assert.equal(second.bySkipReason.already_has_price, 1);
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

test('reparseResultItemSchema rejects an unsupported skipReason', () => {
  const parsed = reparseResultItemSchema.safeParse({
    candidateId: 'candidate-1',
    skipReason: 'arbitrary_free_text',
  });
  assert.equal(parsed.success, false);
});

test('createReparseRun generates unique tokens and future expirations without a DB write', async () => {
  const delegate = prisma.priceReparseRun as unknown as {
    create: (args: {
      data: {
        runToken: string;
        importedByEmail: string;
        householdId: string;
        expiresAt: Date;
      };
    }) => Promise<{
      id: string;
      runToken: string;
      importedByEmail: string;
      householdId: string;
      createdAt: Date;
      expiresAt: Date;
      revokedAt: Date | null;
    }>;
  };
  let callCount = 0;
  const originalCreate = delegate.create;
  delegate.create = async ({ data }: Parameters<typeof delegate.create>[0]) => {
    callCount += 1;
    return {
      id: `mock-run-${callCount}`,
      runToken: data.runToken,
      importedByEmail: data.importedByEmail,
      householdId: data.householdId,
      createdAt: new Date(),
      expiresAt: data.expiresAt,
      revokedAt: null,
    };
  };

  try {
    const before = Date.now();
    const first = await createReparseRun(OWNER_EMAIL, 'household-1', 1);
    const second = await createReparseRun(OWNER_EMAIL, 'household-1', 1);
    assert.notEqual(first.runToken, second.runToken);
    assert.match(first.runToken, /^rrun_[0-9a-f]{64}$/);
    assert.ok(first.expiresAt.getTime() > before);
    assert.equal(callCount, 2);
  } finally {
    delegate.create = originalCreate;
  }
});
