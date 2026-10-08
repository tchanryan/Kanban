import type {
  QueryObserver,
  QueryScope,
  QuerySource,
} from '../../contracts/queries';
import { CommitNotifications } from './transport';

/** Refetch after commits; discard reads overtaken by a notification. */
export class NativeQuerySource implements QuerySource {
  public constructor(private readonly notifications: CommitNotifications) {}
  public observe<T>(
    _scope: QueryScope,
    read: () => Promise<T>,
    observer: QueryObserver<T>,
  ): () => void {
    let active = true;
    let revision = 0;
    let running = false;
    const refresh = async (): Promise<void> => {
      revision++;
      if (running) return;
      running = true;
      while (active) {
        const started = revision;
        try {
          const value = await read();
          if (active && started === revision) observer.next(value);
        } catch (error) {
          if (active && started === revision)
            observer.error(
              error instanceof Error
                ? error
                : Error('Could not read native storage'),
            );
        }
        if (started === revision) break;
      }
      running = false;
    };
    const unsubscribe = this.notifications.subscribe(() => {
      void refresh();
    });
    void refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }
}
