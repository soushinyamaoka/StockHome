import assert from 'node:assert/strict';
import test from 'node:test';
import { isAuthRejection } from './authStartup';

test('recognizes 401 and 403 authentication rejections', () => {
  assert.equal(isAuthRejection({ isAxiosError: true, response: { status: 401 } }), true);
  assert.equal(isAuthRejection({ isAxiosError: true, response: { status: 403 } }), true);
});

test('does not treat server, network, or non-axios errors as auth rejections', () => {
  assert.equal(isAuthRejection({ isAxiosError: true, response: { status: 500 } }), false);
  assert.equal(isAuthRejection({ response: { status: 401 } }), false);
  assert.equal(isAuthRejection({ isAxiosError: true, response: undefined }), false);
  assert.equal(isAuthRejection({ code: 'ECONNABORTED' }), false);
  assert.equal(isAuthRejection(new Error()), false);
  assert.equal(isAuthRejection(null), false);
});
