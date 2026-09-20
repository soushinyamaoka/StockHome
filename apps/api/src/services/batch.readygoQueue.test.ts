import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prisma } from '../lib/prisma';
import { runDailyBatch } from './batch';

let scopeCounter = 0;

interface TestScope {
  householdId: string;
  userId: string;
  itemId: string;
  cleanup: () => Promise<void>;
}

async function createAlertScope(): Promise<TestScope> {
  const tag = `${Date.now()}-${++scopeCounter}`;
  const household = await prisma.household.create({ data: { name: `readygo-test-household-${tag}` } });
  const user = await prisma.user.create({
    data: { email: `readygo-test-${tag}@example.invalid`, name: 'ReadyGo test user', passwordHash: 'x' },
  });
  await prisma.householdMember.create({
    data: { householdId: household.id, userId: user.id, role: 'admin' },
  });
  const item = await prisma.item.create({
    data: {
      householdId: household.id,
      itemName: `readygo-test-item-${tag}`,
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
    userId: user.id,
    itemId: item.id,
    cleanup: async () => {
      await prisma.household.delete({ where: { id: household.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    },
  };
}

async function createOutboxRow(scope: TestScope, status: 'pending' | 'delivered', deliveredAt?: Date) {
  return prisma.readyGoOutbox.create({
    data: {
      householdId: scope.householdId,
      body: 'test',
      alertsJson: [],
      status,
      ...(deliveredAt ? { deliveredAt } : {}),
    },
  });
}

test('manual batch replaces pending ReadyGo queue rows', async () => {
  const scope = await createAlertScope();
  try {
    await runDailyBatch(undefined, { householdId: scope.householdId });
    const second = await runDailyBatch(undefined, { householdId: scope.householdId });
    assert.equal(
      await prisma.readyGoOutbox.count({ where: { householdId: scope.householdId, status: 'pending' } }),
      1
    );
    assert.equal(second.readygoSuperseded, 1);
  } finally {
    await scope.cleanup();
  }
});

test('cron batch also replaces pending ReadyGo queue rows', async () => {
  const scope = await createAlertScope();
  try {
    await createOutboxRow(scope, 'pending');
    const result = await runDailyBatch();
    assert.equal(
      await prisma.readyGoOutbox.count({ where: { householdId: scope.householdId, status: 'pending' } }),
      1
    );
    assert.ok(result.readygoSuperseded >= 1);
  } finally {
    await scope.cleanup();
  }
});

test('manual batch scopes ReadyGo queueing to its household', async () => {
  const first = await createAlertScope();
  const second = await createAlertScope();
  try {
    await runDailyBatch(undefined, { householdId: first.householdId });
    assert.equal(
      await prisma.readyGoOutbox.count({ where: { householdId: first.householdId, status: 'pending' } }),
      1
    );
    assert.equal(
      await prisma.readyGoOutbox.count({ where: { householdId: second.householdId, status: 'pending' } }),
      0
    );
  } finally {
    await first.cleanup();
    await second.cleanup();
  }
});

test('cron cleans delivered rows older than 30 days while manual batch retains them', async () => {
  const scope = await createAlertScope();
  try {
    const oldRow = await createOutboxRow(scope, 'delivered', new Date(Date.now() - 31 * 24 * 60 * 60 * 1000));
    const recentRow = await createOutboxRow(scope, 'delivered', new Date(Date.now() - 24 * 60 * 60 * 1000));
    await runDailyBatch(undefined, { householdId: scope.householdId });
    assert.ok(await prisma.readyGoOutbox.findUnique({ where: { id: oldRow.id } }));
    assert.ok(await prisma.readyGoOutbox.findUnique({ where: { id: recentRow.id } }));

    await runDailyBatch();
    assert.equal(await prisma.readyGoOutbox.findUnique({ where: { id: oldRow.id } }), null);
    assert.ok(await prisma.readyGoOutbox.findUnique({ where: { id: recentRow.id } }));
  } finally {
    await scope.cleanup();
  }
});

test('batch reports pending ReadyGo queue age', async () => {
  const scope = await createAlertScope();
  try {
    await createOutboxRow(scope, 'pending');
    const result = await runDailyBatch(undefined, { householdId: scope.householdId });
    assert.ok(result.readygoPending >= 1);
    assert.notEqual(result.readygoPendingOldestAgeHours, null);
  } finally {
    await scope.cleanup();
  }
});
