import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateApiToken, hashApiToken, isApiTokenFormat, isDeniedForApiToken } from './apiTokens';

test('外部連携用トークンでは、トークン管理・ログイン系・家族メンバーの変更を受け付けない', () => {
  assert.equal(isDeniedForApiToken('GET', '/api/api-tokens'), true);
  assert.equal(isDeniedForApiToken('DELETE', '/api/api-tokens/:id'), true);
  assert.equal(isDeniedForApiToken('GET', '/api/auth/me'), true);
  assert.equal(isDeniedForApiToken('POST', '/api/auth/change-password'), true);
  assert.equal(isDeniedForApiToken('POST', '/api/users'), true);
  assert.equal(isDeniedForApiToken('PATCH', '/api/users/:id'), true);

  assert.equal(isDeniedForApiToken('GET', '/api/users'), false);
  assert.equal(isDeniedForApiToken('GET', '/api/storage/search'), false);
  assert.equal(isDeniedForApiToken('POST', '/api/purchases'), false);
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
