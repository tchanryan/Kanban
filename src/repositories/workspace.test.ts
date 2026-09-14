import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { Database } from '../db/database';
import { WorkspaceRepository } from './workspace';
import {
  exportBackup,
  replaceBackup,
  validateBackup,
} from '../services/backups';
import { overdue, range, type Column } from '../domain/model';
let db: Database;
let repo: WorkspaceRepository;
let boardId: string;
async function column(name: string, flags: Partial<Column> = {}) {
  return repo.saveColumn(boardId, {
    name,
    isDefaultNewItemColumn: false,
    startsWorkOnFirstEntry: false,
    completesItemOnEntry: false,
    ...flags,
  });
}
beforeEach(async () => {
  db = new Database(`test-${crypto.randomUUID()}`);
  repo = new WorkspaceRepository(db);
  boardId = (await repo.initialize()).id;
});
afterEach(async () => db.delete());
describe('transactional workspace', () => {
  it('starts empty, initializes idempotently and survives database reopen', async () => {
    await repo.initialize();
    expect(await db.boards.count()).toBe(1);
    expect(await repo.columns(boardId)).toEqual([]);
    const c = await column('Inbox');
    expect(c.isDefaultNewItemColumn).toBe(true);
    const item = await repo.create(boardId, 'Capture');
    db.close();
    await db.open();
    expect((await repo.item(item.id))?.title).toBe('Capture');
    expect(db.verno).toBe(3);
  });
  it('tracks first start, completion, reopen and recompletion without fabricated starts', async () => {
    const inbox = await column('Inbox');
    const active = await column('Working', { startsWorkOnFirstEntry: true });
    const done = await column('Finished', { completesItemOnEntry: true });
    const item = await repo.create(boardId, 'Deliver');
    expect(item.firstStartedAt).toBeNull();
    const started = await repo.move(item.id, active.id);
    const completed = await repo.move(item.id, done.id);
    expect(completed.archiveAfter).not.toBeNull();
    const reopened = await repo.move(item.id, inbox.id);
    expect(reopened.firstStartedAt).toBe(started.firstStartedAt);
    expect(reopened.completedAt).toBeNull();
    expect(reopened.archiveAfter).toBeNull();
    await repo.move(item.id, done.id);
    expect(
      (await repo.history(item.id))
        .map((x) => x.type)
        .filter((x) => x === 'completed'),
    ).toHaveLength(2);
    const direct = await repo.create(boardId, 'Direct');
    expect((await repo.move(direct.id, done.id)).firstStartedAt).toBeNull();
  });
  it('clones project columns independently and protects manual completion', async () => {
    const inbox = await column('Inbox');
    const done = await column('Done', { completesItemOnEntry: true });
    const project = await repo.create(boardId, 'Launch', 'project');
    const childBoard = (await repo.projectBoard(project.id))!;
    const cloned = await repo.columns(childBoard.id);
    expect(cloned.map((x) => x.name)).toEqual(['Inbox', 'Done']);
    expect(cloned[0]!.id).not.toBe(inbox.id);
    await repo.saveColumn(boardId, { ...inbox, name: 'Changed' }, inbox.id);
    expect((await repo.columns(childBoard.id))[0]!.name).toBe('Inbox');
    const child = await repo.create(childBoard.id, 'Child');
    await expect(
      repo.create(childBoard.id, 'Nested', 'project'),
    ).rejects.toThrow();
    await expect(repo.move(project.id, done.id)).rejects.toThrow(
      'Confirm completion',
    );
    expect((await repo.item(project.id))?.completedAt).toBeNull();
    await repo.move(project.id, done.id, null, true);
    expect((await repo.item(child.id))?.completedAt).toBeNull();
    await repo.move(child.id, cloned[1]!.id);
    expect((await repo.item(child.id))?.archiveAfter).toBeNull();
  });
  it('rejects deletion without destination and migrates cards atomically', async () => {
    const a = await column('A');
    const b = await column('B', { startsWorkOnFirstEntry: true });
    const item = await repo.create(boardId, 'Work');
    await expect(repo.deleteColumn(a.id, null, true)).rejects.toThrow();
    expect((await repo.item(item.id))?.columnId).toBe(a.id);
    await repo.deleteColumn(a.id, b.id, true);
    expect((await repo.item(item.id))?.columnId).toBe(b.id);
    expect((await repo.columns(boardId))[0]!.isDefaultNewItemColumn).toBe(true);
    expect((await repo.history(item.id)).map((x) => x.type)).toContain('moved');
  });
  it('rolls back an entire operation if history persistence fails', async () => {
    await column('A');
    const b = await column('B');
    const item = await repo.create(boardId, 'Atomic');
    const before = await repo.item(item.id);
    const fail = () => {
      throw Error('Simulated disk failure');
    };
    db.events.hook('creating', fail);
    await expect(repo.move(item.id, b.id)).rejects.toThrow();
    db.events.hook('creating').unsubscribe(fail);
    expect(await repo.item(item.id)).toEqual(before);
  });
  it('archives overdue completed work idempotently, restores with a fresh grace period', async () => {
    await column('A');
    const done = await column('Done', { completesItemOnEntry: true });
    const item = await repo.create(boardId, 'Old');
    await repo.move(item.id, done.id);
    await db.items.update(item.id, {
      archiveAfter: '2020-01-01T00:00:00.000Z',
    });
    await repo.maintain();
    await repo.maintain();
    expect(
      (await repo.history(item.id)).filter((x) => x.type === 'archived'),
    ).toHaveLength(1);
    await repo.restore(item.id);
    await repo.maintain();
    expect((await repo.item(item.id))?.archivedAt).toBeNull();
  });
  it('cascades project deletion across child boards, tags and history', async () => {
    await column('A');
    const project = await repo.create(boardId, 'P', 'project');
    const b = (await repo.projectBoard(project.id))!;
    const child = await repo.create(b.id, 'C');
    const tag = await repo.saveTag('Work', 'blue');
    await repo.setTag(child.id, tag.id, true);
    await expect(repo.deleteItem(project.id)).rejects.toThrow();
    await repo.deleteItem(project.id, true);
    expect(await db.items.count()).toBe(0);
    expect(await db.events.count()).toBe(0);
    expect(await db.relations.count()).toBe(0);
    expect(await db.boards.count()).toBe(1);
    expect(await db.tags.count()).toBe(1);
  });
  it('preserves stable manual order and tag uniqueness', async () => {
    const c = await column('A');
    const a = await repo.create(boardId, 'A');
    const b = await repo.create(boardId, 'B');
    const d = await repo.create(boardId, 'D');
    await repo.move(d.id, c.id, a.id);
    expect((await repo.items(boardId)).map((x) => x.title)).toEqual([
      'D',
      'A',
      'B',
    ]);
    await repo.move(d.id, c.id, null);
    expect((await repo.items(boardId)).map((x) => x.id)).toEqual([
      a.id,
      b.id,
      d.id,
    ]);
    await repo.saveTag(' Work ', 'teal');
    await expect(repo.saveTag('work', 'blue')).rejects.toThrow('unique');
  });
  it('validates imports before replacement, snapshots, and restores all data', async () => {
    await column('A');
    const item = await repo.create(boardId, 'Keep');
    await repo.saveScratch('Private notes');
    const backup = await exportBackup(db);
    expect(validateBackup(backup).items[0]!.title).toBe('Keep');
    const broken = structuredClone(backup);
    broken.items[0]!.boardId = crypto.randomUUID();
    await expect(replaceBackup(broken, true, db)).rejects.toThrow();
    expect(await repo.item(item.id)).toEqual(item);
    await repo.update(item.id, { title: 'Changed' });
    await replaceBackup(backup, true, db);
    expect((await repo.item(item.id))?.title).toBe('Keep');
    expect((await repo.scratch())?.content).toBe('Private notes');
    expect(await db.snapshots.count()).toBe(1);
    const duplicate = structuredClone(backup);
    duplicate.items.push(duplicate.items[0]!);
    expect(() => validateBackup(duplicate)).toThrow('Duplicate');
  });
  it('handles date-only overdue and honest open-ended calendar ranges', async () => {
    await column('A');
    const item = await repo.create(boardId, 'Dates');
    const planned = await repo.update(item.id, {
      plannedStartDate: '2026-09-01',
      dueDate: '2026-09-14',
    });
    expect(overdue(planned, '2026-09-14')).toBe(false);
    expect(overdue(planned, '2026-09-15')).toBe(true);
    await expect(
      repo.update(item.id, { dueDate: '2026-08-01' }),
    ).rejects.toThrow();
    expect(range(item, 'actual')?.label).toContain('fallback');
    expect(range(item, 'planned')).toBeNull();
    expect(
      range({ ...item, plannedStartDate: '2026-09-01' }, 'planned'),
    ).toMatchObject({ start: '2026-09-01', end: '2026-09-01', open: true });
  });
});
