import { useSyncExternalStore } from 'react';
import type { QueryHandle, QuerySnapshot } from '../contracts/queries';

export type QueryResult<T> = QuerySnapshot<T> & { retry: () => void };

export function useQuery<T>(handle: QueryHandle<T>): QueryResult<T> {
  const snapshot = useSyncExternalStore(handle.subscribe, handle.getSnapshot);
  return { ...snapshot, retry: handle.retry };
}
