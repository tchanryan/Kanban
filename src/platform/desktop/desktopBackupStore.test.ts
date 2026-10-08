import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateBackup } from '../../domain/backup';
import { DesktopBackupStore } from './desktopBackupStore';
import { DesktopFiles } from './files';
import type { NativeTransport } from './transport';

const backup = () =>
  validateBackup(
    JSON.parse(
      readFileSync('native/workspace/tests/fixtures/portable-v1.json', 'utf8'),
    ),
  );
afterEach(() => {
  document.body.innerHTML = '';
});
function fixture(fail = false) {
  const ticket = crypto.randomUUID();
  const version = { generation: crypto.randomUUID(), revision: 5 };
  const invoke = vi.fn<NativeTransport['invoke']>(async (command) => {
    if (command === 'portable_preview') return { ticket, expected: version };
    if (command === 'portable_export') return backup();
    if (command === 'portable_import') {
      if (fail) throw Error('Workspace changed. Review again.');
      return { current: version };
    }
    throw Error('Unexpected native command');
  });
  const flushAll = vi.fn(async () => {});
  const reload = vi.fn();
  const store = new DesktopBackupStore(
    { invoke, listen: vi.fn() },
    { flushAll },
    reload,
  );
  return { store, invoke, flushAll, reload, ticket };
}
it('requires the exact reviewed contents and ticket, then flushes before native replacement', async () => {
  const { store, invoke, flushAll, reload } = fixture();
  const input = backup();
  await expect(store.replace(input)).rejects.toThrow('Review');
  const ticket = await store.preview(input);
  const altered = structuredClone(input);
  altered.scratchpads[0]!.content = 'Unreviewed';
  await expect(store.replace(altered, ticket)).rejects.toThrow('Review');
  await store.replace(input, ticket);
  expect(flushAll).toHaveBeenCalledOnce();
  expect(reload).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenLastCalledWith('portable_import', {
    ticket,
    confirmed: true,
  });
  await expect(store.replace(input, ticket)).rejects.toThrow('Review');
});
it('restores editing and requires another review after native conflict', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const { store, reload } = fixture(true);
  const input = backup();
  const ticket = await store.preview(input);
  await expect(store.replace(input, ticket)).rejects.toThrow(
    'Workspace changed',
  );
  expect(document.getElementById('root')!.inert).toBe(false);
  expect(reload).not.toHaveBeenCalled();
  await expect(store.replace(input, ticket)).rejects.toThrow('Review');
});
it('treats a cancelled or failed native file save as an unsuccessful delivery', async () => {
  const invoke = vi.fn<NativeTransport['invoke']>().mockResolvedValue(false);
  const files = new DesktopFiles({ invoke, listen: vi.fn() });
  await expect(files.download(backup())).rejects.toThrow('cancelled');
  invoke.mockRejectedValueOnce(Error('Disk full'));
  await expect(files.download(backup())).rejects.toThrow('Disk full');
  invoke.mockResolvedValueOnce(true);
  await expect(files.download(backup())).resolves.toBeUndefined();
});
