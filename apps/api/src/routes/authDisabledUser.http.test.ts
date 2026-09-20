import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import Fastify from 'fastify';
import authPlugin from '../plugins/auth';
import authRoutes from './auth';
import { prisma } from '../lib/prisma';

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
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.ready();
  return app;
}

let scopeCounter = 0;
const password = 'test-password-123';
const unavailableMessage = 'このアカウントは利用できません';
const invalidCredentialsMessage = 'メールアドレスかパスワードが違います';

interface TestScope {
  user: { id: string; email: string };
  cleanup: () => Promise<void>;
}

async function createTestScope(isActive: boolean): Promise<TestScope> {
  scopeCounter += 1;
  const tag = `${Date.now()}-${scopeCounter}`;
  const household = await prisma.household.create({ data: { name: `auth-disabled-${tag}` } });
  const user = await prisma.user.create({
    data: {
      email: `auth-disabled-${tag}@example.invalid`,
      name: 'Auth Disabled Test',
      passwordHash: await bcrypt.hash(password, 10),
      isActive,
    },
  });
  await prisma.householdMember.create({ data: { householdId: household.id, userId: user.id, role: 'admin' } });

  return {
    user,
    cleanup: async () => {
      await prisma.household.deleteMany({ where: { id: household.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    },
  };
}

async function withScope(isActive: boolean, run: (scope: TestScope, app: Awaited<ReturnType<typeof buildAuthedApp>>) => Promise<void>) {
  const scope = await createTestScope(isActive);
  const app = await buildAuthedApp();
  try {
    await run(scope, app);
  } finally {
    await app.close();
    await scope.cleanup();
  }
}

function login(app: Awaited<ReturnType<typeof buildAuthedApp>>, email: string, loginPassword = password) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: loginPassword },
  });
}

function bearerToken(app: Awaited<ReturnType<typeof buildAuthedApp>>, userId: string) {
  return { authorization: `Bearer ${app.jwt.sign({ userId })}` };
}

test('disabled users cannot log in or receive a token', async () => {
  await withScope(false, async (scope, app) => {
    const response = await login(app, scope.user.email);

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().message, unavailableMessage);
    assert.equal('token' in response.json(), false);
  });
});

test('active users can log in and receive a token', async () => {
  await withScope(true, async (scope, app) => {
    const response = await login(app, scope.user.email);

    assert.equal(response.statusCode, 200);
    assert.equal(typeof response.json().token, 'string');
  });
});

test('a token issued before user disablement cannot access authenticated endpoints', async () => {
  await withScope(true, async (scope, app) => {
    const headers = bearerToken(app, scope.user.id);
    await prisma.user.update({ where: { id: scope.user.id }, data: { isActive: false } });

    const response = await app.inject({ method: 'GET', url: '/api/auth/me', headers });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().message, unavailableMessage);
  });
});

test('an active user token can access authenticated endpoints', async () => {
  await withScope(true, async (scope, app) => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: bearerToken(app, scope.user.id),
    });

    assert.equal(response.statusCode, 200);
  });
});

test('a wrong password for a disabled user remains an invalid-credentials response', async () => {
  await withScope(false, async (scope, app) => {
    const response = await login(app, scope.user.email, 'wrong-password');

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().message, invalidCredentialsMessage);
  });
});
