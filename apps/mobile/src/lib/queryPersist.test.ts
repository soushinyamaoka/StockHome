import assert from 'node:assert/strict';
import test from 'node:test';
import { PERSISTED_QUERY_ROOT_KEYS, shouldPersistQuery } from './queryPersistRules';

const query = (queryKey: readonly unknown[], status = 'success') => ({ queryKey, state: { status } });

test('persists only successful stocks, dashboard and storage queries', () => {
  assert.deepEqual(PERSISTED_QUERY_ROOT_KEYS, ['stocks', 'dashboard', 'storage']);
  assert.equal(shouldPersistQuery(query(['stocks'])), true);
  assert.equal(shouldPersistQuery(query(['dashboard'])), true);
  assert.equal(shouldPersistQuery(query(['stocks'], 'error')), false);
  assert.equal(shouldPersistQuery(query(['stocks'], 'pending')), false);
  assert.equal(shouldPersistQuery(query(['items'])), false);
  assert.equal(shouldPersistQuery(query(['candidates', false])), false);
  assert.equal(shouldPersistQuery(query(['purchases', 'x'])), false);
});

test('persists storage locations, tags and per-location/tag searches but not free-text searches', () => {
  assert.equal(shouldPersistQuery(query(['storage', 'locations'])), true);
  assert.equal(shouldPersistQuery(query(['storage', 'tags'])), true);
  assert.equal(shouldPersistQuery(query(['storage', 'search', { locationId: 'l1' }])), true);
  assert.equal(shouldPersistQuery(query(['storage', 'search', { kind: 'item' }])), true);
  assert.equal(shouldPersistQuery(query(['storage', 'search', { q: '', tagId: 't1' }])), true);
  assert.equal(shouldPersistQuery(query(['storage', 'search', { q: 'ほうき', tagId: null }])), false);
  assert.equal(shouldPersistQuery(query(['storage', 'locations'], 'error')), false);
});
