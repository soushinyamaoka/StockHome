// 取消・復元APIのJWT認証込みHTTP境界テスト（S008-B04対応）。
// ローカルDocker Postgres（DATABASE_URL、apps/api/.env）に対して実行する。
// Codexの非対話実行ではDBへ接続せず、Claudeの対話セッションで別途実行する。
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import authPlugin from '../plugins/auth';
import itemRoutes from './items';
import importCandidateRoutes from './importCandidates';
import { prisma } from '../lib/prisma';

function buildApp() {
  const app = Fastify();
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = (body as string) ?? '';
    if (text.trim() === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      done(err as Error, undefined);
    }
  });
  return app;
}

async function buildAuthedApp() {
  const app = buildApp();
  await app.register(authPlugin);
  await app.register(async (instance) => {
    instance.addHook('preHandler', instance.authenticate);
    await instance.register(itemRoutes, { prefix: '/api/items' });
    await instance.register(importCandidateRoutes, { prefix: '/api/import-candidates' });
  });
  await app.ready();
  return app;
}

let scopeCounter = 0;

interface TestScope {
  tag: string;
  householdAId: string;
  householdBId: string;
  userA: { id: string; email: string };
  userB: { id: string; email: string };
  otherOwner: { id: string; email: string };
  cleanup: () => Promise<void>;
}

async function createTestScope(): Promise<TestScope> {
  scopeCounter += 1;
  const tag = `${Date.now()}-${scopeCounter}`;
  const householdA = await prisma.household.create({ data: { name: `undo-http-a-${tag}` } });
  const householdB = await prisma.household.create({ data: { name: `undo-http-b-${tag}` } });
  const userA = await prisma.user.create({
    data: { email: `undo-http-a-${tag}@example.invalid`, name: '利用者A', passwordHash: 'test-only' },
  });
  const userB = await prisma.user.create({
    data: { email: `undo-http-b-${tag}@example.invalid`, name: '利用者B', passwordHash: 'test-only' },
  });
  const otherOwner = await prisma.user.create({
    data: { email: `undo-http-owner-${tag}@example.invalid`, name: '別所有者', passwordHash: 'test-only' },
  });
  await prisma.householdMember.createMany({
    data: [
      { householdId: householdA.id, userId: userA.id, role: 'admin' },
      { householdId: householdB.id, userId: userB.id, role: 'admin' },
      { householdId: householdA.id, userId: otherOwner.id, role: 'member' },
    ],
  });

  return {
    tag,
    householdAId: householdA.id,
    householdBId: householdB.id,
    userA,
    userB,
    otherOwner,
    cleanup: async () => {
      await prisma.household.deleteMany({ where: { id: { in: [householdA.id, householdB.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id, otherOwner.id] } } });
    },
  };
}

async function createItem(scope: TestScope, householdId: string, label: string, isActive = true) {
  return prisma.item.create({
    data: {
      householdId,
      itemName: `undo-http-item-${label}-${scope.tag}`,
      daysPerUnit: 10,
      defaultPurchaseQty: 1,
      isActive,
      deletedAt: isActive ? null : new Date('2026-09-01T00:00:00.000Z'),
      deletedBy: isActive ? null : scope.userA.id,
      runtimeState: { create: { householdId } },
    },
  });
}

async function createCandidate(
  scope: TestScope,
  options: {
    householdId: string;
    label: string;
    status: 'confirmed' | 'auto_confirmed' | 'detected' | 'ignored';
    importedByEmail: string;
    matchedItemId?: string | null;
  }
) {
  return prisma.importOrderCandidate.create({
    data: {
      householdId: options.householdId,
      vendor: 'amazon',
      mailMessageId: `undo-http-${options.label}-${scope.tag}`,
      importedByEmail: options.importedByEmail,
      mailDate: new Date('2026-09-01T00:00:00.000Z'),
      mailType: 'order_confirm',
      mailPhase: 'shipped',
      itemNameRaw: `undo-http-${options.label}`,
      detectedQty: 1,
      candidateStatus: options.status,
      matchedItemId: options.matchedItemId ?? null,
    },
  });
}

async function createLinkedPurchase(
  householdId: string,
  itemId: string,
  candidateId: string,
  qty = 1
) {
  return prisma.purchaseLog.create({
    data: {
      householdId,
      itemId,
      purchasedAt: new Date('2026-09-01T00:00:00.000Z'),
      qty,
      source: 'gmail',
      sourceType: 'gmail_auto',
      importCandidateId: candidateId,
      fulfillmentStatus: 'shipped',
      inventoryEffectiveAt: new Date('2099-01-01T00:00:00.000Z'),
      countedInInventory: false,
    },
  });
}

function bearerToken(app: Awaited<ReturnType<typeof buildAuthedApp>>, userId: string) {
  return { authorization: `Bearer ${app.jwt.sign({ userId })}` };
}

test('unconfirmは他householdの候補を404として拒否し候補と購入履歴を変更しない', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const item = await createItem(scope, scope.householdAId, 'unconfirm-other-household');
    const candidate = await createCandidate(scope, {
      householdId: scope.householdAId,
      label: 'unconfirm-other-household',
      status: 'confirmed',
      importedByEmail: scope.userA.email,
      matchedItemId: item.id,
    });
    const purchase = await createLinkedPurchase(scope.householdAId, item.id, candidate.id);
    const candidateBefore = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    const purchaseBefore = await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } });

    const response = await app.inject({
      method: 'POST',
      url: `/api/import-candidates/${candidate.id}/unconfirm`,
      headers: bearerToken(app, scope.userB.id),
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(
      await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } }),
      candidateBefore
    );
    assert.deepEqual(await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } }), purchaseBefore);
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('unconfirmは同一household内でも他ownerの候補を404として拒否する', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const item = await createItem(scope, scope.householdAId, 'unconfirm-other-owner');
    const candidate = await createCandidate(scope, {
      householdId: scope.householdAId,
      label: 'unconfirm-other-owner',
      status: 'confirmed',
      importedByEmail: scope.otherOwner.email,
      matchedItemId: item.id,
    });
    const purchase = await createLinkedPurchase(scope.householdAId, item.id, candidate.id);
    const candidateBefore = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    const purchaseBefore = await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } });

    const response = await app.inject({
      method: 'POST',
      url: `/api/import-candidates/${candidate.id}/unconfirm`,
      headers: bearerToken(app, scope.userA.id),
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(
      await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } }),
      candidateBefore
    );
    assert.deepEqual(await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } }), purchaseBefore);
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('unconfirmは対象なしを404として拒否しDBを変更しない', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const item = await createItem(scope, scope.householdAId, 'unconfirm-not-found-control');
    const candidate = await createCandidate(scope, {
      householdId: scope.householdAId,
      label: 'unconfirm-not-found-control',
      status: 'confirmed',
      importedByEmail: scope.userA.email,
      matchedItemId: item.id,
    });
    const purchase = await createLinkedPurchase(scope.householdAId, item.id, candidate.id);
    const candidateBefore = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    const purchaseBefore = await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } });

    const response = await app.inject({
      method: 'POST',
      url: `/api/import-candidates/missing-${scope.tag}/unconfirm`,
      headers: bearerToken(app, scope.userA.id),
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(
      await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } }),
      candidateBefore
    );
    assert.deepEqual(await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } }), purchaseBefore);
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('unconfirmは状態不一致を409として拒否し候補と購入履歴を変更しない', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const item = await createItem(scope, scope.householdAId, 'unconfirm-conflict');
    const candidate = await createCandidate(scope, {
      householdId: scope.householdAId,
      label: 'unconfirm-conflict',
      status: 'detected',
      importedByEmail: scope.userA.email,
      matchedItemId: item.id,
    });
    const purchase = await createLinkedPurchase(scope.householdAId, item.id, candidate.id);
    const candidateBefore = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    const purchaseBefore = await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } });

    const response = await app.inject({
      method: 'POST',
      url: `/api/import-candidates/${candidate.id}/unconfirm`,
      headers: bearerToken(app, scope.userA.id),
    });

    assert.equal(response.statusCode, 409);
    assert.deepEqual(
      await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } }),
      candidateBefore
    );
    assert.deepEqual(await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } }), purchaseBefore);
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('unconfirm成功時は対象候補と紐づく購入履歴だけを変更する', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const targetItem = await createItem(scope, scope.householdAId, 'unconfirm-target');
    const untouchedItem = await createItem(scope, scope.householdAId, 'unconfirm-untouched');
    const targetCandidate = await createCandidate(scope, {
      householdId: scope.householdAId,
      label: 'unconfirm-target',
      status: 'confirmed',
      importedByEmail: scope.userA.email,
      matchedItemId: targetItem.id,
    });
    const untouchedCandidate = await createCandidate(scope, {
      householdId: scope.householdAId,
      label: 'unconfirm-untouched',
      status: 'confirmed',
      importedByEmail: scope.userA.email,
      matchedItemId: untouchedItem.id,
    });
    const targetPurchase = await createLinkedPurchase(
      scope.householdAId,
      targetItem.id,
      targetCandidate.id
    );
    const untouchedPurchase = await createLinkedPurchase(
      scope.householdAId,
      untouchedItem.id,
      untouchedCandidate.id
    );
    const untouchedCandidateBefore = await prisma.importOrderCandidate.findUniqueOrThrow({
      where: { id: untouchedCandidate.id },
    });
    const untouchedPurchaseBefore = await prisma.purchaseLog.findUniqueOrThrow({
      where: { id: untouchedPurchase.id },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/import-candidates/${targetCandidate.id}/unconfirm`,
      headers: bearerToken(app, scope.userA.id),
    });

    assert.equal(response.statusCode, 200);
    const targetAfter = await prisma.importOrderCandidate.findUniqueOrThrow({
      where: { id: targetCandidate.id },
    });
    assert.equal(targetAfter.candidateStatus, 'detected');
    assert.equal(targetAfter.matchedItemId, null);
    assert.equal(await prisma.purchaseLog.findUnique({ where: { id: targetPurchase.id } }), null);
    assert.deepEqual(
      await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: untouchedCandidate.id } }),
      untouchedCandidateBefore
    );
    assert.deepEqual(
      await prisma.purchaseLog.findUniqueOrThrow({ where: { id: untouchedPurchase.id } }),
      untouchedPurchaseBefore
    );
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('unignoreは他householdの候補を404として拒否し状態を変更しない', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const candidate = await createCandidate(scope, {
      householdId: scope.householdAId,
      label: 'unignore-other-household',
      status: 'ignored',
      importedByEmail: scope.userA.email,
    });
    const before = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });

    const response = await app.inject({
      method: 'POST',
      url: `/api/import-candidates/${candidate.id}/unignore`,
      headers: bearerToken(app, scope.userB.id),
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } }), before);
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('unignore成功後の再実行は409となり状態を変更しない', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const candidate = await createCandidate(scope, {
      householdId: scope.householdAId,
      label: 'unignore-retry',
      status: 'ignored',
      importedByEmail: scope.userA.email,
    });
    const headers = bearerToken(app, scope.userA.id);

    const first = await app.inject({
      method: 'POST',
      url: `/api/import-candidates/${candidate.id}/unignore`,
      headers,
    });
    assert.equal(first.statusCode, 200);
    const beforeRetry = await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    assert.equal(beforeRetry.candidateStatus, 'detected');

    const second = await app.inject({
      method: 'POST',
      url: `/api/import-candidates/${candidate.id}/unignore`,
      headers,
    });

    assert.equal(second.statusCode, 409);
    assert.deepEqual(
      await prisma.importOrderCandidate.findUniqueOrThrow({ where: { id: candidate.id } }),
      beforeRetry
    );
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('restoreは他householdの品目を404として拒否し状態を変更しない', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const item = await createItem(scope, scope.householdAId, 'restore-other-household', false);
    const before = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });

    const response = await app.inject({
      method: 'POST',
      url: `/api/items/${item.id}/restore`,
      headers: bearerToken(app, scope.userB.id),
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(await prisma.item.findUniqueOrThrow({ where: { id: item.id } }), before);
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('restoreは対象なしを404、既にアクティブな品目を409として拒否しDBを変更しない', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const activeItem = await createItem(scope, scope.householdAId, 'restore-conflicts');
    const before = await prisma.item.findUniqueOrThrow({ where: { id: activeItem.id } });
    const headers = bearerToken(app, scope.userA.id);

    const missing = await app.inject({
      method: 'POST',
      url: `/api/items/missing-${scope.tag}/restore`,
      headers,
    });
    const alreadyActive = await app.inject({
      method: 'POST',
      url: `/api/items/${activeItem.id}/restore`,
      headers,
    });

    assert.equal(missing.statusCode, 404);
    assert.equal(alreadyActive.statusCode, 409);
    assert.deepEqual(await prisma.item.findUniqueOrThrow({ where: { id: activeItem.id } }), before);
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('restore成功後の再実行は409となりアクティブ状態を変更しない', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const item = await createItem(scope, scope.householdAId, 'restore-retry', false);
    const headers = bearerToken(app, scope.userA.id);

    const first = await app.inject({
      method: 'POST',
      url: `/api/items/${item.id}/restore`,
      headers,
    });
    assert.equal(first.statusCode, 200);
    const beforeRetry = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(beforeRetry.isActive, true);
    assert.equal(beforeRetry.deletedAt, null);
    assert.equal(beforeRetry.deletedBy, null);

    const second = await app.inject({
      method: 'POST',
      url: `/api/items/${item.id}/restore`,
      headers,
    });

    assert.equal(second.statusCode, 409);
    assert.deepEqual(await prisma.item.findUniqueOrThrow({ where: { id: item.id } }), beforeRetry);
  } finally {
    await app.close();
    await scope.cleanup();
  }
});
