import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jstDateOnly } from './date';

test('JST日付境界: UTC前日23:59:59.999(JST同日)はそのカレンダー日付になる', () => {
  const result = jstDateOnly(new Date('2026-01-01T14:59:59.999Z'));
  assert.equal(result.toISOString(), '2026-01-01T00:00:00.000Z');
});

test('JST日付境界: UTC 15:00:00.000(JST翌日0時ちょうど)は翌日のカレンダー日付になる', () => {
  const result = jstDateOnly(new Date('2026-01-01T15:00:00.000Z'));
  assert.equal(result.toISOString(), '2026-01-02T00:00:00.000Z');
});

test('JST日付境界: 通常の日中時刻はそのままのカレンダー日付になる', () => {
  const result = jstDateOnly(new Date('2026-06-15T05:00:00.000Z'));
  assert.equal(result.toISOString(), '2026-06-15T00:00:00.000Z');
});
