// 品目一覧・在庫一覧の検索/絞り込み（所見B-7対応）。
// 2つの一覧で挙動が食い違わないよう、カテゴリの集約と一致判定をここへ集約する

// カテゴリ未設定の品目をチップで選ぶための内部値。実カテゴリ名と衝突しないようにする
export const UNCATEGORIZED_VALUE = '__uncategorized__';
export const UNCATEGORIZED_LABEL = '未分類';

export interface FilterableItem {
  itemName: string;
  category: string | null;
}

// 一覧に実在するカテゴリを重複なく集める（あいうえお順）。
// カテゴリ未設定の品目が1件でもあれば、末尾に未分類を表す番兵値を足す
export function collectItemCategories(items: FilterableItem[]): string[] {
  const named = [
    ...new Set(items.map((i) => i.category?.trim()).filter((c): c is string => !!c)),
  ];
  named.sort((a, b) => a.localeCompare(b, 'ja'));
  const hasUncategorized = items.some((i) => !i.category?.trim());
  return hasUncategorized ? [...named, UNCATEGORIZED_VALUE] : named;
}

// 検索語（品目名の部分一致・大文字小文字を区別しない）とカテゴリ選択の両方を満たすか。
// category が null の場合はカテゴリで絞り込まない
export function matchesItemFilter(
  item: FilterableItem,
  query: string,
  category: string | null
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery && !item.itemName.toLowerCase().includes(normalizedQuery)) {
    return false;
  }
  if (!category) return true;
  const itemCategory = item.category?.trim();
  return category === UNCATEGORIZED_VALUE ? !itemCategory : itemCategory === category;
}
