import type {
  QueryArguments,
  QueryHandle,
  QueryName,
  QuerySnapshot,
  QueryScope,
  QuerySource,
  QueryValue,
  Unsubscribe,
  WorkspaceReadModel,
} from '../contracts/queries';

const loading = {
  status: 'loading',
  data: undefined,
  error: undefined,
} as const;

class QueryEntry<T> implements QueryHandle<T> {
  private snapshot: QuerySnapshot<T> = loading;
  private readonly listeners = new Set<() => void>();
  private stop: Unsubscribe | undefined;
  private epoch = 0;

  public constructor(
    private readonly source: QuerySource,
    private readonly scope: QueryScope,
    private readonly read: () => Promise<T>,
    private readonly release: () => void,
  ) {}

  public getSnapshot = (): QuerySnapshot<T> => this.snapshot;

  public subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.epoch++;
        this.stop?.();
        this.stop = undefined;
        this.snapshot = loading;
        // React may reattach immediately (StrictMode or a shared consumer).
        queueMicrotask(() => {
          if (!this.listeners.size) this.release();
        });
      }
    };
  };

  public retry = (): void => {
    if (!this.listeners.size) return;
    this.epoch++;
    this.stop?.();
    this.stop = undefined;
    this.publish(loading);
    this.start();
  };

  private start(): void {
    const epoch = ++this.epoch;
    try {
      this.stop = this.source.observe(this.scope, this.read, {
        next: (data) => {
          if (epoch === this.epoch)
            this.publish({ status: 'ready', data, error: undefined });
        },
        error: (error) => {
          if (epoch === this.epoch)
            this.publish({
              status: 'error',
              data: this.snapshot.data,
              error:
                error instanceof Error
                  ? error
                  : new Error('Could not read local data.'),
            });
        },
      });
    } catch (error) {
      this.publish({
        status: 'error',
        data: this.snapshot.data,
        error:
          error instanceof Error
            ? error
            : new Error('Could not observe local data.'),
      });
    }
  }

  private publish(snapshot: QuerySnapshot<T>): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}

/** Shares active scoped queries; persisted data remains owned by the repository. */
export class WorkspaceQueryStore {
  private readonly entries = new Map<string, QueryHandle<unknown>>();

  public constructor(
    private readonly reads: WorkspaceReadModel,
    private readonly source: QuerySource,
  ) {}

  public query<K extends QueryName>(
    name: K,
    ...args: QueryArguments<K>
  ): QueryHandle<QueryValue<K>> {
    const key = JSON.stringify([name, args]);
    const cached = this.entries.get(key);
    if (cached) return cached as QueryHandle<QueryValue<K>>;
    // The name and arguments are correlated by the public generic signature.
    const read = this.reads[name] as (
      ...values: QueryArguments<K>
    ) => Promise<QueryValue<K>>;
    const entry = new QueryEntry(
      this.source,
      { name, args } as QueryScope,
      () => read.apply(this.reads, args),
      () => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      },
    );
    this.entries.set(key, entry);
    return entry;
  }
}
