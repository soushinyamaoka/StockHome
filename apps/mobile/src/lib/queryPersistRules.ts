export const PERSISTED_QUERY_ROOT_KEYS = ['stocks', 'dashboard'] as const;

export function shouldPersistQuery(query: { queryKey: readonly unknown[]; state: { status: string } }): boolean {
  return query.state.status === 'success' &&
    PERSISTED_QUERY_ROOT_KEYS.some((rootKey) => query.queryKey[0] === rootKey);
}
