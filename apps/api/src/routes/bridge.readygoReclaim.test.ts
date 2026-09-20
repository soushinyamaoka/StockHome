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
  const household = await prisma.household.create({ data: { name: `readygo-reclaim-household-${tag}` } });
  const user = await prisma.user.create({
    data: { email: `readygo-reclaim-${tag}@example.invalid`, name: 'ReadyGo reclaim test user', passwordHash: 'x' },
  });
  await prisma.householdMember.create({ data: { householdId: household.id, userId: user.id, role: 'admin' } });
  await prisma.item.create({
    data: {
      householdId: household.id,
      itemName: `readygo-reclaim-item-${tag}`,
      daysPerUnit: 1,
      defaultPurchaseQty: 1,
      leadDays: 1,
      runtimeState: { create: { householdId: household.id, manualOverrideQty: 0, manualOverrideAt: new Date() } },
    },
  });
  return {
    householdId: household.id,
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

async function createOutboxRow(householdId: string, status: 'pending' | 'claimed', claimedAt?: Date) {
  return prisma.readyGoOutbox.create({
    data: { householdId, body: 'ReadyGo reclaim test', alertsJson: [], status, ...(claimedAt ? { claimedAt } : {}) },
  });
}

test('stale claimed row is reclaimed and claimed again in the same GET response', async () => {
  await withEnv({ BRIDGE_TOKEN }, async () => {
    const scope = await createAlertScope();
    const app = await createReadyGoApp();
    try {
      const staleClaimedAt = new Date(Date.now() - 31 * 60 * 1000);
      const stale = await createOutboxRow(scope.householdId, 'claimed', staleClaimedAt);
      const response = await app.inject({
        method: 'GET',
        url: '/api/bridge/readygo-pending',
        headers: { 'x-bridge-token': BRIDGE_TOKEN },
      });
      assert.equal(response.statusCode, 200);
      const reclaimed = await prisma.readyGoOutbox.findUniqueOrThrow({ where: { id: stale.id } });
      assert.equal(reclaimed.status, 'claimed');
      assert.ok(reclaimed.claimedAt && reclaimed.claimedAt > staleClaimedAt);
      assert.ok(response.json<{ pending: { id: string }[] }>().pending.some((row) => row.id === stale.id));
    } finally {
      await app.close();
      await scope.cleanup();
    }
  });
});

test('stale claimed row is deleted when a fresh pending row supersedes it', async () => {
  await withEnv({ BRIDGE_TOKEN }, async () => {
    const scope = await createAlertScope();
    const app = await createReadyGoApp();
    try {
      const stale = await createOutboxRow(scope.householdId, 'claimed', new Date(Date.now() - 31 * 60 * 1000));
      const fresh = await createOutboxRow(scope.householdId, 'pending');
      const response = await app.inject({
        method: 'GET',
        url: '/api/bridge/readygo-pending',
        headers: { 'x-bridge-token': BRIDGE_TOKEN },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(await prisma.readyGoOutbox.findUnique({ where: { id: stale.id } }), null);
      assert.equal((await prisma.readyGoOutbox.findUniqueOrThrow({ where: { id: fresh.id } })).status, 'claimed');
      const ids = response.json<{ pending: { id: string }[] }>().pending.map((row) => row.id);
      assert.ok(ids.includes(fresh.id));
      assert.ok(!ids.includes(stale.id));
    } finally {
      await app.close();
      await scope.cleanup();
    }
  });
});

test('claimed row within the lease remains unchanged and is not returned', async () => {
  await withEnv({ BRIDGE_TOKEN }, async () => {
    const scope = await createAlertScope();
    const app = await createReadyGoApp();
    try {
      const claimedAt = new Date();
      const claimed = await createOutboxRow(scope.householdId, 'claimed', claimedAt);
      const response = await app.inject({
        method: 'GET',
        url: '/api/bridge/readygo-pending',
        headers: { 'x-bridge-token': BRIDGE_TOKEN },
      });
      assert.equal(response.statusCode, 200);
      const unchanged = await prisma.readyGoOutbox.findUniqueOrThrow({ where: { id: claimed.id } });
      assert.equal(unchanged.status, 'claimed');
      assert.equal(unchanged.claimedAt?.getTime(), claimedAt.getTime());
      assert.ok(!response.json<{ pending: { id: string }[] }>().pending.some((row) => row.id === claimed.id));
    } finally {
      await app.close();
      await scope.cleanup();
    }
  });
});

test('reclaim survives a daily_batch insert landing concurrently for the same household (S014-B06)', async () => {
  // Pre-fix, the reclaim step was a single blind updateMany across all stale claimed
  // rows with no conflict handling. When a concurrent daily_batch insert for the same
  // household committed a fresh pending row between the reclaim's row scan and its
  // UPDATE, the UPDATE hit the pending partial-unique-index and threw an unhandled
  // P2002, crashing the whole GET (verified locally: 9/10 iterations of this exact
  // race threw with the old code, 0/20 with the fixed per-row catch-and-fallback).
  // Run several iterations with real Promise.all concurrency (not pre-seeded data) to
  // reliably reproduce the interleaving rather than relying on a single lucky race.
  await withEnv({ BRIDGE_TOKEN }, async () => {
    for (let i = 0; i < 5; i++) {
      const scope = await createAlertScope();
      const app = await createReadyGoApp();
      try {
        await createOutboxRow(scope.householdId, 'claimed', new Date(Date.now() - 31 * 60 * 1000));
        const [response] = await Promise.all([
          app.inject({
            method: 'GET',
            url: '/api/bridge/readygo-pending',
            headers: { 'x-bridge-token': BRIDGE_TOKEN },
          }),
          runDailyBatch(undefined, { householdId: scope.householdId }),
        ]);
        assert.equal(response.statusCode, 200);
        const pendingCount = await prisma.readyGoOutbox.count({
          where: { householdId: scope.householdId, status: 'pending' },
        });
        assert.ok(pendingCount <= 1, `expected at most 1 pending row, got ${pendingCount}`);
      } finally {
        await app.close();
        await scope.cleanup();
      }
    }
  });
});
