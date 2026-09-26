import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateNotices } from './notices';

const base = { notice_id: 'n1', kind: 'feature', target_apps: ['stockhome'], title_ja: 'title', message_ja: 'message', visible_from: '2026-09-26T00:00:00Z', visible_until: '2026-09-27T00:00:00+09:00' };
test('filters notices not targeting stockhome and non-array target_apps', () => {
  assert.equal(validateNotices([{ ...base, target_apps: ['other'] }, { ...base, target_apps: 'stockhome' }]).length, 0);
});
test('filters invalid kinds and maintenance status or missing maintenance', () => {
  assert.equal(validateNotices([{ ...base, kind: 'other' }, { ...base, kind: 'maintenance' }, { ...base, kind: 'maintenance', maintenance: { status: 'bad' } }]).length, 0);
});
test('filters invalid visible ranges and offset-free dates', () => {
  assert.equal(validateNotices([{ ...base, visible_until: base.visible_from }, { ...base, visible_from: '2026-09-26T00:00:00' }]).length, 0);
});
test('allows unknown fields and returns valid required data', () => {
  assert.equal(validateNotices([{ ...base, future_field: true }]).length, 1);
});
test('returns empty array for non-array input', () => { assert.deepEqual(validateNotices({ notices: [] }), []); });
