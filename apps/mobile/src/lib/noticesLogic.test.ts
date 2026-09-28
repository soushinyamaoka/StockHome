import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Notice } from '../api/notices';
import { countUnread, isFeedStale, isVisibleNow, selectActiveMaintenanceNotices, selectHomeUnreadNotices, STALE_THRESHOLD_MS } from './noticesLogic';

const makeNotice = (kind: Notice['kind'], status?: 'scheduled' | 'in_progress' | 'extended' | 'completed' | 'cancelled', id = 'n'): Notice => ({ notice_id: id, kind, title_ja: id, message_ja: '', visible_from: '2026-09-26T00:00:00Z', visible_until: '2026-09-27T00:00:00Z', ...(kind === 'maintenance' ? { maintenance: { status: status! } } : {}) });
test('visibility includes from and excludes until boundaries', () => {
  const n = makeNotice('feature'); const from = Date.parse(n.visible_from); const until = Date.parse(n.visible_until);
  assert.equal(isVisibleNow(n, from), true); assert.equal(isVisibleNow(n, until), false);
});
test('active maintenance excludes completed, cancelled, and features', () => {
  const now = Date.parse('2026-09-26T12:00:00Z');
  const active = selectActiveMaintenanceNotices([makeNotice('maintenance', 'scheduled'), makeNotice('maintenance', 'completed'), makeNotice('maintenance', 'cancelled'), makeNotice('feature')], now);
  assert.equal(active.length, 1); assert.equal(active[0].maintenance?.status, 'scheduled');
});
test('stale threshold is strict and null is not stale', () => {
  assert.equal(isFeedStale(0, STALE_THRESHOLD_MS), false); assert.equal(isFeedStale(0, STALE_THRESHOLD_MS + 1), true); assert.equal(isFeedStale(null, STALE_THRESHOLD_MS + 1), false);
});
test('countUnread subtracts ids in the read set', () => { assert.equal(countUnread([makeNotice('feature', undefined, 'a'), makeNotice('feature', undefined, 'b')], new Set(['a'])), 1); });

test('home unread notices exclude read and banner notices, include completed maintenance, and sort newest first', () => {
  const older = { ...makeNotice('feature', undefined, 'older'), visible_from: '2026-09-25T00:00:00Z' };
  const newer = { ...makeNotice('feature', undefined, 'newer'), visible_from: '2026-09-26T00:00:00Z' };
  const read = makeNotice('feature', undefined, 'read');
  const banner = makeNotice('maintenance', 'in_progress', 'banner');
  const completed = { ...makeNotice('maintenance', 'completed', 'completed'), visible_from: '2026-09-24T00:00:00Z' };
  const result = selectHomeUnreadNotices([older, newer, read, banner, completed], [banner], new Set(['read']));
  assert.deepEqual(result.map((n) => n.notice_id), ['newer', 'older', 'completed']);
});

test('home unread notices are empty when every notice is read or shown as a banner', () => {
  const read = makeNotice('feature', undefined, 'read');
  const banner = makeNotice('maintenance', 'scheduled', 'banner');
  assert.deepEqual(selectHomeUnreadNotices([read, banner], [banner], new Set(['read'])), []);
});
