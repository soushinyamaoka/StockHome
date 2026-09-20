import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import authPlugin from '../plugins/auth';
import { prisma } from '../lib/prisma';
import userRoutes from './users';

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
    await instance.register(userRoutes, { prefix: '/api/users' });
  });
  await app.ready();
  return app;
}

let scopeCounter = 0;

interface TestScope {
  tag: string;
  householdAId: string;
  admin: { id: string; email: string };
  member: { id: string; email: string };
  otherHouseholdAdmin: { id: string; email: string };
  userIds: string[];
  cleanup: () => Promise<void>;
}

async function createTestScope(): Promise<TestScope> {
  scopeCounter += 1;
  const tag = `${Date.now()}-${scopeCounter}`;
  const householdA = await prisma.household.create({ data: { name: `users-http-a-${tag}` } });
  const householdB = await prisma.household.create({ data: { name: `users-http-b-${tag}` } });
  const admin = await prisma.user.create({
    data: { email: `users-http-admin-${tag}@example.invalid`, name: 'Test Admin', passwordHash: 'test-only' },
  });
  const member = await prisma.user.create({
    data: { email: `users-http-member-${tag}@example.invalid`, name: 'Test Member', passwordHash: 'test-only' },
  });
  const otherHouseholdAdmin = await prisma.user.create({
    data: {
      email: `users-http-existing-${tag}@example.invalid`,
      name: 'Existing User',
      passwordHash: 'existing-password-hash',
    },
  });
  await prisma.householdMember.createMany({
    data: [
      { householdId: householdA.id, userId: admin.id, role: 'admin' },
      { householdId: householdA.id, userId: member.id, role: 'member' },
      { householdId: householdB.id, userId: otherHouseholdAdmin.id, role: 'admin' },
    ],
  });

  const userIds = [admin.id, member.id, otherHouseholdAdmin.id];
  return {
    tag,
    householdAId: householdA.id,
    admin,
    member,
    otherHouseholdAdmin,
    userIds,
    cleanup: async () => {
      await prisma.household.deleteMany({ where: { id: { in: [householdA.id, householdB.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    },
  };
}

function bearerToken(app: Awaited<ReturnType<typeof buildAuthedApp>>, userId: string) {
  return { authorization: `Bearer ${app.jwt.sign({ userId })}` };
}

test('GET /api/users permits admin and member to list their household members', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const [adminResponse, memberResponse] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/users', headers: bearerToken(app, scope.admin.id) }),
      app.inject({ method: 'GET', url: '/api/users', headers: bearerToken(app, scope.member.id) }),
    ]);

    assert.equal(adminResponse.statusCode, 200);
    assert.equal(memberResponse.statusCode, 200);
    const expectedIds = [scope.admin.id, scope.member.id].sort();
    assert.deepEqual(adminResponse.json().users.map((user: { id: string }) => user.id).sort(), expectedIds);
    assert.deepEqual(memberResponse.json().users.map((user: { id: string }) => user.id).sort(), expectedIds);
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('POST /api/users creates a new household member for an admin', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const email = `users-http-new-${scope.tag}@example.invalid`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: bearerToken(app, scope.admin.id),
      payload: { email, name: 'New User', password: 'test-password-123', role: 'member' },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().reusedExisting, false);
    const created = await prisma.user.findUniqueOrThrow({ where: { email } });
    scope.userIds.push(created.id);
    assert.equal(response.json().user.id, created.id);
    assert.equal(
      await prisma.householdMember.count({ where: { householdId: scope.householdAId, userId: created.id } }),
      1
    );
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('POST /api/users rejects a member role', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: bearerToken(app, scope.member.id),
      payload: {
        email: `users-http-forbidden-${scope.tag}@example.invalid`,
        name: 'Forbidden User',
        password: 'test-password-123',
        role: 'member',
      },
    });

    assert.equal(response.statusCode, 403);
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('POST /api/users reuses an existing user without replacing its password hash', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: scope.otherHouseholdAdmin.id } });
    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: bearerToken(app, scope.admin.id),
      payload: {
        email: scope.otherHouseholdAdmin.email,
        name: 'Ignored For Existing User',
        password: 'test-password-123',
        role: 'member',
      },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().reusedExisting, true);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: scope.otherHouseholdAdmin.id } });
    assert.equal(after.passwordHash, before.passwordHash);
    assert.equal(
      await prisma.householdMember.count({ where: { householdId: scope.householdAId, userId: before.id } }),
      1
    );
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('PATCH /api/users/:id prevents an admin from demoting themself', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/users/${scope.admin.id}`,
      headers: bearerToken(app, scope.admin.id),
      payload: { role: 'member' },
    });

    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
    await scope.cleanup();
  }
});

test('PATCH /api/users/:id returns 404 for a user in another household', async () => {
  const scope = await createTestScope();
  const app = await buildAuthedApp();
  try {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/users/${scope.otherHouseholdAdmin.id}`,
      headers: bearerToken(app, scope.admin.id),
      payload: { name: 'Should Not Change' },
    });

    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
    await scope.cleanup();
  }
});
