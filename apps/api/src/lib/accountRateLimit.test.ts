import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import Fastify from 'fastify';
import {
  createAccountRateLimitPreHandler,
  getAccountRateLimitStoreSizeForTest,
  resetAccountRateLimitStoreForTest,
  setMaxEntriesForTest,
} from './accountRateLimit';

beforeEach(() => {
  resetAccountRateLimitStoreForTest();
});

async function buildApp(namespace = 'login', max = 2, windowMs = 60_000) {
  const app = Fastify();
  app.post(
    '/attempt',
    {
      preHandler: [
        createAccountRateLimitPreHandler({
          namespace,
          max,
          windowMs,
          extractEmail: (body) => (body as { email?: string } | null)?.email,
        }),
      ],
    },
    async () => ({ ok: true })
  );
  await app.ready();
  return app;
}

async function attempt(app: Awaited<ReturnType<typeof buildApp>>, email: string) {
  return app.inject({ method: 'POST', url: '/attempt', payload: { email } });
}

test('returns 429 with Retry-After after the account limit is exceeded', async () => {
  const app = await buildApp();
  try {
    assert.equal((await attempt(app, 'user@example.com')).statusCode, 200);
    assert.equal((await attempt(app, 'user@example.com')).statusCode, 200);

    const limited = await attempt(app, 'user@example.com');
    assert.equal(limited.statusCode, 429);
    assert.ok(limited.headers['retry-after']);
    assert.equal(limited.json().message, '試行回数が多すぎます。しばらくしてから再度お試しください');
  } finally {
    await app.close();
  }
});

test('uses a separate bucket for each email address', async () => {
  const app = await buildApp();
  try {
    await attempt(app, 'a@example.com');
    await attempt(app, 'a@example.com');
    assert.equal((await attempt(app, 'a@example.com')).statusCode, 429);
    assert.equal((await attempt(app, 'b@example.com')).statusCode, 200);
  } finally {
    await app.close();
  }
});

test('uses separate buckets for login and register namespaces', async () => {
  const loginApp = await buildApp('login');
  const registerApp = await buildApp('register');
  try {
    await attempt(loginApp, 'user@example.com');
    await attempt(loginApp, 'user@example.com');
    assert.equal((await attempt(loginApp, 'user@example.com')).statusCode, 429);
    assert.equal((await attempt(registerApp, 'user@example.com')).statusCode, 200);
  } finally {
    await loginApp.close();
    await registerApp.close();
  }
});

test('normalizes email casing within an account bucket', async () => {
  const app = await buildApp();
  try {
    await attempt(app, 'User@Example.com');
    await attempt(app, 'user@example.com');
    assert.equal((await attempt(app, 'USER@example.com')).statusCode, 429);
  } finally {
    await app.close();
  }
});

test('resets the counter after its fixed window expires', async () => {
  const app = await buildApp('login', 1, 20);
  try {
    assert.equal((await attempt(app, 'user@example.com')).statusCode, 200);
    assert.equal((await attempt(app, 'user@example.com')).statusCode, 429);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal((await attempt(app, 'user@example.com')).statusCode, 200);
  } finally {
    await app.close();
  }
});

test('keeps the TTL store within its configured capacity', async () => {
  setMaxEntriesForTest(3);
  const app = await buildApp();
  try {
    for (const email of ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']) {
      assert.equal((await attempt(app, email)).statusCode, 200);
    }
    assert.ok(getAccountRateLimitStoreSizeForTest() <= 3);
  } finally {
    await app.close();
  }
});

test('passes through non-string email values without throwing', async () => {
  const app = await buildApp();
  try {
    assert.equal(
      (await app.inject({ method: 'POST', url: '/attempt', payload: { email: 12345 } })).statusCode,
      200
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: '/attempt', payload: { email: ['a@example.com'] } })).statusCode,
      200
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: '/attempt', payload: { email: { value: 'a@example.com' } } })).statusCode,
      200
    );
  } finally {
    await app.close();
  }
});
