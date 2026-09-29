import type { SuggestedDaysPerUnit } from '../api/types';

export const PACE_REVIEW_RATIO = 0.3;
export const PACE_REVIEW_MIN_SAMPLES = 2;

export function needsPaceReview(
  daysPerUnit: number,
  suggestion: SuggestedDaysPerUnit | null | undefined
): boolean {
  if (!suggestion || suggestion.sampleCount < PACE_REVIEW_MIN_SAMPLES) return false;
  if (!Number.isFinite(daysPerUnit) || daysPerUnit <= 0) return false;
  return Math.abs(suggestion.value - daysPerUnit) / daysPerUnit >= PACE_REVIEW_RATIO;
}
