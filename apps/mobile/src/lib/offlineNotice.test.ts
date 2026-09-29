import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCachedAt } from './offlineNotice';

test('formats local cached timestamps without padding month, day, or hour', () => {
  assert.equal(formatCachedAt(new Date(2026, 8, 30, 8, 5).getTime()), '9/30 8:05');
  assert.equal(formatCachedAt(new Date(2026, 11, 1, 23, 59).getTime()), '12/1 23:59');
});
