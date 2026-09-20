import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import authPlugin from './auth';

test('new JWTs expire after 90 days', async () => {
  const app = Fastify();
  await app.register(authPlugin);
  await app.ready();

  try {
    const token = app.jwt.sign({ userId: 'test-user' });
    const payload = app.jwt.decode<{ userId: string; iat: number; exp: number }>(token);

    assert.ok(payload);
    assert.equal(payload.userId, 'test-user');
    assert.equal(payload.exp - payload.iat, 90 * 24 * 60 * 60);
  } finally {
    await app.close();
  }
});
