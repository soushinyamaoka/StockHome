// sendPushToUserが構築するExpo Push payload（単一/複数品目時のdataフィールド）を
// 検証するDB依存テスト（VPS管理レビュー指摘対応）。
// ローカルDocker Postgres（DATABASE_URL、apps/api/.env）に対して実行する。
// Codexの非対話実行ではDBへ接続せず、Claudeの対話セッションで別途実行する。
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';
import { sendPushToUser } from './pushNotify';

let scopeCounter = 0;

interface DeviceScope {
  householdId: string;
  userId: string;
  cleanup: () => Promise<void>;
}

async function createDeviceScope(): Promise<DeviceScope> {
  scopeCounter += 1;
  const tag = `${Date.now()}-${scopeCounter}`;
  const household = await prisma.household.create({
    data: { name: `push-payload-${tag}` },
  });
  const user = await prisma.user.create({
    data: { email: `push-payload-${tag}@example.invalid`, name: 'テスト太郎', passwordHash: 'x' },
  });
  await prisma.pushDevice.create({
    data: {
      householdId: household.id,
      userId: user.id,
      expoPushToken: `ExponentPushToken[payload-${tag}]`,
      platform: 'android',
    },
  });

  return {
    householdId: household.id,
    userId: user.id,
    cleanup: async () => {
      await prisma.household.delete({ where: { id: household.id } });
      await prisma.user.delete({ where: { id: user.id } });
    },
  };
}

// global.fetchを差し替え、実際にはExpo Push APIへ接続せず送信bodyだけを捕捉する
function stubFetchOnce(): { getCapturedBody: () => any; restore: () => void } {
  const originalFetch = globalThis.fetch;
  let capturedBody: unknown;
  (globalThis as any).fetch = async (_url: unknown, init: { body: string }) => {
    capturedBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ data: [{ status: 'ok', id: 'ticket-test' }] }), {
      status: 200,
    });
  };
  return {
    getCapturedBody: () => capturedBody,
    restore: () => {
      (globalThis as any).fetch = originalFetch;
    },
  };
}

test('単一品目のアラートはExpo Push payloadにdata.itemIdを含める', async () => {
  const scope = await createDeviceScope();
  const stub = stubFetchOnce();
  try {
    const result = await sendPushToUser(
      scope.householdId,
      scope.userId,
      'そろそろ切れそう（1件）',
      'トイレットペーパー',
      { itemId: 'item-single-1' }
    );
    assert.equal(result.targeted, 1);
    assert.equal(result.accepted, 1);

    const body = stub.getCapturedBody();
    assert.equal(body.length, 1);
    assert.deepEqual(body[0].data, { itemId: 'item-single-1' });
    assert.equal(body[0].title, 'そろそろ切れそう（1件）');
  } finally {
    stub.restore();
    await scope.cleanup();
  }
});

test('複数品目のアラートはExpo Push payloadにdataフィールドを含めない', async () => {
  const scope = await createDeviceScope();
  const stub = stubFetchOnce();
  try {
    const result = await sendPushToUser(
      scope.householdId,
      scope.userId,
      'そろそろ切れそう（2件）',
      'トイレットペーパー\n洗剤',
      undefined
    );
    assert.equal(result.targeted, 1);
    assert.equal(result.accepted, 1);

    const body = stub.getCapturedBody();
    assert.equal(body.length, 1);
    assert.ok(!('data' in body[0]), 'data フィールドが含まれてはいけない');
    assert.equal(body[0].title, 'そろそろ切れそう（2件）');
  } finally {
    stub.restore();
    await scope.cleanup();
  }
});
