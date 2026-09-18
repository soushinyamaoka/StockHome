// 購入履歴編集APIのJWT認証込みHTTP境界テスト。
// ローカルDocker Postgres（DATABASE_URL、apps/api/.env）に対して実行する。
// Codexの非対話実行ではDBへ接続せず、Claudeの対話セッションで別途実行する。
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import authPlugin from '../plugins/auth';
import { prisma } from '../lib/prisma';
import purchaseRoutes from './purchases';

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
    await instance.register(purchaseRoutes, { prefix: '/api' });
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
  cleanup: () => Promise<void>;
}

async function createTestScope(): Promise<TestScope> {
  scopeCounter += 1;
  const tag = `${Date.now()}-${scopeCounter}`;
  const householdA = await prisma.household.create({ data: { name: `purchase-edit-a-${tag}` } });
  const householdB = await prisma.household.create({ data: { name: `purchase-edit-b-${tag}` } });
  const userA = await prisma.user.create({
    data: { email: `purchase-edit-a-${tag}@example.invalid`, name: '利用者A', passwordHash: 'test-only' },
  });
  const userB = await prisma.user.create({
    data: { email: `purchase-edit-b-${tag}@example.invalid`, name: '利用者B', passwordHash: 'test-only' },
  });
  await prisma.householdMember.createMany({
    data: [
      { householdId: householdA.id, userId: userA.id, role: 'admin' },
      { householdId: householdB.id, userId: userB.id, role: 'admin' },
    ],
  });

  return {
    tag,
    householdAId: householdA.id,
    householdBId: householdB.id,
    userA,
    userB,
    cleanup: async () => {
      await prisma.household.deleteMany({ where: { id: { in: [householdA.id, householdB.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    },
  };
}

async function createItem(scope: TestScope, householdId: string, label: string) {
  return prisma.item.create({
    data: {
      householdId,
      itemName: `purchase-edit-item-${label}-${scope.tag}`,
      daysPerUnit: 10,
      defaultPurchaseQty: 1,
      runtimeState: { create: { householdId } },
    },
  });
}

async function createPurchase(options: {
  householdId: string;
  itemId: string;
  qty: number;
  countedInInventory: boolean;
  price?: number | null;
  note?: string | null;
  source?: string;
  sourceType?: string;
  externalVendor?: string | null;
  purchasedAt?: Date;
  inventoryEffectiveAt?: Date;
}) {
  const purchasedAt = options.purchasedAt ?? new Date('2026-09-01T00:00:00.000Z');
  return prisma.purchaseLog.create({
    data: {
      householdId: options.householdId,
      itemId: options.itemId,
      purchasedAt,
      qty: options.qty,
      price: options.price ?? null,
      source: options.source ?? 'manual',
      sourceType: options.sourceType ?? 'manual',
      externalVendor: options.externalVendor ?? null,
      note: options.note ?? null,
      fulfillmentStatus: 'received',
      inventoryEffectiveAt: options.inventoryEffectiveAt ?? purchasedAt,
      countedInInventory: options.countedInInventory,
    },
  });
}

async function setAccumulatedState(itemId: string, qty: number, at = new Date('2026-09-02T03:00:00.000Z')) {
  return prisma.itemRuntimeState.update({
    where: { itemId },
    data: {
      manualOverrideQty: qty,
      manualOverrideAt: at,
      manualOverrideReason: 'purchase_accumulated',
    },
  });
}

function bearerToken(app: Awaited<ReturnType<typeof buildAuthedApp>>, userId: string) {
  return { authorization: `Bearer ${app.jwt.sign({ userId })}` };
}

test('他householdの購入履歴は404となり変更されない', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const item = await createItem(scope, scope.householdAId, 'other-household');
    const purchase = await createPurchase({
      householdId: scope.householdAId,
      itemId: item.id,
      qty: 2,
      countedInInventory: true,
      price: 100,
      note: 'before',
    });
    const before = await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/purchases/${purchase.id}`,
      headers: bearerToken(app, scope.userB.id),
      payload: { qty: 3, price: 200, note: 'after' },
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } }), before);
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('存在しない購入履歴は404となりDBを変更しない', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const item = await createItem(scope, scope.householdAId, 'missing-control');
    const control = await createPurchase({
      householdId: scope.householdAId,
      itemId: item.id,
      qty: 2,
      countedInInventory: true,
    });
    const before = await prisma.purchaseLog.findUniqueOrThrow({ where: { id: control.id } });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/purchases/missing-${scope.tag}`,
      headers: bearerToken(app, scope.userA.id),
      payload: { qty: 3 },
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(await prisma.purchaseLog.findUniqueOrThrow({ where: { id: control.id } }), before);
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('counted済み購入の数量を2から3へ訂正すると補正値だけ1増え補正日時は変わらない', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const item = await createItem(scope, scope.householdAId, 'increase');
    const purchase = await createPurchase({
      householdId: scope.householdAId,
      itemId: item.id,
      qty: 2,
      countedInInventory: true,
    });
    const beforeState = await setAccumulatedState(item.id, 5);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/purchases/${purchase.id}`,
      headers: bearerToken(app, scope.userA.id),
      payload: { qty: 3 },
    });

    assert.equal(response.statusCode, 200);
    const afterPurchase = await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } });
    const afterState = await prisma.itemRuntimeState.findUniqueOrThrow({ where: { itemId: item.id } });
    assert.equal(afterPurchase.qty, 3);
    assert.equal(afterState.manualOverrideQty, 6);
    assert.equal(afterState.manualOverrideAt?.getTime(), beforeState.manualOverrideAt?.getTime());
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('counted済み購入の数量を3から1へ訂正すると補正値が2減る', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const item = await createItem(scope, scope.householdAId, 'decrease');
    const purchase = await createPurchase({
      householdId: scope.householdAId,
      itemId: item.id,
      qty: 3,
      countedInInventory: true,
    });
    await setAccumulatedState(item.id, 7);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/purchases/${purchase.id}`,
      headers: bearerToken(app, scope.userA.id),
      payload: { qty: 1 },
    });

    assert.equal(response.statusCode, 200);
    assert.equal((await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } })).qty, 1);
    assert.equal(
      (await prisma.itemRuntimeState.findUniqueOrThrow({ where: { itemId: item.id } })).manualOverrideQty,
      5
    );
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('countedでない未来反映の購入は数量だけ変更し積み上げ補正値を変えない', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const item = await createItem(scope, scope.householdAId, 'not-counted');
    const future = new Date('2099-01-01T00:00:00.000Z');
    const purchase = await createPurchase({
      householdId: scope.householdAId,
      itemId: item.id,
      qty: 2,
      countedInInventory: false,
      inventoryEffectiveAt: future,
    });
    const beforeState = await setAccumulatedState(item.id, 8);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/purchases/${purchase.id}`,
      headers: bearerToken(app, scope.userA.id),
      payload: { qty: 4 },
    });

    assert.equal(response.statusCode, 200);
    assert.equal((await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } })).qty, 4);
    const afterState = await prisma.itemRuntimeState.findUniqueOrThrow({ where: { itemId: item.id } });
    assert.equal(afterState.manualOverrideQty, beforeState.manualOverrideQty);
    assert.equal(afterState.manualOverrideAt?.getTime(), beforeState.manualOverrideAt?.getTime());
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('単価と備考だけの変更では補正値を変えず、単価を値とnullの両方向へ変更できる', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const item = await createItem(scope, scope.householdAId, 'price-note');
    const purchase = await createPurchase({
      householdId: scope.householdAId,
      itemId: item.id,
      qty: 2,
      countedInInventory: true,
    });
    const beforeState = await setAccumulatedState(item.id, 5);
    const headers = bearerToken(app, scope.userA.id);

    const setResponse = await app.inject({
      method: 'PATCH',
      url: `/api/purchases/${purchase.id}`,
      headers,
      payload: { qty: 2, price: 480, note: 'updated' },
    });
    assert.equal(setResponse.statusCode, 200);
    let updated = await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } });
    assert.equal(updated.price, 480);
    assert.equal(updated.note, 'updated');

    const clearResponse = await app.inject({
      method: 'PATCH',
      url: `/api/purchases/${purchase.id}`,
      headers,
      payload: { qty: 2 },
    });
    assert.equal(clearResponse.statusCode, 200);
    updated = await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } });
    assert.equal(updated.price, null);
    assert.equal(updated.note, null);

    const afterState = await prisma.itemRuntimeState.findUniqueOrThrow({ where: { itemId: item.id } });
    assert.equal(afterState.manualOverrideQty, beforeState.manualOverrideQty);
    assert.equal(afterState.manualOverrideAt?.getTime(), beforeState.manualOverrideAt?.getTime());
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('編集しても購入日・品目・購入元・counted状態は変わらない', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const item = await createItem(scope, scope.householdAId, 'immutable-fields');
    const purchasedAt = new Date('2026-08-20T00:00:00.000Z');
    const effectiveAt = new Date('2026-08-22T00:00:00.000Z');
    const purchase = await createPurchase({
      householdId: scope.householdAId,
      itemId: item.id,
      qty: 2,
      countedInInventory: true,
      source: 'gmail',
      sourceType: 'gmail_auto',
      externalVendor: 'amazon',
      purchasedAt,
      inventoryEffectiveAt: effectiveAt,
    });
    await setAccumulatedState(item.id, 5);
    const before = await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/purchases/${purchase.id}`,
      headers: bearerToken(app, scope.userA.id),
      payload: { qty: 2, price: 320, note: 'memo' },
    });

    assert.equal(response.statusCode, 200);
    const after = await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } });
    assert.equal(after.purchasedAt.getTime(), before.purchasedAt.getTime());
    assert.equal(after.itemId, before.itemId);
    assert.equal(after.source, before.source);
    assert.equal(after.sourceType, before.sourceType);
    assert.equal(after.externalVendor, before.externalVendor);
    assert.equal(after.countedInInventory, before.countedInInventory);
    assert.equal(after.inventoryEffectiveAt?.getTime(), before.inventoryEffectiveAt?.getTime());
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('数量0と負数は400で拒否され購入履歴を変更しない', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const item = await createItem(scope, scope.householdAId, 'invalid-qty');
    const purchase = await createPurchase({
      householdId: scope.householdAId,
      itemId: item.id,
      qty: 2,
      countedInInventory: true,
      price: 100,
      note: 'before',
    });
    const before = await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } });
    const headers = bearerToken(app, scope.userA.id);

    const zeroResponse = await app.inject({
      method: 'PATCH',
      url: `/api/purchases/${purchase.id}`,
      headers,
      payload: { qty: 0, price: 200, note: 'zero' },
    });
    const negativeResponse = await app.inject({
      method: 'PATCH',
      url: `/api/purchases/${purchase.id}`,
      headers,
      payload: { qty: -1, price: 200, note: 'negative' },
    });

    assert.equal(zeroResponse.statusCode, 400);
    assert.equal(negativeResponse.statusCode, 400);
    assert.deepEqual(await prisma.purchaseLog.findUniqueOrThrow({ where: { id: purchase.id } }), before);
  } finally {
    await app.close();
    await scope.cleanup();
  }
});
