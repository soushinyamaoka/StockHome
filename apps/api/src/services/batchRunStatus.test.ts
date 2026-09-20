import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { prisma } from '../lib/prisma';
import { recordBatchRunStatus, runDailyBatch } from './batch';
import authPlugin from '../plugins/auth';
import dashboardRoutes from '../routes/dashboard';

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

let scopeCounter = 0;

async function createScope() {
  const tag = `${Date.now()}-${++scopeCounter}`;
  const household = await prisma.household.create({ data: { name: `batch-run-status-${tag}` } });
  const user = await prisma.user.create({
    data: { email: `batch-run-status-${tag}@example.invalid`, name: 'Test', passwordHash: 'x' },
  });
  await prisma.householdMember.create({
    data: { householdId: household.id, userId: user.id, role: 'admin' },
  });
  return {
    householdId: household.id,
    userId: user.id,
    cleanup: async () => {
      await prisma.household.delete({ where: { id: household.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    },
  };
}

async function buildDashboardApp() {
  const app = buildApp();
  await app.register(authPlugin);
  await app.register(async (instance) => {
    instance.addHook('preHandler', instance.authenticate);
    await instance.register(dashboardRoutes, { prefix: '/api/dashboard' });
  });
  await app.ready();
  return app;
}

test('recordBatchRunStatus writes success, and dashboard reflects it', async () => {
  const app = await buildDashboardApp();
  const scope = await createScope();
  try {
    const startedAt = Date.now() - 5000;
    await recordBatchRunStatus({ status: 'success', runId: 'test-run-success', startedAt });

    const row = await prisma.batchRunStatus.findUnique({ where: { jobName: 'daily_batch' } });
    assert.ok(row);
    assert.equal(row!.status, 'success');
    assert.equal(row!.errorName, null);

    const token = await app.jwt.sign({ userId: scope.userId });
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard',
      headers: { authorization: `Bearer ${token}` },
    });
    const body = res.json();
    assert.equal(body.lastBatchRun.status, 'success');
    assert.equal(typeof body.lastBatchRun.ageHours, 'number');
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('recordBatchRunStatus writes failure with errorName, and dashboard reflects it', async () => {
  const app = await buildDashboardApp();
  const scope = await createScope();
  try {
    const startedAt = Date.now() - 5000;
    await recordBatchRunStatus({
      status: 'failure',
      runId: 'test-run-failure',
      startedAt,
      failureName: 'Error',
    });

    const row = await prisma.batchRunStatus.findUnique({ where: { jobName: 'daily_batch' } });
    assert.ok(row);
    assert.equal(row!.status, 'failure');
    assert.equal(row!.errorName, 'Error');

    const token = await app.jwt.sign({ userId: scope.userId });
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.json().lastBatchRun.status, 'failure');
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('manual (household-scoped) run does not touch batch_run_status', async () => {
  const sentinelRanAt = new Date(Date.now() - 60 * 60 * 1000);
  await prisma.batchRunStatus.upsert({
    where: { jobName: 'daily_batch' },
    create: { jobName: 'daily_batch', status: 'success', runId: 'sentinel', ranAt: sentinelRanAt, durationMs: 1 },
    update: { status: 'success', runId: 'sentinel', ranAt: sentinelRanAt, durationMs: 1 },
  });
  const scope = await createScope();
  try {
    await runDailyBatch(undefined, { householdId: scope.householdId });
    const row = await prisma.batchRunStatus.findUnique({ where: { jobName: 'daily_batch' } });
    assert.equal(row!.runId, 'sentinel');
  } finally {
    await scope.cleanup();
  }
});
