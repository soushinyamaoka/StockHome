// 置き場所の登録・編集画面で使う純粋関数
import { normalizeStorageName } from '@stockhome/shared';
import type { StorageLocationDto } from '../api/storage';

const MAX_SUGGESTIONS = 8;

/**
 * 用途タグの入力候補。既存タグのうち入力を含むものを、前方一致→部分一致の順で返す。
 * 付与済みのタグは出さない。入力が空なら、よく使われているタグ順に返す（表記ゆれを防ぐため既存タグへ誘導する）。
 */
export function suggestTags(
  allTags: { name: string; usageCount?: number }[],
  input: string,
  selected: string[]
): string[] {
  const chosen = new Set(selected.map(normalizeStorageName));
  const candidates = allTags.filter((t) => !chosen.has(t.name));
  const needle = normalizeStorageName(input).toLowerCase();
  if (!needle) {
    return [...candidates]
      .sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0) || a.name.localeCompare(b.name, 'ja'))
      .slice(0, MAX_SUGGESTIONS)
      .map((t) => t.name);
  }
  const lower = (name: string) => name.toLowerCase();
  const prefix = candidates.filter((t) => lower(t.name).startsWith(needle));
  const partial = candidates.filter((t) => !lower(t.name).startsWith(needle) && lower(t.name).includes(needle));
  return [...prefix, ...partial].slice(0, MAX_SUGGESTIONS).map((t) => t.name);
}

/** タグ名を正規化して追加する（空・重複は無視） */
export function addTagName(selected: string[], raw: string): string[] {
  const name = normalizeStorageName(raw);
  if (!name || selected.includes(name)) return selected;
  return [...selected, name];
}

/**
 * 移動先・統合先として選べない場所（自分と、その配下）。
 * 自分の中へ移す・統合すると循環になるため、API でも拒否されるが画面でも選ばせない。
 */
export function selfAndDescendantIds(locations: StorageLocationDto[], id: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const loc of locations) {
    if (!loc.parentId) continue;
    childrenOf.set(loc.parentId, [...(childrenOf.get(loc.parentId) ?? []), loc.id]);
  }
  const result = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (result.has(current)) continue;
    result.add(current);
    stack.push(...(childrenOf.get(current) ?? []));
  }
  return result;
}

/** API エラーから利用者向けメッセージを取り出す（API は日本語の message を返す） */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof message === 'string' && message ? message : fallback;
}
