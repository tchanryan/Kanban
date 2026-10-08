import type { WorkspaceQueries, RecoverySnapshot } from './workspace';

export interface WorkspaceReadModel extends WorkspaceQueries {
  snapshots(): Promise<RecoverySnapshot[]>;
}
export type QueryName = keyof WorkspaceReadModel;
export type QueryArguments<K extends QueryName> = Parameters<
  WorkspaceReadModel[K]
>;
export type QueryValue<K extends QueryName> = Awaited<
  ReturnType<WorkspaceReadModel[K]>
>;
export type Unsubscribe = () => void;
export type QueryScope = {
  [K in QueryName]: { name: K; args: QueryArguments<K> };
}[QueryName];

export interface QueryObserver<T> {
  next(value: T): void;
  error(error: unknown): void;
}

/** Observe committed results, reconciling changes during reads before publication.
 * Native sources must reconcile revision gaps and generation changes here.
 */
export interface QuerySource {
  observe<T>(
    scope: QueryScope,
    read: () => Promise<T>,
    observer: QueryObserver<T>,
  ): Unsubscribe;
}

export type QuerySnapshot<T> =
  | { status: 'loading'; data: undefined; error: undefined }
  | { status: 'ready'; data: T; error: undefined }
  | { status: 'error'; data: T | undefined; error: Error };

export interface QueryHandle<T> {
  getSnapshot(): QuerySnapshot<T>;
  subscribe(listener: () => void): Unsubscribe;
  retry(): void;
}
