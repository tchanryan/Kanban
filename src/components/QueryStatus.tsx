import type { QueryResult } from './useQuery';

export function QueryStatus({
  queries,
  label,
}: {
  queries: readonly QueryResult<unknown>[];
  label: string;
}) {
  const failed = queries.filter((query) => query.status === 'error');
  if (failed.length)
    return (
      <div role="alert" className="error-banner">
        Could not load {label}. Your saved data has not been cleared.
        <button onClick={() => failed.forEach((query) => query.retry())}>
          Retry {label}
        </button>
      </div>
    );
  if (queries.some((query) => query.status === 'loading'))
    return <p role="status">Loading {label}…</p>;
  return null;
}
