import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import bridgeRoutes from './bridge';
import { prisma } from '../lib/prisma';
import { runDailyBatch } from '../services/batch';

const BRIDGE_TOKEN = 'test-bridge-token';
let scopeCounter = 0;

function buildTestApp() {
  const app = Fastify();
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = (body as string) ?? '';
    if (text.trim() === '') return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      done(err as Error, undefined);
    }
  });
  return app;
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function createAlertScope() {
  const tag = `${Date.now()}-${++scopeCounter}`;
  const household = await prisma.household.create({ data: { name: `readygo-race-household-${tag}` } });
  const user = await prisma.user.create({
    data: { email: `readygo-race-${tag}@example.invalid`, name: 'ReadyGo race test user', passwordHash: 'x' },
  });
  await prisma.householdMember.create({ data: { householdId: household.id, userId: user.id, role: 'admin' } });
  const item = await prisma.item.create({
    data: {
      householdId: household.id,
      itemName: `readygo-race-item-${tag}`,
      daysPerUnit: 1,
      defaultPurchaseQty: 1,
      leadDays: 1,
      runtimeState: {
        create: { householdId: household.id, manualOverrideQty: 0, manualOverrideAt: new Date() },
      },
    },
  });
  return {
    householdId: household.id,
    itemId: item.id,
    cleanup: async () => {
      await prisma.household.delete({ where: { id: household.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    },
  };
}

async function createReadyGoApp() {
  const app = buildTestApp();
  await app.register(bridgeRoutes, { prefix: '/api/bridge' });
  await app.ready();
  return app;
}

async function createClaimedRowAndReplacement(app: Awaited<ReturnType<typeof createReadyGoApp>>, householdId: string) {
  await runDailyBatch(undefined, { householdId });
  const claimedResponse = await app.inject({
    method: 'GET',
    url: '/api/bridge/readygo-pending',
    headers: { 'x-bridge-token': BRIDGE_TOKEN },
  });
  assert.equal(claimedResponse.statusCode, 200);
  const [claimed] = claimedResponse.json<{ pending: { id: string; body: string }[] }>().pending;
  assert.ok(claimed);

  const claimedBefore = await prisma.readyGoOutbox.findUniqueOrThrow({ where: { id: claimed.id } });
  assert.equal(claimedBefore.status, 'claimed');
  await runDailyBatch(undefined, { householdId });
  const pending = await prisma.readyGoOutbox.findFirstOrThrow({
    where: { householdId, status: 'pending' },
  });
  return { claimed, claimedBefore, pending };
}

test('claimed ReadyGo rows are excluded from batch replacement', async () => {
  await withEnv({ BRIDGE_TOKEN }, async () => {
    const scope = await createAlertScope();
    const app = await createReadyGoApp();
    try {
      const { claimed, claimedBefore, pending } = await createClaimedRowAndReplacement(app, scope.householdId);
      const claimedAfter = await prisma.readyGoOutbox.findUniqueOrThrow({ where: { id: claimed.id } });
      assert.equal(claimedAfter.status, 'claimed');
      assert.equal(claimedAfter.body, claimedBefore.body);
      assert.notEqual(pending.id, claimed.id);
    } finally {
      await app.close();
      await scope.cleanup();
    }
  });
});

test('claimed ReadyGo rows can be acknowledged without changing the replacement pending row', async () => {
  await withEnv({ BRIDGE_TOKEN }, async () => {
    const scope = await createAlertScope();
    const app = await createReadyGoApp();
    try {
      const { claimed, pending } = await createClaimedRowAndReplacement(app, scope.householdId);
      const ackResponse = await app.inject({
        method: 'POST',
        url: '/api/bridge/readygo-ack',
        headers: { 'x-bridge-token': BRIDGE_TOKEN, 'content-type': 'application/json' },
        payload: JSON.stringify({ ids: [claimed.id] }),
      });
      assert.equal(ackResponse.statusCode, 200);
      assert.equal(ackResponse.json<{ notified: number }>().notified, 1);
      assert.equal((await prisma.readyGoOutbox.findUniqueOrThrow({ where: { id: claimed.id } })).status, 'delivered');
      assert.equal((await prisma.readyGoOutbox.findUniqueOrThrow({ where: { id: pending.id } })).status, 'pending');
      assert.equal(
        await prisma.notificationLog.count({ where: { householdId: scope.householdId, itemId: scope.itemId } }),
        1
      );
    } finally {
      await app.close();
      await scope.cleanup();
    }
  });
});

test('pending ReadyGo rows cannot be acknowledged before claim', async () => {
  await withEnv({ BRIDGE_TOKEN }, async () => {
    const scope = await createAlertScope();
    const app = await createReadyGoApp();
    try {
      await runDailyBatch(undefined, { householdId: scope.householdId });
      const pending = await prisma.readyGoOutbox.findFirstOrThrow({
        where: { householdId: scope.householdId, status: 'pending' },
      });
      const ackResponse = await app.inject({
        method: 'POST',
        url: '/api/bridge/readygo-ack',
        headers: { 'x-bridge-token': BRIDGE_TOKEN, 'content-type': 'application/json' },
        payload: JSON.stringify({ ids: [pending.id] }),
      });
      assert.equal(ackResponse.statusCode, 200);
      assert.equal(ackResponse.json<{ notified: number }>().notified, 0);
      assert.equal((await prisma.readyGoOutbox.findUniqueOrThrow({ where: { id: pending.id } })).status, 'pending');
      assert.equal(
        await prisma.notificationLog.count({ where: { householdId: scope.householdId, itemId: scope.itemId } }),
        0
      );
    } finally {
      await app.close();
      await scope.cleanup();
    }
  });
});
