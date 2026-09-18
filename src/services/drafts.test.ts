import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  editDraft,
  flushDraft,
  flushDrafts,
  getDraft,
  withDiscardedDrafts,
  discardDrafts,
} from './drafts';
afterEach(() => discardDrafts('test-'));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
describe('draft concurrency', () => {
  it('retains the original save guard across replacement rerenders until explicitly rebased', async () => {
    const original = vi.fn().mockResolvedValue(undefined);
    const replacement = vi.fn().mockResolvedValue(undefined);
    editDraft('test-generation', 'First edit', original, 'Same stored text');
    editDraft(
      'test-generation',
      'Continued edit',
      replacement,
      'Same stored text',
    );
    await flushDraft('test-generation');
    expect(original).toHaveBeenCalledWith('Continued edit', 'Same stored text');
    expect(replacement).not.toHaveBeenCalled();
  });
  it('retains the original baseline across edits and external rerenders', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    editDraft('test-conflict', 'My first edit', save, 'Original');
    editDraft('test-conflict', 'My second edit', save, 'Other tab');
    await flushDraft('test-conflict');
    expect(save).toHaveBeenCalledWith('My second edit', 'Original');
  });
  it('serializes writes and updates the next baseline after its own save', async () => {
    const gate = deferred();
    const save = vi
      .fn()
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValue(undefined);
    editDraft('test-queue', 'First', save, 'Original');
    const first = flushDraft('test-queue');
    await Promise.resolve();
    editDraft('test-queue', 'Second', save, 'Original');
    const second = flushDraft('test-queue');
    gate.resolve();
    await Promise.all([first, second]);
    expect(save.mock.calls).toEqual([
      ['First', 'Original'],
      ['Second', 'First'],
    ]);
    expect(getDraft('test-queue')).toBeUndefined();
  });
  it('recovers after synchronous save failures instead of retaining a rejected pending promise', async () => {
    const save = vi
      .fn()
      .mockImplementationOnce(() => {
        throw Error('sync failure');
      })
      .mockResolvedValue(undefined);
    editDraft('test-sync', 'Draft', save);
    await expect(flushDraft('test-sync')).rejects.toThrow('sync failure');
    expect(getDraft('test-sync')?.text).toBe('Draft');
    await flushDraft('test-sync');
    expect(getDraft('test-sync')).toBeUndefined();
  });
  it('waits for in-flight writes and discards only confirmed deleted-item drafts', async () => {
    const gate = deferred();
    editDraft('test-delete-title', 'Text', () => gate.promise);
    const saving = flushDraft('test-delete-title');
    await Promise.resolve();
    const action = vi.fn().mockResolvedValue(undefined);
    const deleting = withDiscardedDrafts(['test-delete'], action);
    await Promise.resolve();
    expect(action).not.toHaveBeenCalled();
    gate.resolve();
    await saving;
    await deleting;
    expect(action).toHaveBeenCalledOnce();
    expect(getDraft('test-delete-title')).toBeUndefined();
  });
  it('retains failed drafts when permanent deletion fails', async () => {
    editDraft('test-delete-fail', 'Important', async () => {
      throw Error('disk full');
    });
    await expect(
      withDiscardedDrafts(['test-delete-fail'], async () => {
        throw Error('deletion failed');
      }),
    ).rejects.toThrow('deletion failed');
    expect(getDraft('test-delete-fail')?.text).toBe('Important');
    await expect(flushDrafts()).rejects.toThrow('disk full');
  });
});
