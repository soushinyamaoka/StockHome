// GET /api/push-devices・POST /api/push-devices/test のDB依存HTTPテスト。Codexの非対話実行では実行しない。
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import authPlugin from '../plugins/auth';
import { prisma } from '../lib/prisma';
import pushDeviceRoutes from './pushDevices';
function buildApp() { const app = Fastify(); app.removeContentTypeParser('application/json'); app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => { try { done(null, (body as string).trim() === '' ? {} : JSON.parse(body as string)); } catch (err) { done(err as Error, undefined); } }); return app; }
async function buildAuthedApp() { const app = buildApp(); await app.register(authPlugin); await app.register(async (instance) => { instance.addHook('preHandler', instance.authenticate); await instance.register(pushDeviceRoutes, { prefix: '/api/push-devices' }); }); await app.ready(); return app; }
function bearerToken(app: Awaited<ReturnType<typeof buildAuthedApp>>, userId: string) { return { authorization: `Bearer ${app.jwt.sign({ userId })}` }; }
function stubFetchOnce(response: { status: number; body: unknown }) { const originalFetch = globalThis.fetch; (globalThis as any).fetch = async () => new Response(JSON.stringify(response.body), { status: response.status }); return { restore: () => { (globalThis as any).fetch = originalFetch; } }; }
let scopeCounter = 0;
async function createTwoUserScope() {
  const tag = `${Date.now()}-${++scopeCounter}`; const householdA = await prisma.household.create({ data: { name: `push-http-a-${tag}` } }); const householdB = await prisma.household.create({ data: { name: `push-http-b-${tag}` } });
  const userA = await prisma.user.create({ data: { email: `push-http-a-${tag}@example.invalid`, name: 'Push User A', passwordHash: 'test-only' } }); const userA2 = await prisma.user.create({ data: { email: `push-http-a2-${tag}@example.invalid`, name: 'Push User A2', passwordHash: 'test-only' } }); const userB = await prisma.user.create({ data: { email: `push-http-b-${tag}@example.invalid`, name: 'Push User B', passwordHash: 'test-only' } });
  await prisma.householdMember.createMany({ data: [{ householdId: householdA.id, userId: userA.id, role: 'admin' }, { householdId: householdA.id, userId: userA2.id, role: 'member' }, { householdId: householdB.id, userId: userB.id, role: 'admin' }] });
  const deviceA = await prisma.pushDevice.create({ data: { householdId: householdA.id, userId: userA.id, expoPushToken: `ExponentPushToken[http-a-${tag}]`, platform: 'ios' } }); const deviceA2 = await prisma.pushDevice.create({ data: { householdId: householdA.id, userId: userA2.id, expoPushToken: `ExponentPushToken[http-a2-${tag}]`, platform: 'android' } }); const deviceB = await prisma.pushDevice.create({ data: { householdId: householdB.id, userId: userB.id, expoPushToken: `ExponentPushToken[http-b-${tag}]`, platform: 'android' } });
  return { householdA, userA, userA2, userB, deviceA, deviceA2, deviceB, cleanup: async () => { await prisma.household.deleteMany({ where: { id: { in: [householdA.id, householdB.id] } } }); await prisma.user.deleteMany({ where: { id: { in: [userA.id, userA2.id, userB.id] } } }); } };
}
test('GET /api/push-devices は自分の端末だけを返す（同世帯の他ユーザー・他世帯は含まない）', async () => { const scope = await createTwoUserScope(); const app = await buildAuthedApp(); try { const response = await app.inject({ method: 'GET', url: '/api/push-devices', headers: bearerToken(app, scope.userA.id) }); assert.equal(response.statusCode, 200); const devices = response.json().devices as { id: string; platform: string }[]; assert.deepEqual(devices.map((d) => d.id), [scope.deviceA.id]); assert.equal(devices[0].platform, 'ios'); } finally { await app.close(); await scope.cleanup(); } });
test('POST /api/push-devices/test は自分の端末へなら送信し200を返す', async () => { const scope = await createTwoUserScope(); const app = await buildAuthedApp(); const stub = stubFetchOnce({ status: 200, body: { data: [{ status: 'ok', id: `http-ticket-${Date.now()}` }] } }); try { const response = await app.inject({ method: 'POST', url: '/api/push-devices/test', headers: bearerToken(app, scope.userA.id), payload: { expoPushToken: scope.deviceA.expoPushToken } }); assert.equal(response.statusCode, 200); assert.deepEqual(response.json(), { ok: true }); } finally { stub.restore(); await app.close(); await scope.cleanup(); } });
for (const [label, device] of [['他世帯の端末', 'deviceB'], ['同世帯でも別ユーザーの端末', 'deviceA2']] as const) test(`POST /api/push-devices/test は${label}に対して404を返す`, async () => { const scope = await createTwoUserScope(); const app = await buildAuthedApp(); const stub = stubFetchOnce({ status: 200, body: { data: [{ status: 'ok', id: 'unused' }] } }); try { const response = await app.inject({ method: 'POST', url: '/api/push-devices/test', headers: bearerToken(app, scope.userA.id), payload: { expoPushToken: scope[device].expoPushToken } }); assert.equal(response.statusCode, 404); } finally { stub.restore(); await app.close(); await scope.cleanup(); } });

// S020-B01: cooldown中の2回目は429＋Retry-Afterを返す
test('POST /api/push-devices/test はcooldown中の2回目に429とRetry-Afterを返す', async () => {
  const scope = await createTwoUserScope();
  const app = await buildAuthedApp();
  const stub = stubFetchOnce({ status: 200, body: { data: [{ status: 'ok', id: `http-cooldown-${Date.now()}` }] } });
  try {
    const first = await app.inject({
      method: 'POST',
      url: '/api/push-devices/test',
      headers: bearerToken(app, scope.userA.id),
      payload: { expoPushToken: scope.deviceA.expoPushToken },
    });
    assert.equal(first.statusCode, 200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/push-devices/test',
      headers: bearerToken(app, scope.userA.id),
      payload: { expoPushToken: scope.deviceA.expoPushToken },
    });
    assert.equal(second.statusCode, 429);
    assert.ok(second.headers['retry-after']);
    assert.equal(second.json().reason, 'rate_limited');
  } finally {
    stub.restore();
    await app.close();
    await scope.cleanup();
  }
});
