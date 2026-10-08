import { afterEach, beforeEach, expect, it } from 'vitest';
import { Database } from '../db/database';
import { createWebServices } from '../platform/web/createWebServices';
import type { ApplicationServices } from '../app/createServices';
import { discardDrafts, editDraft, getDraft } from './drafts';
import { validateBackup } from '../domain/backup';
import { createServices } from '../app/createServices';
import { DexieBackupStore } from '../repositories/dexieBackupStore';
import { DexieQuerySource } from '../platform/web/dexieQuerySource';

let database: Database;
let services: ApplicationServices;
let itemId: string;
const draftKey = 'test-service-boundary-title';
beforeEach(async () => {
  database = new Database(`service-boundary-${crypto.randomUUID()}`);
  services = createWebServices(database);
  const board = await services.workspace.initialize();
  await services.workspace.saveColumn(board.id, {
    name: 'Inbox',
    isDefaultNewItemColumn: true,
    startsWorkOnFirstEntry: false,
    completesItemOnEntry: false,
  });
  itemId = (await services.workspace.create(board.id, 'Original')).id;
});
afterEach(async () => {
  discardDrafts('test-service-boundary');
  await database.delete();
});

it('preserves a stateful platform confirmation receiver through dependency injection', async () => {
  const platform = services.platform;
  platform.confirm = async function (): Promise<boolean> {
    expect(this).toBe(platform);
    return false;
  };
  const composed = createServices(
    services.workspace,
    new DexieBackupStore(database),
    platform,
    new DexieQuerySource(),
  );
  await composed.workItemActions.deleteFromTile(
    (await services.workspace.item(itemId))!,
  );
  expect(await services.workspace.item(itemId)).toBeDefined();
});

it('exports committed pending drafts through the composed application services', async () => {
  editDraft(
    draftKey,
    'Pending edit',
    async (title) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      await services.workspace.update(itemId, { title });
    },
    'Original',
  );
  const exported = await services.backups.exportBackup();
  expect(exported.items[0]?.title).toBe('Pending edit');
});

it('captures flushed drafts in the atomic safety snapshot before replacement', async () => {
  const replacement = await services.backups.exportBackup();
  replacement.items[0]!.title = 'Imported';
  editDraft(
    draftKey,
    'Recover this edit',
    async (title) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      await services.workspace.update(itemId, { title });
    },
    'Original',
  );
  await services.backups.replaceBackup(replacement, true);
  expect((await services.workspace.item(itemId))?.title).toBe('Imported');
  const snapshots = await services.backups.snapshots();
  expect(snapshots).toHaveLength(1);
  expect(
    validateBackup(JSON.parse(snapshots[0]!.payload)).items[0]?.title,
  ).toBe('Recover this edit');
});

it('retains failed drafts and blocks export and replacement without touching storage', async () => {
  const replacement = await services.backups.exportBackup();
  editDraft(
    draftKey,
    'Unsaved edit',
    async () => {
      throw Error('Save unavailable');
    },
    'Original',
  );
  await expect(services.backups.exportBackup()).rejects.toThrow();
  await expect(
    services.backups.replaceBackup(replacement, true),
  ).rejects.toThrow();
  expect(getDraft(draftKey)?.text).toBe('Unsaved edit');
  expect((await services.workspace.item(itemId))?.title).toBe('Original');
  expect(await services.backups.snapshots()).toEqual([]);
});
