import { expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { Database } from '../db/database';
import { WorkspaceRepository } from './workspace';
import { generateKeyBetween } from 'fractional-indexing';

type Step = {
  kind: 'command' | 'query';
  name: string;
  args?: Record<string, unknown> | undefined;
  idCounter: number;
  now: string;
  value?: unknown;
  error?: boolean;
};

it('preserves the shared native contract fixtures against the real Dexie adapter', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
  let idCounter = 0;
  const id = (): `${string}-${string}-${string}-${string}-${string}` =>
    `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(id);
  const database = new Database('native-contract-oracle');
  const repo = new WorkspaceRepository(database);
  const steps: Step[] = [];
  async function step<T>(
    kind: Step['kind'],
    name: string,
    args: Record<string, unknown> | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    const entry: Step = {
      kind,
      name,
      args,
      idCounter,
      now: new Date().toISOString(),
    };
    try {
      const value = await run();
      entry.value = JSON.parse(
        JSON.stringify(value, (key, value) =>
          ['activeBoardId', 'archiveSortAt'].includes(key)
            ? undefined
            : value === undefined
              ? null
              : value,
        ),
      );
      steps.push(entry);
      return value;
    } catch (error) {
      entry.error = true;
      steps.push(entry);
      throw error;
    }
  }
  const c = <T>(
    name: string,
    args: Record<string, unknown> | undefined,
    run: () => Promise<T>,
  ) => step('command', name, args, run);
  const q = <T>(
    name: string,
    args: Record<string, unknown> | undefined,
    run: () => Promise<T>,
  ) => step('query', name, args, run);
  try {
    await database.delete();
    await database.open();
    const root = await c('initialize', undefined, () => repo.initialize());
    await c('initialize', undefined, () => repo.initialize());
    await q('root', undefined, () => repo.root());
    await q('board', { id: root.id }, () => repo.board(root.id));
    const input = (
      name: string,
      isDefault = false,
      starts = false,
      completes = false,
    ) => ({
      name,
      isDefaultNewItemColumn: isDefault,
      startsWorkOnFirstEntry: starts,
      completesItemOnEntry: completes,
    });
    const inboxInput = input(' Inbox ', true);
    const inbox = await c(
      'saveColumn',
      { boardId: root.id, input: inboxInput },
      () => repo.saveColumn(root.id, inboxInput),
    );
    const doingInput = input('Doing', false, true);
    const doing = await c(
      'saveColumn',
      { boardId: root.id, input: doingInput },
      () => repo.saveColumn(root.id, doingInput),
    );
    const doneInput = input('Done', false, false, true);
    const done = await c(
      'saveColumn',
      { boardId: root.id, input: doneInput },
      () => repo.saveColumn(root.id, doneInput),
    );
    await expect(
      c('saveColumn', { boardId: root.id, input: input('inbox') }, () =>
        repo.saveColumn(root.id, input('inbox')),
      ),
    ).rejects.toThrow();
    await c('reorderColumn', { id: done.id, beforeId: doing.id }, () =>
      repo.reorderColumn(done.id, doing.id),
    );
    await q('columns', { boardId: root.id }, () => repo.columns(root.id));
    const project = await c(
      'create',
      { boardId: root.id, title: 'Project', kind: 'project' },
      () => repo.create(root.id, 'Project', 'project'),
    );
    const board = (await q('projectBoard', { id: project.id }, () =>
      repo.projectBoard(project.id),
    ))!;
    const columns = await q('columns', { boardId: board.id }, () =>
      repo.columns(board.id),
    );
    const child = await c(
      'create',
      { boardId: board.id, title: 'Child', kind: 'task' },
      () => repo.create(board.id, 'Child'),
    );
    await expect(
      c('create', { boardId: board.id, title: 'Nested', kind: 'project' }, () =>
        repo.create(board.id, 'Nested', 'project'),
      ),
    ).rejects.toThrow();
    const task = await c(
      'create',
      { boardId: root.id, title: ' Task ', kind: 'task', columnId: inbox.id },
      () => repo.create(root.id, ' Task ', 'task', inbox.id),
    );
    await q('item', { id: task.id }, () => repo.item(task.id));
    await q('items', { boardId: root.id }, () => repo.items(root.id));
    await q('children', { id: project.id }, () => repo.children(project.id));
    await expect(
      c('restore', { id: child.id }, () => repo.restore(child.id)),
    ).rejects.toThrow();
    await q('editorItem', { id: task.id }, () => repo.editorItem(task.id));
    const patch = {
      title: 'Updated',
      description: 'Some notes',
      priority: 'high' as const,
      plannedStartDate: '2026-01-01',
      dueDate: '2026-01-02',
      projectColorToken: null,
    };
    await c(
      'update',
      {
        id: task.id,
        patch,
        expected: { title: 'Task' },
        generation: 'initial',
      },
      () => repo.update(task.id, patch, { title: 'Task' }, 'initial'),
    );
    await expect(
      c(
        'update',
        { id: task.id, patch: { title: 'Stale' }, expected: { title: 'Task' } },
        () => repo.update(task.id, { title: 'Stale' }, { title: 'Task' }),
      ),
    ).rejects.toThrow();
    await expect(
      c('update', { id: task.id, patch: { dueDate: '2025-01-01' } }, () =>
        repo.update(task.id, { dueDate: '2025-01-01' }),
      ),
    ).rejects.toThrow();
    await c(
      'update',
      { id: task.id, patch: { plannedStartDate: null, dueDate: null } },
      () => repo.update(task.id, { plannedStartDate: null, dueDate: null }),
    );
    for (const columnId of [doing.id, done.id, inbox.id])
      await c(
        'move',
        { id: task.id, columnId, beforeId: null, confirmed: false },
        () => repo.move(task.id, columnId),
      );
    await c(
      'move',
      {
        id: task.id,
        columnId: inbox.id,
        beforeId: project.id,
        confirmed: false,
      },
      () => repo.move(task.id, inbox.id, project.id),
    );
    await q('history', { id: task.id }, () => repo.history(task.id));
    await expect(
      c(
        'move',
        { id: project.id, columnId: done.id, beforeId: null, confirmed: false },
        () => repo.move(project.id, done.id),
      ),
    ).rejects.toThrow();
    await c(
      'move',
      {
        id: child.id,
        columnId: columns[2]!.id,
        beforeId: null,
        confirmed: false,
      },
      () => repo.move(child.id, columns[2]!.id),
    );
    await c(
      'move',
      { id: project.id, columnId: done.id, beforeId: null, confirmed: false },
      () => repo.move(project.id, done.id),
    );
    const tag = await c(
      'saveTag',
      { name: ' ÉCOLE ', colorToken: 'teal' },
      () => repo.saveTag(' ÉCOLE ', 'teal'),
    );
    await expect(
      c('saveTag', { name: 'école', colorToken: 'blue' }, () =>
        repo.saveTag('école', 'blue'),
      ),
    ).rejects.toThrow();
    await c('setTag', { itemId: task.id, tagId: tag.id, selected: true }, () =>
      repo.setTag(task.id, tag.id, true),
    );
    await q('tags', undefined, () => repo.tags());
    await q('itemTags', { id: task.id }, () => repo.itemTags(task.id));
    await q('boardTagRelations', { boardId: root.id }, () =>
      repo.boardTagRelations(root.id),
    );
    for (const query of ['école', 'notes', ''])
      await q('search', { query, archived: false }, () => repo.search(query));
    for (const includeStandaloneTasks of [false, true])
      await q('calendarItems', { includeStandaloneTasks }, () =>
        repo.calendarItems(includeStandaloneTasks),
      );
    await q('scratch', undefined, () => repo.scratch());
    await c(
      'saveScratch',
      { content: 'Notes', expected: '', generation: 'initial' },
      () => repo.saveScratch('Notes', '', 'initial'),
    );
    await expect(
      c('saveScratch', { content: 'Conflict', expected: '' }, () =>
        repo.saveScratch('Conflict', ''),
      ),
    ).rejects.toThrow();
    await q('editorScratch', undefined, () => repo.editorScratch());
    await q('settings', undefined, () => repo.settings());
    const settingsPatch = {
      calendarShowTopLevelTasks: true,
      calendarMode: 'compare' as const,
    };
    await c('saveSettings', { patch: settingsPatch }, () =>
      repo.saveSettings(settingsPatch),
    );
    await q('settings', undefined, () => repo.settings());
    await expect(
      c('archive', { id: child.id, confirmed: true }, () =>
        repo.archive(child.id, true),
      ),
    ).rejects.toThrow();
    await expect(
      c('archive', { id: task.id, confirmed: false }, () =>
        repo.archive(task.id),
      ),
    ).rejects.toThrow();
    await c('archive', { id: task.id, confirmed: true }, () =>
      repo.archive(task.id, true),
    );
    vi.setSystemTime(new Date('2026-01-16T12:00:00.000Z'));
    await c('maintain', undefined, () => repo.maintain());
    await q('search', { query: 'child', archived: false }, () =>
      repo.search('child'),
    );
    await q('search', { query: 'child', archived: true }, () =>
      repo.search('child', true),
    );
    const first = await q(
      'archivePage',
      { query: '', cursor: null, limit: 1 },
      () => repo.archivePage('', null, 1),
    );
    await q(
      'archivePage',
      { query: '', cursor: first.nextCursor, limit: 1 },
      () => repo.archivePage('', first.nextCursor, 1),
    );
    await c('restore', { id: task.id }, () => repo.restore(task.id));
    await c(
      'deleteColumn',
      { id: doing.id, destinationId: inbox.id, confirmed: true },
      () => repo.deleteColumn(doing.id, inbox.id, true),
    );
    await q('history', { id: task.id }, () => repo.history(task.id));
    await c('setTag', { itemId: task.id, tagId: tag.id, selected: false }, () =>
      repo.setTag(task.id, tag.id, false),
    );
    await c(
      'saveTag',
      { id: tag.id, name: 'Renamed', colorToken: 'rose' },
      () => repo.saveTag('Renamed', 'rose', tag.id),
    );
    await c('deleteTag', { id: tag.id }, () => repo.deleteTag(tag.id));
    await c('deleteItem', { id: project.id, confirmed: true }, () =>
      repo.deleteItem(project.id, true),
    );
    await q('counts', undefined, () => repo.counts());
    await q('item', { id: child.id }, () => repo.item(child.id));
    for (const name of [
      '\uFEFFBOM\uFEFF',
      '\u0085NEL\u0085',
      'ΟΣ',
      'İ',
      '😀',
      '\uE000',
    ]) {
      await c('saveTag', { name, colorToken: 'blue' }, () =>
        repo.saveTag(name, 'blue'),
      );
    }
    await expect(
      c('saveTag', { name: 'ος', colorToken: 'blue' }, () =>
        repo.saveTag('ος', 'blue'),
      ),
    ).rejects.toThrow();
    await q('tags', undefined, () => repo.tags());
    const ordering: { a: string | null; b: string | null; result: string }[] =
      [];
    let a: string | null = null;
    for (let i = 0; i < 90; i++) {
      const result: string = generateKeyBetween(a, null);
      ordering.push({ a, b: null, result });
      a = result;
    }
    let b = 'a0';
    for (let i = 0; i < 70; i++) {
      const result = generateKeyBetween(null, b);
      ordering.push({ a: null, b, result });
      b = result;
    }
    b = 'a1';
    for (let i = 0; i < 80; i++) {
      const result = generateKeyBetween('a0', b);
      ordering.push({ a: 'a0', b, result });
      b = result;
    }
    const fixture = JSON.parse(JSON.stringify({ steps, ordering }));
    const path = 'native/workspace/tests/fixtures/web-contract.json';
    if (process.env.WRITE_NATIVE_FIXTURES === '1')
      writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
    expect(fixture).toEqual(JSON.parse(readFileSync(path, 'utf8')));
  } finally {
    await database.delete();
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
