import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromDaysPerUnit, toDaysPerUnit } from './daysPerUnitInput';

test('toDaysPerUnit converts day, week, month and fractional values', () => {
  assert.equal(toDaysPerUnit('10', 'day'), 10);
  assert.equal(toDaysPerUnit('2', 'week'), 14);
  assert.equal(toDaysPerUnit('1', 'month'), 30);
  assert.equal(toDaysPerUnit('0.5', 'week'), 3.5);
  assert.equal(toDaysPerUnit('1.5', 'month'), 45);
});

test('toDaysPerUnit rejects empty, invalid and nonpositive values', () => {
  assert.equal(toDaysPerUnit('', 'day'), null);
  assert.equal(toDaysPerUnit('0', 'week'), null);
  assert.equal(toDaysPerUnit('-1', 'day'), null);
  assert.equal(toDaysPerUnit('abc', 'month'), null);
});

test('fromDaysPerUnit chooses month, week or day display values', () => {
  assert.deepEqual(fromDaysPerUnit(60), { amount: '2', unit: 'month' });
  assert.deepEqual(fromDaysPerUnit(30), { amount: '1', unit: 'month' });
  assert.deepEqual(fromDaysPerUnit(14), { amount: '2', unit: 'week' });
  assert.deepEqual(fromDaysPerUnit(7), { amount: '1', unit: 'week' });
  assert.deepEqual(fromDaysPerUnit(10), { amount: '10', unit: 'day' });
  assert.deepEqual(fromDaysPerUnit(3.5), { amount: '3.5', unit: 'day' });
  assert.deepEqual(fromDaysPerUnit(0), { amount: '0', unit: 'day' });
});

test('fromDaysPerUnit round-trips representative day values', () => {
  for (const days of [1, 7, 10, 14, 30, 45, 60, 90]) {
    const result = fromDaysPerUnit(days);
    assert.equal(toDaysPerUnit(result.amount, result.unit), days);
  }
});
