import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import authPlugin from '../plugins/auth';
import { prisma } from '../lib/prisma';
import stockRoutes from './stocks';
import { computeSuggestedDaysPerUnit } from './purchases';

function buildApp() {
  const app = Fastify();
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = (body as string) ?? '';
    if (text.trim() === '') return done(null, {});
    try { done(null, JSON.parse(text)); } catch (error) { done(error as Error, undefined); }
  });
  return app;
}

async function buildAuthedApp() {
  const app = buildApp();
  await app.register(authPlugin);
  await app.register(async (instance) => {
    instance.addHook('preHandler', instance.authenticate);
    await instance.register(stockRoutes, { prefix: '/api/stocks' });
  });
  await app.ready();
  return app;
}

let scopeCounter = 0;

test('GET /api/stocks returns purchase pace suggestions scoped to active household items', async () => {
  scopeCounter += 1;
  const tag = `${Date.now()}-${scopeCounter}`;
  const householdA = await prisma.household.create({ data: { name: `stocks-http-a-${tag}` } });
  const householdB = await prisma.household.create({ data: { name: `stocks-http-b-${tag}` } });
  const userA = await prisma.user.create({
    data: { email: `stocks-http-a-${tag}@example.invalid`, name: 'Stock User A', passwordHash: 'test-only' },
  });
  await prisma.householdMember.create({ data: { householdId: householdA.id, userId: userA.id, role: 'admin' } });
  const createItem = (householdId: string, itemName: string) => prisma.item.create({
    data: {
      householdId, itemName, daysPerUnit: 10, defaultPurchaseQty: 1,
      runtimeState: { create: { householdId } },
    },
  });
  const suggestedItem = await createItem(householdA.id, `suggested-${tag}`);
  const emptyItem = await createItem(householdA.id, `empty-${tag}`);
  const singleItem = await createItem(householdA.id, `single-${tag}`);
  const otherItem = await createItem(householdB.id, `other-${tag}`);
  const purchaseDates = ['2026-01-01', '2026-01-11', '2026-01-21'].map((day) => new Date(`${day}T00:00:00.000Z`));
  await prisma.purchaseLog.createMany({
    data: purchaseDates.map((purchasedAt, index) => ({
      householdId: householdA.id, itemId: suggestedItem.id, purchasedAt, qty: index === 0 ? 2 : 1,
    })),
  });
  await prisma.purchaseLog.create({
    data: { householdId: householdA.id, itemId: singleItem.id, purchasedAt: purchaseDates[0], qty: 1 },
  });
  await prisma.purchaseLog.createMany({
    data: purchaseDates.map((purchasedAt) => ({
      householdId: householdB.id, itemId: otherItem.id, purchasedAt, qty: 100,
    })),
  });

  const app = await buildAuthedApp();
  try {
    const response = await app.inject({
      method: 'GET', url: '/api/stocks',
      headers: { authorization: `Bearer ${app.jwt.sign({ userId: userA.id })}` },
    });
    assert.equal(response.statusCode, 200);
    const stocks = response.json().stocks as Array<Record<string, any>>;
    const byId = new Map(stocks.map((entry) => [entry.item.id, entry]));
    assert.equal(stocks.length, 3);
    assert.equal(byId.has(otherItem.id), false);
    const expected = computeSuggestedDaysPerUnit(purchaseDates.map((purchasedAt, index) => ({
      purchasedAt, qty: index === 0 ? 2 : 1,
    })));
    assert.deepEqual(byId.get(suggestedItem.id)?.suggestedDaysPerUnit, expected);
    assert.equal(byId.get(emptyItem.id)?.suggestedDaysPerUnit, null);
    assert.equal(byId.get(singleItem.id)?.suggestedDaysPerUnit, null);
    const entry = byId.get(suggestedItem.id)!;
    assert.ok('item' in entry);
    assert.ok('snapshot' in entry);
    assert.ok('runtimeState' in entry);
  } finally {
    await app.close();
    await prisma.household.deleteMany({ where: { id: { in: [householdA.id, householdB.id] } } });
    await prisma.user.deleteMany({ where: { id: userA.id } });
  }
});
