import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CorrectionDto, PurchaseDto } from '../api/types';
import { buildHistoryTimeline, formatCorrectionQty } from './historyTimeline';

function purchase(id: string, purchasedAt: string, createdAt: string): PurchaseDto {
  return {
    id, itemId: 'item-1', purchasedAt, createdAt, qty: 1, price: null, source: 'manual',
    sourceType: 'manual', externalVendor: null, externalOrderId: null,
    purchasedByUserId: null, purchasedByUserName: null, note: null,
    fulfillmentStatus: null, shippedAt: null, inventoryEffectiveAt: null, countedInInventory: true,
  };
}

function correction(id: string, correctedAt: string): CorrectionDto {
  return {
    id, itemId: 'item-1', correctedAt, correctedByUserName: null,
    beforeEstimatedQty: 2, correctedQty: 1, correctionReason: 'counted_actual_stock', note: null,
  };
}

test('merges purchases and corrections by local date descending', () => {
  const result = buildHistoryTimeline(
    [purchase('new', '2026-09-20', '2026-09-20T09:00:00.000Z'), purchase('old', '2026-09-10', '2026-09-10T09:00:00.000Z')],
    [correction('middle', new Date(2026, 8, 15, 12, 0).toISOString())]
  );
  assert.deepEqual(result.map((entry) => `${entry.kind}:${entry.date}`), [
    'purchase:2026-09-20', 'correction:2026-09-15', 'purchase:2026-09-10',
  ]);
});

test('orders same-day entries by their timestamps in either direction', () => {
  const newerPurchase = buildHistoryTimeline(
    [purchase('p', '2026-09-15', '2026-09-15T12:00:00.000Z')],
    [correction('c', '2026-09-15T11:00:00.000Z')]
  );
  assert.deepEqual(newerPurchase.map((entry) => entry.kind), ['purchase', 'correction']);

  const newerCorrection = buildHistoryTimeline(
    [purchase('p', '2026-09-15', '2026-09-15T11:00:00.000Z')],
    [correction('c', '2026-09-15T12:00:00.000Z')]
  );
  assert.deepEqual(newerCorrection.map((entry) => entry.kind), ['correction', 'purchase']);
});

test('puts correction first for equal date and timestamp', () => {
  const entries = buildHistoryTimeline(
    [purchase('p', '2026-09-15', '2026-09-15T12:00:00.000Z')],
    [correction('c', '2026-09-15T12:00:00.000Z')]
  );
  assert.deepEqual(entries.map((entry) => entry.kind), ['correction', 'purchase']);
});

test('preserves purchase order when there are no corrections and sorts corrections alone', () => {
  const purchases = [purchase('later', '2026-09-20', '2026-09-20T12:00:00.000Z'), purchase('earlier', '2026-09-10', '2026-09-10T12:00:00.000Z')];
  assert.deepEqual(buildHistoryTimeline(purchases, []).map((entry) => entry.key), ['p:later', 'p:earlier']);
  const corrections = [correction('earlier', '2026-09-10T12:00:00.000Z'), correction('later', '2026-09-20T12:00:00.000Z')];
  assert.deepEqual(buildHistoryTimeline([], corrections).map((entry) => entry.key), ['c:later', 'c:earlier']);
});

test('uses stable prefixed keys and does not mutate input arrays', () => {
  const purchases = [purchase('p1', '2026-09-10', '2026-09-10T12:00:00.000Z')];
  const corrections = [correction('c1', '2026-09-11T12:00:00.000Z')];
  const before = structuredClone({ purchases, corrections });
  const entries = buildHistoryTimeline(purchases, corrections);
  assert.deepEqual(entries.map((entry) => entry.key), ['c:c1', 'p:p1']);
  assert.deepEqual({ purchases, corrections }, before);
});

test('formats correction quantities to one decimal place without trailing zeroes', () => {
  assert.equal(formatCorrectionQty(1.25, 0.5, '本'), '推定1.3→0.5本');
  assert.equal(formatCorrectionQty(null, 2, '箱'), '2箱に補正');
  assert.equal(formatCorrectionQty(3, 0, ''), '推定3→0');
});
