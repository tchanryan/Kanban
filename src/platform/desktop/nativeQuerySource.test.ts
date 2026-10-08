import { expect, it, vi } from 'vitest';
import { NativeQuerySource } from './nativeQuerySource';
import { CommitNotifications } from './transport';

it('drops an overtaken read, coalesces revision gaps and ignores delayed old events', async () => {
  const notifications = new CommitNotifications();
  const source = new NativeQuerySource(notifications);
  let resolve!: (value: string) => void;
  const read = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue('new');
  const observer = { next: vi.fn(), error: vi.fn() };
  const stop = source.observe({ name: 'tags', args: [] }, read, observer);
  const generation = crypto.randomUUID();
  notifications.publish({ revision: 5, generation });
  notifications.publish({ revision: 9, generation });
  resolve('stale');
  await vi.waitFor(() => expect(observer.next).toHaveBeenCalledWith('new'));
  expect(observer.next).not.toHaveBeenCalledWith('stale');
  expect(read).toHaveBeenCalledTimes(2);
  notifications.publish({ revision: 8, generation });
  expect(read).toHaveBeenCalledTimes(2);
  notifications.publish({ revision: 0, generation: crypto.randomUUID() });
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  stop();
  notifications.publish({ revision: 20, generation });
  expect(read).toHaveBeenCalledTimes(3);
});

it('surfaces failed reads and recovers on the next commit', async () => {
  const notifications = new CommitNotifications();
  const source = new NativeQuerySource(notifications);
  const error = Error('locked');
  const read = vi.fn().mockRejectedValueOnce(error).mockResolvedValue([]);
  const observer = { next: vi.fn(), error: vi.fn() };
  const stop = source.observe({ name: 'tags', args: [] }, read, observer);
  await vi.waitFor(() => expect(observer.error).toHaveBeenCalledWith(error));
  notifications.publish({ revision: 3, generation: crypto.randomUUID() });
  await vi.waitFor(() => expect(observer.next).toHaveBeenCalledWith([]));
  stop();
});
