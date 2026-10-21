import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import authPlugin from '../plugins/auth';
import { prisma } from '../lib/prisma';
import itemRoutes from './items';
import { accumulatePurchaseIntoStock, refreshStockSnapshotForItem, todayDateOnly } from '../services/stockCalc';

async function makeApp() {
  const app = Fastify();
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = (body as string) ?? '';
    if (!text.trim()) return done(null, {});
    try { done(null, JSON.parse(text)); } catch (error) { done(error as Error, undefined); }
  });
  await app.register(authPlugin);
  await app.register(async (instance) => {
    instance.addHook('preHandler', instance.authenticate);
    await instance.register(itemRoutes, { prefix: '/api/items' });
  });
  await app.ready();
  return app;
}

test('item consumption pause and resume HTTP lifecycle', async () => {
  const tag = `${Date.now()}`;
  const household = await prisma.household.create({ data: { name: `pause-${tag}` } });
  const otherHousehold = await prisma.household.create({ data: { name: `pause-other-${tag}` } });
  const user = await prisma.user.create({
    data: { email: `pause-${tag}@example.invalid`, name: 'Pause Test', passwordHash: 'test-only' },
  });
  await prisma.householdMember.create({ data: { householdId: household.id, userId: user.id, role: 'admin' } });
  const createItem = (householdId: string, itemName: string, isActive = true) => prisma.item.create({
    data: {
      householdId, itemName, daysPerUnit: 10, defaultPurchaseQty: 1, isActive,
      runtimeState: { create: { householdId } },
    },
  });
  const item = await createItem(household.id, `counted-${tag}`);
  const unknown = await createItem(household.id, `unknown-${tag}`);
  const inactive = await createItem(household.id, `inactive-${tag}`, false);
  const other = await createItem(otherHousehold.id, `other-${tag}`);
  await prisma.purchaseLog.create({
    // 20日前に5個買って在庫に計上済み → 休止時点の残数は 5 - 20/10 = 3
    data: {
      householdId: household.id, itemId: item.id, qty: 5, countedInInventory: true,
      purchasedAt: new Date(todayDateOnly().getTime() - 20 * 24 * 60 * 60 * 1000),
    },
  });
  const app = await makeApp();
  const headers = { authorization: `Bearer ${app.jwt.sign({ userId: user.id })}` };
  try {
    const pause = await app.inject({ method: 'POST', url: `/api/items/${item.id}/pause`, headers });
    assert.equal(pause.statusCode, 200);
    const pausedAt = pause.json().item.consumptionPausedAt;
    assert.ok(pausedAt);
    const snapshot = await prisma.stockSnapshot.findUniqueOrThrow({ where: { itemId: item.id } });
    assert.equal(snapshot.alertNeeded, false);
    assert.equal(snapshot.estimatedDaysLeft, null);
    const pauseAgain = await app.inject({ method: 'POST', url: `/api/items/${item.id}/pause`, headers });
    assert.equal(pauseAgain.json().item.consumptionPausedAt, pausedAt);

    await prisma.$transaction(async (tx) => {
      await tx.purchaseLog.create({
        data: { householdId: household.id, itemId: item.id, purchasedAt: new Date(), qty: 2, countedInInventory: false },
      });
      await accumulatePurchaseIntoStock(tx, item.id, household.id, 2, user.id, 'purchase_accumulated_test');
      await refreshStockSnapshotForItem(item.id, tx);
    });
    const afterPurchase = await prisma.stockSnapshot.findUniqueOrThrow({ where: { itemId: item.id } });
    assert.equal(afterPurchase.estimatedRemainingQty, 5);

    const resume = await app.inject({ method: 'POST', url: `/api/items/${item.id}/resume`, headers });
    assert.equal(resume.statusCode, 200);
    const resumedState = await prisma.itemRuntimeState.findUniqueOrThrow({ where: { itemId: item.id } });
    assert.equal(resumedState.manualOverrideReason, 'purchase_accumulated_resume');
    assert.ok(resumedState.manualOverrideAt);
    const resumeAgain = await app.inject({ method: 'POST', url: `/api/items/${item.id}/resume`, headers });
    assert.equal(resumeAgain.statusCode, 200);

    const unknownPause = await app.inject({ method: 'POST', url: `/api/items/${unknown.id}/pause`, headers });
    assert.equal(unknownPause.statusCode, 200);
    await app.inject({ method: 'POST', url: `/api/items/${unknown.id}/resume`, headers });
    const unknownState = await prisma.itemRuntimeState.findUniqueOrThrow({ where: { itemId: unknown.id } });
    assert.equal(unknownState.manualOverrideQty, null);
    assert.equal((await app.inject({ method: 'POST', url: `/api/items/${other.id}/pause`, headers })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url: `/api/items/missing-${tag}/pause`, headers })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url: `/api/items/${inactive.id}/pause`, headers })).statusCode, 409);
  } finally {
    await app.close();
    await prisma.household.deleteMany({ where: { id: { in: [household.id, otherHousehold.id] } } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
});
