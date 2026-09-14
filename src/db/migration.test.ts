import Dexie from 'dexie';
import { it, expect } from 'vitest';
import { Database } from './database';
import { WorkspaceRepository } from '../repositories/workspace';
import { newMeta } from '../domain/model';
it('migrates version 1 records into the active index without losing archived work', async () => {
  const name = `migration-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(1).stores({
    boards: 'id,kind,&projectId',
    columns: 'id,boardId,[boardId+orderKey]',
    items:
      'id,boardId,columnId,parentProjectId,archivedAt,archiveAfter,kind,[boardId+columnId]',
    events: 'id,itemId,[itemId+occurredAt]',
    tags: 'id,name',
    relations: '[itemId+tagId],itemId,tagId',
    scratchpads: 'id',
    settings: 'id',
    snapshots: 'id,createdAt',
  });
  const board = {
    ...newMeta(),
    kind: 'root',
    projectId: null,
    name: 'Dashboard',
  };
  const col = {
    ...newMeta(),
    boardId: board.id,
    name: 'Inbox',
    orderKey: 'a0',
    isDefaultNewItemColumn: true,
    startsWorkOnFirstEntry: false,
    completesItemOnEntry: false,
  };
  const item = {
    ...newMeta(),
    boardId: board.id,
    columnId: col.id,
    kind: 'task',
    parentProjectId: null,
    title: 'Preserved',
    description: 'Notes',
    priority: 'medium',
    plannedStartDate: null,
    dueDate: null,
    firstStartedAt: null,
    completedAt: null,
    archivedAt: null,
    archiveAfter: null,
    orderKey: 'a0',
    projectColorToken: null,
  };
  await old.table('boards').add(board);
  await old.table('columns').add(col);
  await old.table('items').bulkAdd([
    item,
    {
      ...item,
      id: crypto.randomUUID(),
      archivedAt: new Date().toISOString(),
    },
  ]);
  old.close();
  const upgraded = new Database(name);
  try {
    await upgraded.open();
    const repo = new WorkspaceRepository(upgraded);
    expect(await upgraded.items.count()).toBe(2);
    expect((await repo.items(board.id)).map((x) => x.title)).toEqual([
      'Preserved',
    ]);
    expect(await upgraded.snapshots.count()).toBe(2);
    expect((await upgraded.items.get(item.id))?.description).toBe('Notes');
  } finally {
    await upgraded.delete();
  }
});
