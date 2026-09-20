import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import authPlugin from '../plugins/auth';
import { prisma } from '../lib/prisma';
import correctionRoutes from './corrections';

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
    await instance.register(correctionRoutes, { prefix: '/api' });
  });
  await app.ready();
  return app;
}

let scopeCounter = 0;

interface TestScope {
  tag: string;
  householdAId: string;
  userA: { id: string };
  itemAId: string;
  itemBId: string;
  cleanup: () => Promise<void>;
}

async function createTestScope(): Promise<TestScope> {
  scopeCounter += 1;
  const tag = `${Date.now()}-${scopeCounter}`;
  const householdA = await prisma.household.create({ data: { name: `corrections-http-a-${tag}` } });
  const householdB = await prisma.household.create({ data: { name: `corrections-http-b-${tag}` } });
  const userA = await prisma.user.create({
    data: { email: `corrections-http-a-${tag}@example.invalid`, name: 'Correction User A', passwordHash: 'test-only' },
  });
  const userB = await prisma.user.create({
    data: { email: `corrections-http-b-${tag}@example.invalid`, name: 'Correction User B', passwordHash: 'test-only' },
  });
  await prisma.householdMember.createMany({
    data: [
      { householdId: householdA.id, userId: userA.id, role: 'admin' },
      { householdId: householdB.id, userId: userB.id, role: 'admin' },
    ],
  });
  const itemA = await prisma.item.create({
    data: {
      householdId: householdA.id,
      itemName: `corrections-http-a-${tag}`,
      daysPerUnit: 10,
      defaultPurchaseQty: 1,
      runtimeState: { create: { householdId: householdA.id } },
    },
  });
  const itemB = await prisma.item.create({
    data: {
      householdId: householdB.id,
      itemName: `corrections-http-b-${tag}`,
      daysPerUnit: 10,
      defaultPurchaseQty: 1,
      runtimeState: { create: { householdId: householdB.id } },
    },
  });

  return {
    tag,
    householdAId: householdA.id,
    userA,
    itemAId: itemA.id,
    itemBId: itemB.id,
    cleanup: async () => {
      await prisma.household.deleteMany({ where: { id: { in: [householdA.id, householdB.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    },
  };
}

function bearerToken(app: Awaited<ReturnType<typeof buildAuthedApp>>, userId: string) {
  return { authorization: `Bearer ${app.jwt.sign({ userId })}` };
}

test('POST /api/corrections creates a correction log and updates the runtime override', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/corrections',
      headers: bearerToken(app, scope.userA.id),
      payload: {
        itemId: scope.itemAId,
        correctedQty: 7,
        correctionReason: 'counted_actual_stock',
        note: 'HTTP test correction',
      },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().correction.itemId, scope.itemAId);
    assert.equal(await prisma.stockCorrectionLog.count({ where: { itemId: scope.itemAId } }), 1);
    assert.equal(
      (await prisma.itemRuntimeState.findUniqueOrThrow({ where: { itemId: scope.itemAId } })).manualOverrideQty,
      7
    );
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('POST /api/corrections returns 404 and leaves another household item unchanged', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const stateBefore = await prisma.itemRuntimeState.findUniqueOrThrow({ where: { itemId: scope.itemBId } });
    const response = await app.inject({
      method: 'POST',
      url: '/api/corrections',
      headers: bearerToken(app, scope.userA.id),
      payload: {
        itemId: scope.itemBId,
        correctedQty: 7,
        correctionReason: 'counted_actual_stock',
      },
    });

    assert.equal(response.statusCode, 404);
    assert.equal(await prisma.stockCorrectionLog.count({ where: { itemId: scope.itemBId } }), 0);
    assert.deepEqual(
      await prisma.itemRuntimeState.findUniqueOrThrow({ where: { itemId: scope.itemBId } }),
      stateBefore
    );
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('GET /api/items/:itemId/corrections returns 404 for another household item', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/items/${scope.itemBId}/corrections`,
      headers: bearerToken(app, scope.userA.id),
    });

    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('POST /api/snooze sets snoozeUntil to approximately seven days in the future', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const before = Date.now();
    const response = await app.inject({
      method: 'POST',
      url: '/api/snooze',
      headers: bearerToken(app, scope.userA.id),
      payload: { itemId: scope.itemAId, action: 'days7' },
    });
    const after = Date.now();

    assert.equal(response.statusCode, 200);
    const snoozeUntil = (await prisma.itemRuntimeState.findUniqueOrThrow({ where: { itemId: scope.itemAId } })).snoozeUntil;
    assert.notEqual(snoozeUntil, null);
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    assert.ok(snoozeUntil!.getTime() >= before + sevenDays - 1_000);
    assert.ok(snoozeUntil!.getTime() <= after + sevenDays + 1_000);
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('POST /api/snooze clears snoozeUntil for the clear action', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    await prisma.itemRuntimeState.update({
      where: { itemId: scope.itemAId },
      data: { snoozeUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/snooze',
      headers: bearerToken(app, scope.userA.id),
      payload: { itemId: scope.itemAId, action: 'clear' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().snoozeUntil, null);
    assert.equal(
      (await prisma.itemRuntimeState.findUniqueOrThrow({ where: { itemId: scope.itemAId } })).snoozeUntil,
      null
    );
  } finally {
    await app.close();
    await scope.cleanup();
  }
});
