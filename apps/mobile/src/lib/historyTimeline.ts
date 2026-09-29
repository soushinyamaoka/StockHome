import type { CorrectionDto, PurchaseDto } from '../api/types';
import { localDateStr } from './quickPurchase';

export type HistoryEntry =
  | { kind: 'purchase'; key: string; date: string; purchase: PurchaseDto }
  | { kind: 'correction'; key: string; date: string; correction: CorrectionDto };

function entryTime(entry: HistoryEntry): number {
  return Date.parse(entry.kind === 'purchase' ? entry.purchase.createdAt : entry.correction.correctedAt);
}

export function buildHistoryTimeline(
  purchases: PurchaseDto[],
  corrections: CorrectionDto[]
): HistoryEntry[] {
  return [
    ...purchases.map((purchase): HistoryEntry => ({
      kind: 'purchase', key: `p:${purchase.id}`, date: purchase.purchasedAt, purchase,
    })),
    ...corrections.map((correction): HistoryEntry => ({
      kind: 'correction', key: `c:${correction.id}`,
      date: localDateStr(new Date(correction.correctedAt)), correction,
    })),
  ].sort((a, b) =>
    b.date.localeCompare(a.date) ||
    entryTime(b) - entryTime(a) ||
    (a.kind === b.kind ? 0 : a.kind === 'correction' ? -1 : 1)
  );
}

function fmt(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatCorrectionQty(
  beforeEstimatedQty: number | null,
  correctedQty: number,
  unit: string
): string {
  if (beforeEstimatedQty == null) return `${fmt(correctedQty)}${unit}に補正`;
  return `推定${fmt(beforeEstimatedQty)}→${fmt(correctedQty)}${unit}`;
}
