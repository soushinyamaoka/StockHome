import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectiveSelection, isUnresolvedCandidateStatus, runBulkIgnore, selectableCandidateIds } from './candidateBulkIgnore';

test('unresolved candidate statuses are selectable', () => {
  for (const status of ['detected', 'ordered', 'shipped']) assert.equal(isUnresolvedCandidateStatus(status), true);
  for (const status of ['confirmed', 'auto_confirmed', 'ignored']) assert.equal(isUnresolvedCandidateStatus(status), false);
});

test('selectable ids exclude resolved candidates and keep input order', () => {
  assert.deepEqual(selectableCandidateIds([
    { id: 'a', candidateStatus: 'detected' }, { id: 'b', candidateStatus: 'ignored' },
    { id: 'c', candidateStatus: 'shipped' }, { id: 'd', candidateStatus: 'ordered' },
  ]), ['a', 'c', 'd']);
});

test('effective selection follows selectable order and excludes stale ids', () => {
  assert.deepEqual(effectiveSelection(new Set(['b', 'stale', 'a']), ['a', 'b', 'c']), ['a', 'b']);
});

test('runBulkIgnore succeeds sequentially', async () => {
  const calls: string[] = [];
  const result = await runBulkIgnore(['a', 'b'], async (id) => { calls.push(id); });
  assert.deepEqual(calls, ['a', 'b']);
  assert.deepEqual(result, { succeeded: ['a', 'b'], failed: [] });
});

test('runBulkIgnore continues after a failure and records ids in order', async () => {
  const calls: string[] = [];
  const result = await runBulkIgnore(['a', 'b', 'c'], async (id) => {
    calls.push(id);
    if (id === 'b') throw new Error('failed');
  });
  assert.deepEqual(calls, ['a', 'b', 'c']);
  assert.deepEqual(result, { succeeded: ['a', 'c'], failed: ['b'] });
});

test('runBulkIgnore waits for each request before starting the next', async () => {
  const calls: string[] = [];
  let resolveFirst!: () => void;
  const first = new Promise<void>((resolve) => { resolveFirst = resolve; });
  const running = runBulkIgnore(['a', 'b'], async (id) => {
    calls.push(id);
    if (id === 'a') await first;
  });
  await Promise.resolve();
  assert.deepEqual(calls, ['a']);
  resolveFirst();
  await running;
  assert.deepEqual(calls, ['a', 'b']);
});

test('runBulkIgnore does not call ignoreOne for an empty list', async () => {
  let called = false;
  assert.deepEqual(await runBulkIgnore([], async () => { called = true; }), { succeeded: [], failed: [] });
  assert.equal(called, false);
});
