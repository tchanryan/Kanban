import { afterEach, expect, it, vi } from 'vitest';
import { DurableDrafts, type DraftRecord } from './durableDrafts';
import { CommitNotifications, type NativeTransport } from './transport';

afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  const generation = crypto.randomUUID();
  let journal: DraftRecord | undefined;
  let saved = '';
  let revision = 0;
  const invoke = vi.fn<NativeTransport['invoke']>(async (command, args) => {
    if (command === 'draft_list') return journal ? [journal] : [];
    if (command === 'draft_stage') {
      journal = { ...(args!.record as DraftRecord) };
      return journal.token;
    }
    if (command === 'draft_discard') {
      if (journal?.token === args!.token) journal = undefined;
      return null;
    }
    if (command === 'draft_commit') {
      if (
        !journal ||
        journal.token !== args!.token ||
        journal.generation !== generation ||
        saved !== journal.expected
      )
        throw Error('conflict');
      saved = journal.text;
      journal = undefined;
      return { value: null, version: { revision: ++revision, generation } };
    }
    throw Error('unexpected command');
  });
  const transport: NativeTransport = {
    invoke,
    listen: async () => () => undefined,
  };
  const drafts = new DurableDrafts(transport, new CommitNotifications());
  return {
    drafts,
    invoke,
    transport,
    generation,
    saved: () => saved,
    journal: () => journal,
  };
}
it('acknowledges recovery separately and restores pending text without automatically saving it', async () => {
  const f = fixture();
  f.drafts.edit('scratchpad-global', 'pending', '', 'Notes', f.generation);
  await f.drafts.retainAll();
  expect(f.drafts.get('scratchpad-global')?.recoveryState).toBe(
    'Recovery copy saved',
  );
  expect(f.saved()).toBe('');
  const reopened = new DurableDrafts(f.transport, new CommitNotifications());
  await reopened.load();
  await expect(reopened.flushAll()).rejects.toThrow('Review recovered');
  expect(f.saved()).toBe('');
  reopened.edit('scratchpad-global', 'pending', '', 'Notes', f.generation);
  await reopened.flushAll();
  expect(f.saved()).toBe('pending');
  expect(f.journal()).toBeUndefined();
});
it('preserves new typing during an in-flight save and rebases its journal after acknowledgement', async () => {
  const f = fixture();
  f.drafts.edit('scratchpad-global', 'first', '', 'Notes', f.generation);
  await f.drafts.retainAll();
  const original = f.invoke.getMockImplementation()!;
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.invoke.mockImplementation(async (command, args) => {
    if (command === 'draft_commit') {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return original(command, args);
  });
  const first = f.drafts.flush('scratchpad-global');
  await ready;
  f.drafts.edit('scratchpad-global', 'newer', '', 'Notes', f.generation);
  release();
  await first;
  await f.drafts.retainAll();
  expect(f.saved()).toBe('first');
  expect(f.journal()?.text).toBe('newer');
  expect(f.journal()?.expected).toBe('first');
  f.invoke.mockImplementation(original);
  await f.drafts.flushAll();
  expect(f.saved()).toBe('newer');
  expect(f.drafts.all()).toEqual([]);
});
it('keeps original generation on retry; explicit rebase accepts the current generation', async () => {
  const f = fixture();
  f.drafts.edit(
    'scratchpad-global',
    'old edit',
    '',
    'Notes',
    crypto.randomUUID(),
  );
  await expect(f.drafts.flushAll()).rejects.toThrow('conflict');
  f.drafts.edit('scratchpad-global', 'old edit', '', 'Notes', f.generation);
  await expect(f.drafts.flushAll()).rejects.toThrow('conflict');
  f.drafts.rebase('scratchpad-global', '', f.generation);
  await f.drafts.flushAll();
  expect(f.saved()).toBe('old edit');
});
it('explicit discard removes an older durable copy when the newest journal write failed', async () => {
  const f = fixture();
  f.drafts.edit('scratchpad-global', 'old', '', 'Notes', f.generation);
  await f.drafts.retainAll();
  f.invoke.mockRejectedValueOnce(Error('disk full'));
  f.drafts.edit('scratchpad-global', 'new', '', 'Notes', f.generation);
  await Promise.resolve();
  await f.drafts.discard('scratchpad-global');
  expect(f.journal()).toBeUndefined();
  expect(f.drafts.all()).toEqual([]);
});
