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
