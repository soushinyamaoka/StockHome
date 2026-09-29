import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsPaceReview } from './paceReview';

test('needsPaceReview requires a suggestion with enough samples', () => {
  assert.equal(needsPaceReview(10, null), false);
  assert.equal(needsPaceReview(10, undefined), false);
  assert.equal(needsPaceReview(10, { value: 100, sampleCount: 1 }), false);
});

test('needsPaceReview ignores invalid configured pace values', () => {
  const suggestion = { value: 100, sampleCount: 2 };
  for (const daysPerUnit of [0, -1, Number.NaN]) {
    assert.equal(needsPaceReview(daysPerUnit, suggestion), false);
  }
});

test('needsPaceReview uses an inclusive 30 percent difference threshold', () => {
  assert.equal(needsPaceReview(10, { value: 13, sampleCount: 2 }), true);
  assert.equal(needsPaceReview(10, { value: 12.9, sampleCount: 2 }), false);
  assert.equal(needsPaceReview(10, { value: 7, sampleCount: 2 }), true);
  assert.equal(needsPaceReview(10, { value: 7.1, sampleCount: 2 }), false);
});
