// 外部連携用トークン（/api/api-tokens と、トークンでの認証）のDB依存HTTPテスト。Codexの非対話実行では実行しない。
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import authPlugin from '../plugins/auth';
import { prisma } from '../lib/prisma';
import apiTokenRoutes from './apiTokens';
import storageRoutes from './storage';
import userRoutes from './users';

async function buildAuthedApp() {
  const app = Fastify();
  await app.register(authPlugin);
  await app.register(async (instance) => {
    instance.addHook('preHandler', instance.authenticate);
    await instance.register(userRoutes, { prefix: '/api/users' });
    await instance.register(storageRoutes, { prefix: '/api/storage' });
    await instance.register(apiTokenRoutes, { prefix: '/api/api-tokens' });
  });
  await app.ready();
  return app;
}
type App = Awaited<ReturnType<typeof buildAuthedApp>>;

const jwtHeader = (app: App, userId: string) => ({ authorization: `Bearer ${app.jwt.sign({ userId })}` });
const tokenHeader = (token: string) => ({ authorization: `Bearer ${token}` });

let scopeCounter = 0;
async function createScope() {
  const tag = `${Date.now()}-${++scopeCounter}`;
  const household = await prisma.household.create({ data: { name: `api-token-${tag}` } });
  const admin = await prisma.user.create({
    data: { email: `api-token-admin-${tag}@example.invalid`, name: 'Admin', passwordHash: 'test-only' },
  });
  const member = await prisma.user.create({
    data: { email: `api-token-member-${tag}@example.invalid`, name: 'Member', passwordHash: 'test-only' },
  });
  await prisma.householdMember.createMany({
    data: [
      { householdId: household.id, userId: admin.id, role: 'admin' },
      { householdId: household.id, userId: member.id, role: 'member' },
    ],
  });
  return {
    household,
    admin,
    member,
    cleanup: async () => {
      await prisma.household.deleteMany({ where: { id: household.id } });
      await prisma.user.deleteMany({ where: { id: { in: [admin.id, member.id] } } });
    },
  };
}
type Scope = Awaited<ReturnType<typeof createScope>>;

async function withScope(run: (app: App, scope: Scope) => Promise<void>) {
  const scope = await createScope();
  const app = await buildAuthedApp();
  try {
    await run(app, scope);
  } finally {
    await app.close();
    await scope.cleanup();
  }
}

async function issue(app: App, userId: string, payload: Record<string, unknown> = { name: 'Muse' }) {
  const res = await app.inject({ method: 'POST', url: '/api/api-tokens', headers: jwtHeader(app, userId), payload });
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as { token: string; apiToken: { id: string; tokenPrefix: string; allowWrite: boolean } };
}

test('発行したトークンで参照でき、DBにはトークン本体を保存しない', () =>
  withScope(async (app, { admin }) => {
    const { token, apiToken } = await issue(app, admin.id);
    assert.match(token, /^shk_[A-Za-z0-9_-]{43}$/);
    assert.equal(apiToken.allowWrite, false);
    assert.ok(token.startsWith(apiToken.tokenPrefix));

    const row = await prisma.apiToken.findUniqueOrThrow({ where: { id: apiToken.id } });
    assert.notEqual(row.tokenHash, token);
    assert.ok(!row.tokenHash.includes(token.slice(4)));

    const res = await app.inject({ method: 'GET', url: '/api/storage/search', headers: tokenHeader(token) });
    assert.equal(res.statusCode, 200);
    // 最終利用日時は応答を待たずに記録するので、少し待ってから確かめる
    await new Promise((r) => setTimeout(r, 200));
    const used = await prisma.apiToken.findUniqueOrThrow({ where: { id: apiToken.id } });
    assert.ok(used.lastUsedAt);
  }));

test('読み取り専用のトークンは書き込みを拒否し、許可に切り替えると書き込める', () =>
  withScope(async (app, { admin }) => {
    const { token, apiToken } = await issue(app, admin.id);
    const create = () =>
      app.inject({
        method: 'POST',
        url: '/api/storage/locations',
        headers: tokenHeader(token),
        payload: { name: `棚-${apiToken.id}` },
      });

    assert.equal((await create()).statusCode, 403);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/api-tokens/${apiToken.id}`,
      headers: jwtHeader(app, admin.id),
      payload: { allowWrite: true },
    });
    assert.equal(patch.statusCode, 200);
    assert.equal(patch.json().apiToken.allowWrite, true);
    assert.equal((await create()).statusCode, 201);
  }));

test('書き込みを許可したトークンでも、トークン管理と家族メンバーの変更はできない', () =>
  withScope(async (app, { admin }) => {
    const { token } = await issue(app, admin.id, { name: 'Muse', allowWrite: true });
    const list = await app.inject({ method: 'GET', url: '/api/api-tokens', headers: tokenHeader(token) });
    assert.equal(list.statusCode, 403);
    const issueByToken = await app.inject({
      method: 'POST',
      url: '/api/api-tokens',
      headers: tokenHeader(token),
      payload: { name: 'x' },
    });
    assert.equal(issueByToken.statusCode, 403);
    const addMember = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: tokenHeader(token),
      payload: { email: `added-${Date.now()}@example.invalid`, name: 'x', password: 'password123' },
    });
    assert.equal(addMember.statusCode, 403);
    // 家族一覧の参照はできる
    const users = await app.inject({ method: 'GET', url: '/api/users', headers: tokenHeader(token) });
    assert.equal(users.statusCode, 200);
  }));

test('取り消したトークン・存在しないトークン・無効化した利用者のトークンは使えない', () =>
  withScope(async (app, { admin, member }) => {
    const { token, apiToken } = await issue(app, admin.id);
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/api-tokens/${apiToken.id}`,
      headers: jwtHeader(app, admin.id),
    });
    assert.equal(del.statusCode, 204);
    const afterRevoke = await app.inject({ method: 'GET', url: '/api/storage/search', headers: tokenHeader(token) });
    assert.equal(afterRevoke.statusCode, 401);

    const unknown = await app.inject({
      method: 'GET',
      url: '/api/storage/search',
      headers: tokenHeader('shk_not-a-real-token'),
    });
    assert.equal(unknown.statusCode, 401);

    const memberToken = await issue(app, member.id);
    await prisma.user.update({ where: { id: member.id }, data: { isActive: false } });
    const disabled = await app.inject({
      method: 'GET',
      url: '/api/storage/search',
      headers: tokenHeader(memberToken.token),
    });
    assert.equal(disabled.statusCode, 403);
  }));

test('メンバーは自分のトークンだけ、管理者は家族全員のトークンを見て操作できる', () =>
  withScope(async (app, { admin, member }) => {
    const adminToken = await issue(app, admin.id, { name: 'あなたのMuse' });
    const memberToken = await issue(app, member.id, { name: '妻のMuse' });

    const memberList = await app.inject({ method: 'GET', url: '/api/api-tokens', headers: jwtHeader(app, member.id) });
    assert.deepEqual(
      memberList.json().tokens.map((t: { id: string }) => t.id),
      [memberToken.apiToken.id]
    );
    const adminList = await app.inject({ method: 'GET', url: '/api/api-tokens', headers: jwtHeader(app, admin.id) });
    const adminView = adminList.json().tokens as { id: string; isMine: boolean; owner: { name: string } }[];
    assert.deepEqual(
      adminView.map((t) => [t.id, t.isMine, t.owner.name]),
      [
        [adminToken.apiToken.id, true, 'Admin'],
        [memberToken.apiToken.id, false, 'Member'],
      ]
    );

    const memberRevokesAdmin = await app.inject({
      method: 'DELETE',
      url: `/api/api-tokens/${adminToken.apiToken.id}`,
      headers: jwtHeader(app, member.id),
    });
    assert.equal(memberRevokesAdmin.statusCode, 404);
    const adminRevokesMember = await app.inject({
      method: 'DELETE',
      url: `/api/api-tokens/${memberToken.apiToken.id}`,
      headers: jwtHeader(app, admin.id),
    });
    assert.equal(adminRevokesMember.statusCode, 204);
  }));

test('トークンでの書き込みは発行した本人の家庭に対して行われる', () =>
  withScope(async (app, { member, household }) => {
    const { token } = await issue(app, member.id, { name: '妻のMuse', allowWrite: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/storage/locations',
      headers: tokenHeader(token),
      payload: { name: '物置' },
    });
    assert.equal(res.statusCode, 201);
    const loc = await prisma.storageLocation.findFirst({ where: { name: '物置', householdId: household.id } });
    assert.ok(loc);
  }));

test('1人が持てる有効なトークンは10個まで', () =>
  withScope(async (app, { member }) => {
    for (let i = 0; i < 10; i++) await issue(app, member.id, { name: `t${i}` });
    const res = await app.inject({
      method: 'POST',
      url: '/api/api-tokens',
      headers: jwtHeader(app, member.id),
      payload: { name: 'over' },
    });
    assert.equal(res.statusCode, 409);
  }));
