import assert from 'node:assert/strict';
import test from 'node:test';
import { PERSISTED_QUERY_ROOT_KEYS, shouldPersistQuery } from './queryPersistRules';

const query = (queryKey: readonly unknown[], status = 'success') => ({ queryKey, state: { status } });

test('persists only successful stocks and dashboard queries', () => {
  assert.deepEqual(PERSISTED_QUERY_ROOT_KEYS, ['stocks', 'dashboard']);
  assert.equal(shouldPersistQuery(query(['stocks'])), true);
  assert.equal(shouldPersistQuery(query(['dashboard'])), true);
  assert.equal(shouldPersistQuery(query(['stocks'], 'error')), false);
  assert.equal(shouldPersistQuery(query(['stocks'], 'pending')), false);
  assert.equal(shouldPersistQuery(query(['items'])), false);
  assert.equal(shouldPersistQuery(query(['candidates', false])), false);
  assert.equal(shouldPersistQuery(query(['purchases', 'x'])), false);
});
