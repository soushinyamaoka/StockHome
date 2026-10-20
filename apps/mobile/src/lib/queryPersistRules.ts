export const PERSISTED_QUERY_ROOT_KEYS = ['stocks', 'dashboard', 'storage'] as const;

// 置き場所のキーワード検索（['storage', 'search', { q }]）は入力ごとに別キーになり端末に溜まるため保存しない。
// 場所の一覧・用途タグ・場所ごとの中身・タグ検索は、オフラインでも「どこにある?」を見られるよう保存する
function isFreeTextStorageSearch(queryKey: readonly unknown[]): boolean {
  const params = queryKey[2] as { q?: unknown } | undefined;
  return queryKey[0] === 'storage' && queryKey[1] === 'search' && typeof params?.q === 'string' && params.q !== '';
}

export function shouldPersistQuery(query: { queryKey: readonly unknown[]; state: { status: string } }): boolean {
  return query.state.status === 'success' &&
    PERSISTED_QUERY_ROOT_KEYS.some((rootKey) => query.queryKey[0] === rootKey) &&
    !isFreeTextStorageSearch(query.queryKey);
}
