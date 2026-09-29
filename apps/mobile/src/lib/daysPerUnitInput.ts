export type DaysUnit = 'day' | 'week' | 'month';

export const DAYS_UNITS: readonly DaysUnit[] = ['day', 'week', 'month'];
export const DAYS_UNIT_LABELS: Record<DaysUnit, string> = { day: '日', week: '週', month: 'か月' };
export const DAYS_UNIT_FACTORS: Record<DaysUnit, number> = { day: 1, week: 7, month: 30 };
export const PROVISIONAL_DAYS_INPUT = { amount: '1', unit: 'month' as DaysUnit };

export function toDaysPerUnit(amountText: string, unit: DaysUnit): number | null {
  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount * DAYS_UNIT_FACTORS[unit];
}

export function fromDaysPerUnit(days: number): { amount: string; unit: DaysUnit } {
  if (days >= 30 && days % 30 === 0) return { amount: String(days / 30), unit: 'month' };
  if (days >= 7 && days % 7 === 0) return { amount: String(days / 7), unit: 'week' };
  return { amount: String(days), unit: 'day' };
}
