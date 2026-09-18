// 購入履歴編集と取込候補取消のcross-route同時実行テスト。
// ローカルDocker Postgres（DATABASE_URL、apps/api/.env）に対して実行する。
// Codexの非対話実行ではDBへ接続せず、Claudeの対話セッションで別途実行する。
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import authPlugin from '../plugins/auth';
import { prisma } from '../lib/prisma';
import importCandidateRoutes from './importCandidates';
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
    await instance.register(importCandidateRoutes, { prefix: '/api/import-candidates' });
  });
  await app.ready();
  return app;
}

let scopeCounter = 0;

async function createTestScope() {
  scopeCounter += 1;
  const tag = `${Date.now()}-${scopeCounter}`;
  const household = await prisma.household.create({
    data: { name: `purchase-unconfirm-concurrency-${tag}` },
  });
  const user = await prisma.user.create({
    data: {
      email: `purchase-unconfirm-concurrency-${tag}@example.invalid`,
      name: '利用者',
      passwordHash: 'test-only',
    },
  });
  await prisma.householdMember.create({
    data: { householdId: household.id, userId: user.id, role: 'admin' },
  });

  return {
    tag,
    householdId: household.id,
    user,
    cleanup: async () => {
      await prisma.household.delete({ where: { id: household.id } });
      await prisma.user.delete({ where: { id: user.id } });
    },
  };
}

async function setAccumulatedState(itemId: string, qty: number) {
  return prisma.itemRuntimeState.update({
    where: { itemId },
    data: {
      manualOverrideQty: qty,
      manualOverrideAt: new Date('2026-09-02T03:00:00.000Z'),
      manualOverrideReason: 'purchase_accumulated',
    },
  });
}

function bearerToken(app: Awaited<ReturnType<typeof buildAuthedApp>>, userId: string) {
  return { authorization: `Bearer ${app.jwt.sign({ userId })}` };
}

test('同一購入への同時PATCHとunconfirmはdeadlockせず購入を削除して積み上げを8に収束させる', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const item = await prisma.item.create({
      data: {
        householdId: scope.householdId,
        itemName: `purchase-unconfirm-concurrency-item-${scope.tag}`,
        daysPerUnit: 10,
        defaultPurchaseQty: 1,
        runtimeState: { create: { householdId: scope.householdId } },
      },
    });
    const candidate = await prisma.importOrderCandidate.create({
      data: {
        householdId: scope.householdId,
        vendor: 'amazon',
        mailMessageId: `purchase-unconfirm-concurrency-${scope.tag}`,
        importedByEmail: scope.user.email,
        mailDate: new Date('2026-09-01T00:00:00.000Z'),
        mailType: 'order_confirm',
        mailPhase: 'shipped',
        itemNameRaw: `purchase-unconfirm-concurrency-${scope.tag}`,
        detectedQty: 2,
        candidateStatus: 'confirmed',
        matchedItemId: item.id,
      },
    });
    const purchase = await prisma.purchaseLog.create({
      data: {
        householdId: scope.householdId,
        itemId: item.id,
        purchasedAt: new Date('2026-09-01T00:00:00.000Z'),
        qty: 2,
        source: 'gmail',
        sourceType: 'gmail_auto',
        importCandidateId: candidate.id,
        fulfillmentStatus: 'shipped',
        inventoryEffectiveAt: new Date('2026-09-01T00:00:00.000Z'),
        countedInInventory: true,
      },
    });
    await setAccumulatedState(item.id, 10);
    const headers = bearerToken(app, scope.user.id);

    const [patchResponse, unconfirmResponse] = await Promise.all([
      app.inject({
        method: 'PATCH',
        url: `/api/purchases/${purchase.id}`,
        headers,
        payload: { qty: 5 },
      }),
      app.inject({
        method: 'POST',
        url: `/api/import-candidates/${candidate.id}/unconfirm`,
        headers,
      }),
    ]);

    assert.ok(patchResponse.statusCode === 200 || patchResponse.statusCode === 404);
    assert.equal(unconfirmResponse.statusCode, 200);
    assert.equal(await prisma.purchaseLog.findUnique({ where: { id: purchase.id } }), null);

    const finalCandidate = await prisma.importOrderCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    assert.equal(finalCandidate.candidateStatus, 'detected');
    assert.equal(finalCandidate.matchedItemId, null);
    assert.equal(
      (await prisma.itemRuntimeState.findUniqueOrThrow({ where: { itemId: item.id } })).manualOverrideQty,
      8
    );
  } finally {
    await app.close();
    await scope.cleanup();
  }
});
