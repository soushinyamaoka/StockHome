// sendTestPushToDevice（B-6）のDB依存テスト。Codexの非対話実行では実行しない。
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';
import { sendTestPushToDevice } from './pushNotify';

let scopeCounter = 0;
async function createDeviceScope(overrides: { isActive?: boolean } = {}) {
  const tag = `${Date.now()}-${++scopeCounter}`;
  const household = await prisma.household.create({ data: { name: `push-test-send-${tag}` } });
  const user = await prisma.user.create({ data: { email: `push-test-send-${tag}@example.invalid`, name: 'テスト太郎', passwordHash: 'x' } });
  const expoPushToken = `ExponentPushToken[test-send-${tag}]`;
  const device = await prisma.pushDevice.create({ data: { householdId: household.id, userId: user.id, expoPushToken, platform: 'android', isActive: overrides.isActive ?? true } });
  return { householdId: household.id, userId: user.id, expoPushToken, deviceId: device.id, cleanup: async () => { await prisma.household.delete({ where: { id: household.id } }); await prisma.user.delete({ where: { id: user.id } }); } };
}
function stubFetchOnce(response: { status: number; body: unknown }) {
  const originalFetch = globalThis.fetch; let capturedBody: unknown;
  (globalThis as any).fetch = async (_url: unknown, init: { body: string }) => { capturedBody = JSON.parse(init.body); return new Response(JSON.stringify(response.body), { status: response.status }); };
  return { getCapturedBody: () => capturedBody, restore: () => { (globalThis as any).fetch = originalFetch; } };
}
test('成功時: ok:trueを返し、lastPushAtが更新され、ticketが記録される', async () => {
  const scope = await createDeviceScope(); const stub = stubFetchOnce({ status: 200, body: { data: [{ status: 'ok', id: 'ticket-test-send-1' }] } });
  try { assert.deepEqual(await sendTestPushToDevice(scope.expoPushToken, scope.householdId, scope.userId), { ok: true }); const body: any = stub.getCapturedBody(); assert.equal(body.length, 1); assert.equal(body[0].to, scope.expoPushToken); assert.equal(body[0].title, 'StockHome'); const device = await prisma.pushDevice.findUniqueOrThrow({ where: { id: scope.deviceId } }); assert.ok(device.lastPushAt); assert.equal(device.isActive, true); const ticket = await prisma.pushTicket.findUnique({ where: { expoTicketId: 'ticket-test-send-1' } }); assert.equal(ticket?.pushDeviceId, scope.deviceId); } finally { stub.restore(); await scope.cleanup(); }
});
test('存在しないtoken・他世帯の端末はnullを返す（呼び出し元で404化する）', async () => {
  const scope = await createDeviceScope(); const stub = stubFetchOnce({ status: 200, body: { data: [{ status: 'ok', id: 'unused' }] } });
  try { assert.equal(await sendTestPushToDevice('ExponentPushToken[does-not-exist]', scope.householdId, scope.userId), null); assert.equal(await sendTestPushToDevice(scope.expoPushToken, 'not-this-household-id', scope.userId), null); assert.equal(stub.getCapturedBody(), undefined); } finally { stub.restore(); await scope.cleanup(); }
});
test('DeviceNotRegistered: ok:falseかつreason:device_not_registeredを返し、端末をisActive:falseにする', async () => {
  const scope = await createDeviceScope(); const stub = stubFetchOnce({ status: 200, body: { data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] } });
  try { assert.deepEqual(await sendTestPushToDevice(scope.expoPushToken, scope.householdId, scope.userId), { ok: false, reason: 'device_not_registered' }); assert.equal((await prisma.pushDevice.findUniqueOrThrow({ where: { id: scope.deviceId } })).isActive, false); } finally { stub.restore(); await scope.cleanup(); }
});
test('Expo API自体が失敗（4xx、リトライなし）: ok:falseかつreason:send_failedを返す', async () => {
  const scope = await createDeviceScope(); const stub = stubFetchOnce({ status: 400, body: { errors: [{ message: 'synthetic failure' }] } });
  try { assert.deepEqual(await sendTestPushToDevice(scope.expoPushToken, scope.householdId, scope.userId), { ok: false, reason: 'send_failed' }); assert.equal((await prisma.pushDevice.findUniqueOrThrow({ where: { id: scope.deviceId } })).lastPushAt, null); } finally { stub.restore(); await scope.cleanup(); }
});
test('無効化済み(isActive:false)の端末へ成功送信すると、isActive:trueへ復帰する', async () => {
  const scope = await createDeviceScope({ isActive: false }); const stub = stubFetchOnce({ status: 200, body: { data: [{ status: 'ok', id: 'ticket-reactivate-1' }] } });
  try { assert.deepEqual(await sendTestPushToDevice(scope.expoPushToken, scope.householdId, scope.userId), { ok: true }); assert.equal((await prisma.pushDevice.findUniqueOrThrow({ where: { id: scope.deviceId } })).isActive, true); } finally { stub.restore(); await scope.cleanup(); }
});

// ---- cooldown（S020-B01: VPS管理レビューでサーバー側の連打防止が無いと指摘） ----

function stubFetchCounting(response: { status: number; body: unknown }) {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  (globalThis as any).fetch = async () => {
    callCount += 1;
    return new Response(JSON.stringify(response.body), { status: response.status });
  };
  return {
    getCallCount: () => callCount,
    restore: () => {
      (globalThis as any).fetch = originalFetch;
    },
  };
}

test('制限超過: 直後の2回目はExpoへ到達せずrate_limitedを返す', async () => {
  const scope = await createDeviceScope();
  const stub = stubFetchCounting({ status: 200, body: { data: [{ status: 'ok', id: 'cooldown-1' }] } });
  try {
    const first = await sendTestPushToDevice(scope.expoPushToken, scope.householdId, scope.userId);
    assert.deepEqual(first, { ok: true });
    assert.equal(stub.getCallCount(), 1);

    const second = await sendTestPushToDevice(scope.expoPushToken, scope.householdId, scope.userId);
    assert.equal(second?.ok, false);
    assert.equal(second?.reason, 'rate_limited');
    assert.ok(typeof second?.retryAfterSeconds === 'number' && second.retryAfterSeconds > 0);
    // cooldownで弾かれたため、2回目はExpoへの呼び出しが増えていない
    assert.equal(stub.getCallCount(), 1);
  } finally {
    stub.restore();
    await scope.cleanup();
  }
});

test('時間経過後: cooldown期間を過ぎていれば再送できる', async () => {
  const scope = await createDeviceScope();
  const stub = stubFetchCounting({ status: 200, body: { data: [{ status: 'ok', id: 'cooldown-2' }] } });
  try {
    // cooldownウィンドウ（30秒）よりも十分古いlastTestSentAtを直接設定し、
    // 実際に待たずに「時間経過後」の状態を再現する
    await prisma.pushDevice.update({
      where: { id: scope.deviceId },
      data: { lastTestSentAt: new Date(Date.now() - 60_000) },
    });

    const result = await sendTestPushToDevice(scope.expoPushToken, scope.householdId, scope.userId);
    assert.deepEqual(result, { ok: true });
    assert.equal(stub.getCallCount(), 1);
  } finally {
    stub.restore();
    await scope.cleanup();
  }
});

test('並行実行: 同時に2回呼んでも成功するのはちょうど1回、負けた方のRetry-Afterはcooldown満了に近い値', async () => {
  const scope = await createDeviceScope();
  const stub = stubFetchCounting({ status: 200, body: { data: [{ status: 'ok', id: 'cooldown-3' }] } });
  try {
    const [a, b] = await Promise.all([
      sendTestPushToDevice(scope.expoPushToken, scope.householdId, scope.userId),
      sendTestPushToDevice(scope.expoPushToken, scope.householdId, scope.userId),
    ]);
    const results = [a, b];
    const succeeded = results.filter((r) => r?.ok === true);
    const rateLimited = results.filter((r) => r?.ok === false && r?.reason === 'rate_limited');
    assert.equal(succeeded.length, 1, `expected exactly 1 success, got ${JSON.stringify(results)}`);
    assert.equal(rateLimited.length, 1, `expected exactly 1 rate_limited, got ${JSON.stringify(results)}`);
    // Expoへ実際に到達したのも1回だけ
    assert.equal(stub.getCallCount(), 1);
    // S020-B02: claimに負けた側は、呼び出し開始時点の古いスナップショット
    // （lastTestSentAtがまだnullのまま）ではなく、勝った側が書き込んだ最新値を
    // 再取得してから計算すること。古い値のまま計算すると不当に小さい値
    // （このcooldown設定では1）になる
    const retryAfterSeconds = rateLimited[0]?.retryAfterSeconds ?? 0;
    assert.ok(
      retryAfterSeconds >= 25,
      `expected retryAfterSeconds close to the full 30s cooldown, got ${retryAfterSeconds}`
    );
  } finally {
    stub.restore();
    await scope.cleanup();
  }
});

test('claimに負けた場合、呼び出し開始時点の古いスナップショットではなく再取得した現在値からRetry-Afterを計算する（決定的再現）', async () => {
  // 上の「並行実行」testは実DB上の真の並行アクセスに依存するため、
  // このスナップショット鮮度バグ自体は再現したりしなかったりする
  // （ローカルPostgresのクエリが速すぎて、2つのfindFirstが実際には
  // 重ならないことが多い。実測で8/8回、修正前コードでも偶然パスした）。
  // このtestはfindFirstだけを差し替え、「呼び出し開始時点ではまだ
  // claimされていなかった（lastTestSentAt: null）」という古いスナップショットを
  // 強制的に返しつつ、実際のDB行は既に2秒前に別のrequestがclaim済みという
  // 状況を作ることで、並行アクセスのタイミングに依存せず確実に再現する
  // （S020-B02: VPS管理レビューで、この再取得漏れによりRetry-After: 1を
  // 返す不具合を指摘された）。
  const scope = await createDeviceScope();
  const stub = stubFetchCounting({ status: 200, body: { data: [{ status: 'ok', id: 'cooldown-stale' }] } });
  const originalFindFirst = prisma.pushDevice.findFirst.bind(prisma.pushDevice);
  try {
    // 実際のDB行: 2秒前に別のrequestがclaim済み（cooldown中、残り約28秒）
    const recentClaim = new Date(Date.now() - 2000);
    await prisma.pushDevice.update({ where: { id: scope.deviceId }, data: { lastTestSentAt: recentClaim } });

    // findFirstだけ、呼び出し元には「まだclaimされていなかった」古いスナップショット
    // （lastTestSentAt: null）を返すよう差し替える。updateMany等、他のクエリは
    // 実際のDB状態のまま（cooldown中なのでclaimは必ず失敗しcount:0になる）
    (prisma.pushDevice as any).findFirst = async (...args: unknown[]) => {
      const real = await originalFindFirst(...(args as Parameters<typeof originalFindFirst>));
      return real ? { ...real, lastTestSentAt: null } : real;
    };

    const result = await sendTestPushToDevice(scope.expoPushToken, scope.householdId, scope.userId);
    assert.equal(result?.ok, false);
    assert.equal(result?.reason, 'rate_limited');
    // 実際の残り時間（約28秒）に近い値であること。呼び出し開始時点の
    // 古いスナップショット（null）のまま計算すると1になってしまう
    assert.ok(
      (result?.retryAfterSeconds ?? 0) >= 25,
      `expected retryAfterSeconds close to the actual remaining ~28s cooldown, got ${result?.retryAfterSeconds}`
    );
    // Expoへは到達しない（claimに失敗しているため）
    assert.equal(stub.getCallCount(), 0);
  } finally {
    (prisma.pushDevice as any).findFirst = originalFindFirst;
    stub.restore();
    await scope.cleanup();
  }
});
