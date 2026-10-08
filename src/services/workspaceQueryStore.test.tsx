import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import type {
  QueryObserver,
  QueryScope,
  QuerySource,
  Unsubscribe,
  WorkspaceReadModel,
} from '../contracts/queries';
import { WorkspaceQueryStore } from './workspaceQueryStore';
import { useQuery } from '../components/useQuery';
import { QueryStatus } from '../components/QueryStatus';
import type { Board } from '../domain/model';

class ControlledSource implements QuerySource {
  public readonly observers: QueryObserver<unknown>[] = [];
  public readonly stop = vi.fn();
  public observe<T>(
    _scope: QueryScope,
    _read: () => Promise<T>,
    observer: QueryObserver<T>,
  ): Unsubscribe {
    this.observers.push(observer as QueryObserver<unknown>);
    return this.stop;
  }
}
const reads = { board: async () => undefined } as unknown as WorkspaceReadModel;
afterEach(cleanup);

it('shares one active scoped subscription and retires it only after the last listener leaves', async () => {
  const source = new ControlledSource();
  const store = new WorkspaceQueryStore(reads, source);
  const first = store.query('board', 'one');
  const a = first.subscribe(vi.fn());
  const second = store.query('board', 'one');
  const b = second.subscribe(vi.fn());
  expect(second).toBe(first);
  expect(source.observers).toHaveLength(1);
  source.observers[0]!.next(undefined);
  expect(first.getSnapshot()).toEqual({
    status: 'ready',
    data: undefined,
    error: undefined,
  });
  a();
  expect(source.stop).not.toHaveBeenCalled();
  b();
  expect(source.stop).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(store.query('board', 'one')).not.toBe(first);
});

it('shows a recoverable error, retries and rejects callbacks from the retired subscription', () => {
  const source = new ControlledSource();
  const store = new WorkspaceQueryStore(reads, source);
  function View() {
    const state = useQuery(store.query('board', 'one'));
    return (
      <>
        <QueryStatus queries={[state]} label="board" />
        {state.status === 'ready' && (
          <p>{state.data?.name ?? 'Board missing'}</p>
        )}
      </>
    );
  }
  render(<View />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading board');
  act(() => source.observers[0]!.error(new Error('storage unavailable')));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'saved data has not been cleared',
  );
  expect(screen.queryByText('Board missing')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry board' }));
  act(() => source.observers[1]!.next({ name: 'Recovered' }));
  act(() => source.observers[0]!.next({ name: 'Late old result' }));
  expect(screen.getByText('Recovered')).toBeInTheDocument();
  expect(screen.queryByText('Late old result')).not.toBeInTheDocument();
});

it('never presents old-key data after navigation and cleans up in StrictMode', () => {
  const source = new ControlledSource();
  const store = new WorkspaceQueryStore(reads, source);
  function View({ id }: { id: string }) {
    const state = useQuery(store.query('board', id));
    return (
      <>
        <QueryStatus queries={[state]} label="board" />
        {state.status === 'ready' && <p>{state.data?.name}</p>}
      </>
    );
  }
  const view = render(
    <StrictMode>
      <View id="a" />
    </StrictMode>,
  );
  const old = source.observers.at(-1)!;
  act(() => old.next({ name: 'A' } as Board));
  expect(screen.getByText('A')).toBeInTheDocument();
  view.rerender(
    <StrictMode>
      <View id="b" />
    </StrictMode>,
  );
  expect(screen.queryByText('A')).not.toBeInTheDocument();
  const latest = source.observers.at(-1)!;
  act(() => latest.next({ name: 'B' }));
  act(() => old.error(new Error('obsolete failure')));
  expect(screen.getByText('B')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  view.unmount();
  expect(source.stop).toHaveBeenCalledTimes(source.observers.length);
});
