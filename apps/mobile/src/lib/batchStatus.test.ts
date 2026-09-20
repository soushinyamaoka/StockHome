import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveBatchStatusMessage } from './batchStatus';

test('returns null when lastBatchRun is null', () => {
  assert.equal(resolveBatchStatusMessage(null), null);
});

test('returns a failure message when status is failure', () => {
  const message = resolveBatchStatusMessage({
    status: 'failure',
    ranAt: '2026-09-20T10:55:00.000Z',
    ageHours: 1,
  });
  assert.match(message!, /夜間バッチが失敗しました/);
});

test('returns a stale message when success but older than 26 hours', () => {
  const message = resolveBatchStatusMessage({
    status: 'success',
    ranAt: '2026-09-19T00:00:00.000Z',
    ageHours: 27,
  });
  assert.match(message!, /バッチの実行が確認できません/);
});

test('returns null when success and within 26 hours', () => {
  const message = resolveBatchStatusMessage({
    status: 'success',
    ranAt: '2026-09-20T10:55:00.000Z',
    ageHours: 1,
  });
  assert.equal(message, null);
});

test('returns null at exactly the 26-hour boundary (not stale yet)', () => {
  const message = resolveBatchStatusMessage({
    status: 'success',
    ranAt: '2026-09-19T08:55:00.000Z',
    ageHours: 26,
  });
  assert.equal(message, null);
});
