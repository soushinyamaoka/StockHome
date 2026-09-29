import { QueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
export { PERSISTED_QUERY_ROOT_KEYS, shouldPersistQuery } from './queryPersistRules';

export const QUERY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'stockhome.queryCache.v1',
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 30,
      gcTime: QUERY_CACHE_MAX_AGE_MS,
      refetchOnWindowFocus: false,
    },
  },
});

export async function clearPersistedQueries(): Promise<void> {
  queryClient.clear();
  try { await queryPersister.removeClient(); } catch { /* persisted cache is optional */ }
}
