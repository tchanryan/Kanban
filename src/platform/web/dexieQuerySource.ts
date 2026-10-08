import { liveQuery } from 'dexie';
import type {
  QueryObserver,
  QueryScope,
  QuerySource,
  Unsubscribe,
} from '../../contracts/queries';

export class DexieQuerySource implements QuerySource {
  public observe<T>(
    _scope: QueryScope,
    read: () => Promise<T>,
    observer: QueryObserver<T>,
  ): Unsubscribe {
    // Dexie tracks read ranges, accumulates commits during reads and discards
    // superseded results before publishing. This also covers other browser tabs.
    const subscription = liveQuery(async () => {
      try {
        return { ok: true as const, value: await read() };
      } catch (error) {
        // Include closed-database errors, which liveQuery otherwise suppresses.
        return { ok: false as const, error };
      }
    }).subscribe({
      next: (result) =>
        result.ok ? observer.next(result.value) : observer.error(result.error),
      error: (error) => observer.error(error),
    });
    return () => subscription.unsubscribe();
  }
}
