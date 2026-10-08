import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Database } from '../../db/database';
import { WorkspaceRepository } from '../../repositories/workspace';
import { DexieQuerySource } from './dexieQuerySource';
import { createWebServices } from './createWebServices';
import type { Item } from '../../domain/model';
import type { Unsubscribe } from '../../contracts/queries';

let database: Database;
let repository: WorkspaceRepository;
let item: Item;
const stops: Unsubscribe[] = [];
beforeEach(async () => {
  database = new Database(`query-source-${crypto.randomUUID()}`);
  repository = new WorkspaceRepository(database);
  const board = await repository.initialize();
  await repository.saveColumn(board.id, {
    name: 'Inbox',
    isDefaultNewItemColumn: true,
    startsWorkOnFirstEntry: false,
    completesItemOnEntry: false,
  });
  item = await repository.create(board.id, 'Original');
});
afterEach(async () => {
  stops.splice(0).forEach((stop) => stop());
  await database.delete();
});

it('reconciles a commit during the initial read before publishing a stale result', async () => {
  let release!: () => void;
  let started = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen: string[] = [];
  let first = true;
  // Start the writer in a separate event turn, outside Dexie's read context.
  const committed = new Promise<void>((resolve, reject) => {
    const write = (): void => {
      if (!started) {
        setTimeout(write, 0);
        return;
      }
      void repository
        .update(item.id, { title: 'Committed during read' })
        .then(() => {
          release();
          resolve();
        }, reject);
    };
    setTimeout(write, 0);
  });
  stops.push(
    new DexieQuerySource().observe(
      { name: 'item', args: [item.id] },
      async () => {
        const result = await repository.item(item.id);
        if (first) {
          first = false;
          started = true;
          await Promise.resolve(gate);
        }
        return result!.title;
      },
      {
        next: (title) => seen.push(title),
        error: (error) => {
          throw error;
        },
      },
    ),
  );
  await committed;
  await vi.waitFor(() => expect(seen).toContain('Committed during read'));
  expect(seen).not.toContain('Original');
});

it('refreshes after a second connection commits and never publishes a rolled-back value', async () => {
  const seen: string[] = [];
  stops.push(
    new DexieQuerySource().observe(
      { name: 'item', args: [item.id] },
      () => repository.item(item.id),
      {
        next: (value) => seen.push(value!.title),
        error: (error) => {
          throw error;
        },
      },
    ),
  );
  await vi.waitFor(() => expect(seen).toContain('Original'));
  const other = new Database(database.name);
  try {
    await expect(
      other.transaction('rw', other.items, async () => {
        await other.items.update(item.id, { title: 'Rolled back' });
        throw new Error('Rollback');
      }),
    ).rejects.toThrow('Rollback');
    await new WorkspaceRepository(other).update(item.id, {
      title: 'Other connection',
    });
    await vi.waitFor(() => expect(seen).toContain('Other connection'));
    expect(seen).not.toContain('Rolled back');
  } finally {
    other.close();
  }
});

it('keeps unrelated scopes quiet and refreshes editor generation after replacement', async () => {
  const services = createWebServices(database);
  const tags = services.queries.query('tags');
  const editor = services.queries.query('editorItem', item.id);
  const tagsChanged = vi.fn();
  stops.push(tags.subscribe(tagsChanged), editor.subscribe(vi.fn()));
  await vi.waitFor(() => expect(editor.getSnapshot().status).toBe('ready'));
  await vi.waitFor(() => expect(tags.getSnapshot().status).toBe('ready'));
  const previousGeneration = editor.getSnapshot().data!.generation;
  const tagPublications = tagsChanged.mock.calls.length;
  await services.workspace.update(item.id, { title: 'Changed' });
  await vi.waitFor(() =>
    expect(editor.getSnapshot().data?.item?.title).toBe('Changed'),
  );
  expect(tagsChanged).toHaveBeenCalledTimes(tagPublications);
  const backup = await services.backups.exportBackup();
  await services.backups.replaceBackup(backup, true);
  await vi.waitFor(() =>
    expect(editor.getSnapshot().data?.generation).not.toBe(previousGeneration),
  );
});

it('surfaces database closure instead of staying in loading indefinitely, then recovers on retry', async () => {
  database.close();
  const query = createWebServices(database).queries.query(
    'items',
    item.boardId,
  );
  stops.push(query.subscribe(vi.fn()));
  await vi.waitFor(() => expect(query.getSnapshot().status).toBe('error'));
  await database.open();
  query.retry();
  await vi.waitFor(() => expect(query.getSnapshot().status).toBe('ready'));
  expect(query.getSnapshot().data).toHaveLength(1);
});
