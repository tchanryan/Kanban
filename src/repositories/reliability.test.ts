import { afterEach, beforeEach, expect, it } from 'vitest';
import { Database } from '../db/database';
import { WorkspaceRepository } from './workspace';
import {
  exportBackup,
  replaceBackup,
  validateBackup,
} from '../services/backups';
import { generateNKeysBetween } from 'fractional-indexing';
let db: Database, repo: WorkspaceRepository, boardId: string;
beforeEach(async () => {
  db = new Database(`reliability-${crypto.randomUUID()}`);
  repo = new WorkspaceRepository(db);
  boardId = (await repo.initialize()).id;
  await repo.saveColumn(boardId, {
    name: 'Inbox',
    isDefaultNewItemColumn: true,
    startsWorkOnFirstEntry: false,
    completesItemOnEntry: false,
  });
});
afterEach(async () => db.delete());
it('rejects stale field edits while allowing unrelated metadata changes', async () => {
  const item = await repo.create(boardId, 'Original');
  await repo.update(item.id, { priority: 'high' });
  await repo.update(item.id, { title: 'Other tab' }, { title: 'Original' });
  await expect(
    repo.update(item.id, { title: 'Stale overwrite' }, { title: 'Original' }),
  ).rejects.toThrow('another tab');
  expect((await repo.item(item.id))?.title).toBe('Other tab');
  await repo.update(
    item.id,
    { description: 'Separate field' },
    { description: '' },
  );
  expect((await repo.item(item.id))?.priority).toBe('high');
  await repo.saveScratch('First tab', '');
  await expect(repo.saveScratch('Second tab', '')).rejects.toThrow(
    'another tab',
  );
  expect((await repo.scratch())?.content).toBe('First tab');
});
it('paginates the entire archive in completion order with stable tie-breaking', async () => {
  const base = await repo.create(boardId, 'Fixture');
  await db.items.delete(base.id);
  await db.events.clear();
  const keys = generateNKeysBetween(null, null, 230);
  const records = keys.map((orderKey, i) => ({
    ...base,
    id: crypto.randomUUID(),
    title: `Archive ${i}`,
    orderKey,
    completedAt: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
    archivedAt: new Date(Date.UTC(2026, 0, 230 - i)).toISOString(),
  }));
  await db.items.bulkAdd(records);
  let page = await repo.archivePage('', null, 50);
  expect(page.items[0]?.title).toBe('Archive 229');
  const all = [...page.items];
  while (page.nextCursor) {
    page = await repo.archivePage('', page.nextCursor, 50);
    all.push(...page.items);
  }
  expect(all).toHaveLength(230);
  expect(new Set(all.map((x) => x.id)).size).toBe(230);
  expect(all.at(-1)?.title).toBe('Archive 0');
  await repo.restore(records[229]!.id);
  expect((await repo.archivePage()).items[0]?.title).toBe('Archive 228');
});
it('rolls back replacement and its snapshot when a write fails', async () => {
  const item = await repo.create(boardId, 'Original');
  const backup = await exportBackup(db);
  backup.items[0]!.title = 'Replacement';
  const fail = () => {
    throw Error('simulated disk failure');
  };
  db.items.hook('creating', fail);
  await expect(replaceBackup(backup, true, db)).rejects.toThrow(
    'simulated disk failure',
  );
  db.items.hook('creating').unsubscribe(fail);
  expect((await repo.item(item.id))?.title).toBe('Original');
  expect(await db.snapshots.count()).toBe(0);
  expect(await db.generation()).toBe('initial');
});

it('rejects edits from another connection after replacement even when original text is unchanged', async () => {
  const item = await repo.create(boardId, 'Same title');
  await repo.saveScratch('Same notes');
  const otherDatabase = new Database(db.name);
  const other = new WorkspaceRepository(otherDatabase);
  try {
    const editor = await other.editorItem(item.id);
    const notes = await other.editorScratch();
    await replaceBackup(await exportBackup(db), true, db);
    await expect(
      other.update(
        item.id,
        { description: 'Old draft' },
        { description: '' },
        editor.generation,
      ),
    ).rejects.toThrow('restore');
    await expect(
      other.saveScratch('Old notes', 'Same notes', notes.generation),
    ).rejects.toThrow('restore');
    expect((await repo.item(item.id))?.description).toBe('');
    expect((await repo.scratch())?.content).toBe('Same notes');
    const current = await other.editorItem(item.id);
    await other.update(
      item.id,
      { description: 'Reviewed draft' },
      { description: '' },
      current.generation,
    );
    expect((await repo.item(item.id))?.description).toBe('Reviewed draft');
  } finally {
    otherDatabase.close();
  }
});
it('caps snapshots and rejects malformed references without partial changes', async () => {
  await repo.create(boardId, 'Keep');
  const backup = await exportBackup(db);
  for (let i = 0; i < 7; i++) await replaceBackup(backup, true, db);
  expect(await db.snapshots.count()).toBe(5);
  const broken = structuredClone(backup);
  broken.relations.push({
    itemId: broken.items[0]!.id,
    tagId: crypto.randomUUID(),
  });
  expect(() => validateBackup(broken)).toThrow('association');
  const order = structuredClone(backup);
  order.items[0]!.orderKey = 'invalid';
  expect(() => validateBackup(order)).toThrow();
  expect((await repo.items(boardId))[0]?.title).toBe('Keep');
});
