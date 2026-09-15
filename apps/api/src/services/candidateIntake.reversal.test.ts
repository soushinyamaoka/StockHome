// 候補確定取り消しのDB依存回帰テスト（所見B-3対応）。
// ローカルDocker Postgres（DATABASE_URL、apps/api/.env）に対して実行する。
// 各テストは独立した household/item を作成し、終了時に household をカスケード削除する。
//
// 実行方法: npm test --workspace=@stockhome/api
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ImportOrderCandidate } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  createPurchaseLogFromCandidate,
  unconfirmImportCandidate,
} from './candidateIntake';
import { accumulatePurchaseIntoStock, todayDateOnly } from './stockCalc';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
let scopeCounter = 0;

interface TestScope {
  householdId: string;
  itemId: string;
  cleanup: () => Promise<void>;
}

async function createTestScope(): Promise<TestScope> {
  scopeCounter += 1;
  const tag = `${Date.now()}-${scopeCounter}`;
  const household = await prisma.household.create({
    data: { name: `candidate-reversal-household-${tag}` },
  });
  const item = await prisma.item.create({
    data: {
      householdId: household.id,
      itemName: `candidate-reversal-item-${tag}`,
      daysPerUnit: 10,
      defaultPurchaseQty: 1,
      runtimeState: { create: { householdId: household.id } },
    },
  });

  return {
    householdId: household.id,
    itemId: item.id,
    cleanup: async () => {
      await prisma.household.delete({ where: { id: household.id } });
    },
  };
}

async function createConfirmedCandidate(
  scope: TestScope,
  label: string,
  legacyId: string | null = null
): Promise<ImportOrderCandidate> {
  return prisma.importOrderCandidate.create({
    data: {
      householdId: scope.householdId,
      legacyId,
      vendor: 'amazon',
      mailMessageId: `candidate-reversal-${label}-${Date.now()}-${scopeCounter}`,
      mailDate: new Date('2020-01-01T00:00:00.000Z'),
      mailType: 'order_confirm',
      mailPhase: 'shipped',
      itemNameRaw: `candidate-reversal-${label}`,
      detectedQty: 1,
      candidateStatus: 'confirmed',
      matchedItemId: scope.itemId,
    },
  });
}

async function createLinkedPurchase(
  scope: TestScope,
  candidate: ImportOrderCandidate,
  qty: number,
  countedInInventory: boolean,
  importCandidateId = candidate.id
) {
  const purchasedAt = candidate.mailDate;
  const inventoryEffectiveAt = countedInInventory
    ? purchasedAt
    : new Date('2099-01-01T00:00:00.000Z');

  if (!countedInInventory) {
    return prisma.purchaseLog.create({
      data: {
        householdId: scope.householdId,
        itemId: scope.itemId,
        purchasedAt,
        qty,
        source: 'gmail',
        sourceType: 'gmail_auto',
        importCandidateId,
        fulfillmentStatus: 'shipped',
        inventoryEffectiveAt,
        countedInInventory: false,
      },
    });
  }

  return prisma.$transaction(async (tx) => {
    await accumulatePurchaseIntoStock(
      tx,
      scope.itemId,
      scope.householdId,
      qty,
      null,
      'purchase_accumulated_gmail'
    );
    return tx.purchaseLog.create({
      data: {
        householdId: scope.householdId,
        itemId: scope.itemId,
        purchasedAt,
        qty,
        source: 'gmail',
        sourceType: 'gmail_auto',
        importCandidateId,
        fulfillmentStatus: 'shipped',
        inventoryEffectiveAt,
        countedInInventory: true,
      },
    });
  });
}

async function currentManualOverrideQty(itemId: string): Promise<number | null> {
  const state = await prisma.itemRuntimeState.findUnique({ where: { itemId } });
  return state?.manualOverrideQty ?? null;
}

test('countedな確定を取り消すと購入履歴と積み上げが差し戻され、候補が未確定に戻る', async () => {
  const scope = await createTestScope();
  try {
    const candidate = await createConfirmedCandidate(scope, 'counted');
    const purchase = await createLinkedPurchase(scope, candidate, 3, true);
    assert.equal(await currentManualOverrideQty(scope.itemId), 3);

    const result = await unconfirmImportCandidate(candidate.id, scope.householdId);

    assert.ok(result);
    assert.equal(result.reversedPurchaseId, purchase.id);
    assert.equal(await prisma.purchaseLog.findUnique({ where: { id: purchase.id } }), null);
    assert.equal(await currentManualOverrideQty(scope.itemId), 0);
    assert.equal(result.candidate.candidateStatus, 'detected');
    assert.equal(result.candidate.matchedItemId, null);
  } finally {
    await scope.cleanup();
  }
});

test('未countedな確定を取り消しても積み上げ値は変更されず、購入履歴だけが削除される', async () => {
  const scope = await createTestScope();
  try {
    const candidate = await createConfirmedCandidate(scope, 'not-counted');
    await prisma.itemRuntimeState.update({
      where: { itemId: scope.itemId },
      data: {
        manualOverrideQty: 4,
        manualOverrideAt: new Date(),
        manualOverrideReason: 'purchase_accumulated_gmail',
      },
    });
    const purchase = await createLinkedPurchase(scope, candidate, 3, false);

    const result = await unconfirmImportCandidate(candidate.id, scope.householdId);

    assert.ok(result);
    assert.equal(result.reversedPurchaseId, purchase.id);
    assert.equal(await prisma.purchaseLog.findUnique({ where: { id: purchase.id } }), null);
    assert.equal(await currentManualOverrideQty(scope.itemId), 4);
    assert.equal(result.candidate.candidateStatus, 'detected');
    assert.equal(result.candidate.matchedItemId, null);
  } finally {
    await scope.cleanup();
  }
});

test('legacyIdで紐づく購入履歴も見つけて削除し、積み上げを差し戻す', async () => {
  const scope = await createTestScope();
  try {
    const legacyId = `legacy-candidate-${Date.now()}-${scopeCounter}`;
    const candidate = await createConfirmedCandidate(scope, 'legacy', legacyId);
    const purchase = await createLinkedPurchase(scope, candidate, 2, true, legacyId);
    assert.equal(await currentManualOverrideQty(scope.itemId), 2);

    const result = await unconfirmImportCandidate(candidate.id, scope.householdId);

    assert.ok(result);
    assert.equal(result.reversedPurchaseId, purchase.id);
    assert.equal(await prisma.purchaseLog.findUnique({ where: { id: purchase.id } }), null);
    assert.equal(await currentManualOverrideQty(scope.itemId), 0);
    assert.equal(result.candidate.candidateStatus, 'detected');
    assert.equal(result.candidate.matchedItemId, null);
  } finally {
    await scope.cleanup();
  }
});

test('紐づく購入履歴が無くてもエラーにせず候補だけを未確定へ戻す', async () => {
  const scope = await createTestScope();
  try {
    const candidate = await createConfirmedCandidate(scope, 'missing-purchase');

    const result = await unconfirmImportCandidate(candidate.id, scope.householdId);

    assert.ok(result);
    assert.equal(result.reversedPurchaseId, null);
    assert.equal(result.candidate.candidateStatus, 'detected');
    assert.equal(result.candidate.matchedItemId, null);
  } finally {
    await scope.cleanup();
  }
});

test('取り消した候補を同じ品目へ再確定すると新しい購入履歴を作成できる', async () => {
  const scope = await createTestScope();
  try {
    const candidate = await createConfirmedCandidate(scope, 'reconfirm');
    const originalPurchase = await createLinkedPurchase(scope, candidate, 1, true);
    const unconfirmed = await unconfirmImportCandidate(candidate.id, scope.householdId);
    assert.ok(unconfirmed);
    const { candidate: detected } = unconfirmed;

    const newPurchase = await createPurchaseLogFromCandidate(
      detected,
      scope.itemId,
      null,
      'gmail_auto'
    );
    const reconfirmed = await prisma.importOrderCandidate.update({
      where: { id: candidate.id },
      data: { candidateStatus: 'confirmed', matchedItemId: scope.itemId },
    });

    assert.notEqual(newPurchase.id, originalPurchase.id);
    assert.equal(newPurchase.importCandidateId, candidate.id);
    assert.equal(newPurchase.countedInInventory, true);
    assert.equal(reconfirmed.candidateStatus, 'confirmed');
    assert.equal(reconfirmed.matchedItemId, scope.itemId);
    assert.equal(await currentManualOverrideQty(scope.itemId), 1);
    assert.ok(newPurchase.inventoryEffectiveAt);
    assert.ok(newPurchase.inventoryEffectiveAt <= todayDateOnly());
  } finally {
    await scope.cleanup();
  }
});

test('同一候補への同時取消は一方だけが成功し、購入履歴と積み上げを一度だけ差し戻す', async () => {
  const scope = await createTestScope();
  try {
    const candidate = await createConfirmedCandidate(scope, 'concurrent');
    const purchase = await createLinkedPurchase(scope, candidate, 3, true);
    assert.equal(await currentManualOverrideQty(scope.itemId), 3);

    const results = await Promise.all([
      unconfirmImportCandidate(candidate.id, scope.householdId),
      unconfirmImportCandidate(candidate.id, scope.householdId),
    ]);
    const succeeded = results.filter((result) => result !== null);
    const rejected = results.filter((result) => result === null);

    assert.equal(succeeded.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(succeeded[0]!.reversedPurchaseId, purchase.id);
    assert.equal(await prisma.purchaseLog.findUnique({ where: { id: purchase.id } }), null);
    assert.equal(await currentManualOverrideQty(scope.itemId), 0);
    const storedCandidate = await prisma.importOrderCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    assert.equal(storedCandidate.candidateStatus, 'detected');
    assert.equal(storedCandidate.matchedItemId, null);
  } finally {
    await scope.cleanup();
  }
});

test('既に取消済みの候補を再度取り消すとnullを返しDB状態を変更しない', async () => {
  const scope = await createTestScope();
  try {
    const candidate = await createConfirmedCandidate(scope, 'already-unconfirmed');
    const purchase = await createLinkedPurchase(scope, candidate, 2, true);

    const first = await unconfirmImportCandidate(candidate.id, scope.householdId);
    assert.ok(first);
    const candidateBeforeRetry = await prisma.importOrderCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    const purchaseBeforeRetry = await prisma.purchaseLog.findUnique({ where: { id: purchase.id } });

    const second = await unconfirmImportCandidate(candidate.id, scope.householdId);

    assert.equal(second, null);
    const candidateAfterRetry = await prisma.importOrderCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    const purchaseAfterRetry = await prisma.purchaseLog.findUnique({ where: { id: purchase.id } });
    assert.deepEqual(candidateAfterRetry, candidateBeforeRetry);
    assert.equal(purchaseBeforeRetry, null);
    assert.equal(purchaseAfterRetry, null);
    assert.equal(await currentManualOverrideQty(scope.itemId), 0);
  } finally {
    await scope.cleanup();
  }
});
