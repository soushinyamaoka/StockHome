import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateStock } from './stockCalc';

const today = new Date('2026-10-21T00:00:00.000Z');
// JST 2026-10-11 00:00 に休止 → 計算上の「今日」は 10/11 で止まる
const pauseAt = new Date('2026-10-10T15:00:00.000Z');

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1', daysPerUnit: 10, lowStockThresholdQty: 1, leadDays: 2, safetyDays: 1,
    isInventoryUnknown: false, consumptionPausedAt: pauseAt,
    runtimeState: null,
    ...overrides,
  } as Parameters<typeof calculateStock>[0];
}

function purchase(purchasedAt: string, qty = 5) {
  return { purchasedAt: new Date(purchasedAt), qty, inventoryEffectiveAt: null } as any;
}

test('paused stock freezes at the pause date for purchase and override origins', () => {
  const fromPurchase = calculateStock(item(), purchase('2026-10-01'), today);
  assert.equal(fromPurchase.estimatedRemainingQty, 4);
  assert.equal(calculateStock(item(), purchase('2026-10-01'), new Date('2027-02-01')).estimatedRemainingQty, 4);

  const withOverride = item({ runtimeState: { manualOverrideQty: 8, manualOverrideAt: new Date('2026-10-01') } });
  assert.equal(calculateStock(withOverride, null, today).estimatedRemainingQty, 7);
  assert.equal(calculateStock(withOverride, null, new Date('2027-02-01')).estimatedRemainingQty, 7);
});

test('paused stock does not decay from overrides written after pause and suppresses alerts/dates', () => {
  const paused = item({ runtimeState: { manualOverrideQty: 9, manualOverrideAt: new Date('2026-10-15') } });
  const result = calculateStock(paused, null, new Date('2027-01-01'));
  assert.equal(result.estimatedRemainingQty, 9);
  assert.equal(result.daysAlertNeeded, false);
  assert.equal(result.qtyAlertNeeded, false);
  assert.equal(result.alertNeeded, false);
  assert.equal(result.estimatedDaysLeft, null);
  assert.equal(result.predictedOutOfStockDate, null);
});

test('unpaused stock retains the existing calculation', () => {
  const result = calculateStock(item({ consumptionPausedAt: null }), purchase('2026-10-01'), today);
  assert.equal(result.estimatedRemainingQty, 3);
  assert.equal(result.estimatedDaysLeft, 30);
  assert.equal(result.predictedOutOfStockDate?.toISOString().slice(0, 10), '2026-11-20');
});
