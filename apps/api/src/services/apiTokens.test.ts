import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateApiToken, hashApiToken, isApiTokenFormat, isDeniedForApiToken } from './apiTokens';

test('外部連携用トークンでは、トークン管理・ログイン系・個人情報を返すAPIを受け付けない', () => {
  for (const route of [
    '/api/api-tokens',
    '/api/api-tokens/:id',
    '/api/auth/me',
    '/api/auth/change-password',
    '/api/users',
    '/api/users/:id',
    '/api/push-devices',
    '/api/push-devices/test',
    '/api/import-candidates',
    '/api/import-candidates/:id/confirm',
    '/api/reflections',
    '/api/dashboard/run-batch',
  ]) {
    assert.equal(isDeniedForApiToken(route), true, route);
  }
  for (const route of ['/api/storage/search', '/api/items', '/api/stocks', '/api/purchases', '/api/dashboard']) {
    assert.equal(isDeniedForApiToken(route), false, route);
  }
});

test('トークンは目印付きの乱数で、毎回異なり、ハッシュで照合できる', () => {
  const a = generateApiToken();
  const b = generateApiToken();
  assert.ok(isApiTokenFormat(a.token));
  assert.notEqual(a.token, b.token);
  assert.equal(a.tokenHash, hashApiToken(a.token));
  assert.ok(a.token.startsWith(a.tokenPrefix));
  assert.equal(a.tokenPrefix.length, 10);
  // アプリのログイン用トークン（JWT）は目印を持たない
  assert.equal(isApiTokenFormat('eyJhbGciOiJIUzI1NiJ9.e30.x'), false);
});
