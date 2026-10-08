import { services } from '../app/services';
import type {
  QueryArguments,
  QueryName,
  QueryValue,
} from '../contracts/queries';
import { useQuery, type QueryResult } from './useQuery';

export function useWorkspaceQuery<K extends QueryName>(
  name: K,
  ...args: QueryArguments<K>
): QueryResult<QueryValue<K>> {
  const handle = services.queries.query(name, ...args);
  return useQuery(handle);
}
