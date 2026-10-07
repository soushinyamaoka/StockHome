import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildQuickPurchaseInput, localDateStr, quickPurchaseMessage, quickPurchaseQty, stepQuickPurchaseQty } from './quickPurchase';

test('localDateStr formats local month and day with zero padding', () => {
  assert.equal(localDateStr(new Date(2026, 0, 5)), '2026-01-05');
});

test('quickPurchaseQty preserves valid quantities and falls back to one', () => {
  for (const [input, expected] of [[12, 12], [1, 1], [2.5, 2.5], [0, 1], [0.5, 1], [-3, 1], [NaN, 1]] as const) {
    assert.equal(quickPurchaseQty(input), expected);
  }
});

test('stepQuickPurchaseQty increments and decrements without going below one', () => {
  for (const [current, delta, expected] of [
    [3, -1, 2], [1, -1, 1], [2.5, -1, 1.5], [1.5, -1, 1], [12, 1, 13],
    [NaN, 1, 2], [NaN, -1, 1],
  ] as const) {
    assert.equal(stepQuickPurchaseQty(current, delta), expected);
  }
});

test('buildQuickPurchaseInput contains only the purchase input fields', () => {
  assert.deepEqual(
    buildQuickPurchaseInput({ id: 'i1', defaultPurchaseQty: 12 }, new Date(2026, 8, 29)),
    { itemId: 'i1', purchasedAt: '2026-09-29', qty: 12 }
  );
});

test('quickPurchaseMessage formats unit and unitless quantities', () => {
  assert.equal(quickPurchaseMessage('トイレットペーパー', 12, 'ロール'), '「トイレットペーパー」を 12ロール 記録しました');
  assert.equal(quickPurchaseMessage('洗剤', 1, ''), '「洗剤」を 1 つ記録しました');
  assert.equal(quickPurchaseMessage('洗剤', 1, null), '「洗剤」を 1 つ記録しました');
});
