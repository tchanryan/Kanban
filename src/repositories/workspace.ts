import type {
  Workspace,
  ArchivePage,
  EditorItem,
  EditorScratch,
  WorkspaceCounts,
} from '../contracts/workspace';
import type { Board, Relation, ItemEvent, Scratchpad } from '../domain/model';
import { generateKeyBetween } from 'fractional-indexing';
import type { Database } from '../db/database';
import { EditConflictError } from '../domain/errors';
import {
  newMeta,
  touch,
  itemSchema,
  columnSchema,
  tagSchema,
  transition,
  archiveTime,
  defaultSettings,
  type Item,
  type Column,
  type Tag,
  type Settings,
} from '../domain/model';
export class WorkspaceRepository implements Workspace {
  public constructor(private readonly database: Database) {}
  private transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.database.transaction('rw', this.database.tables, fn);
  }
  public async initialize(): Promise<Board> {
    return this.transaction(async () => {
      let root = await this.database.boards
        .where('kind')
        .equals('root')
        .first();
      if (!root) {
        root = {
          ...newMeta(),
          kind: 'root',
          projectId: null,
          name: 'Dashboard',
        };
        await this.database.boards.add(root);
      }
      if (!(await this.database.settings.get('app')))
        await this.database.settings.put(defaultSettings);
      return root;
    });
  }
  public root = (): Promise<Board | undefined> =>
    this.database.boards.where('kind').equals('root').first();
  public board = (id: string): Promise<Board | undefined> =>
    this.database.boards.get(id);
  public projectBoard = (id: string): Promise<Board | undefined> =>
    this.database.boards.where('projectId').equals(id).first();
  public item = (id: string): Promise<Item | undefined> =>
    this.database.items.get(id);
  public editorItem = (id: string): Promise<EditorItem> =>
    this.database.transaction(
      'r',
      [this.database.items, this.database.metadata],
      async () => ({
        item: await this.item(id),
        generation: await this.database.generation(),
      }),
    );
  public editorScratch = (): Promise<EditorScratch> =>
    this.database.transaction(
      'r',
      [this.database.scratchpads, this.database.metadata],
      async () => ({
        scratch: await this.scratch(),
        generation: await this.database.generation(),
      }),
    );
  private async checkGeneration(expected?: string): Promise<void> {
    if (
      expected !== undefined &&
      expected !== (await this.database.generation())
    )
      throw new EditConflictError();
  }
  public columns = (boardId: string): Promise<Column[]> =>
    this.database.columns.where('boardId').equals(boardId).sortBy('orderKey');
  public items = (boardId: string): Promise<Item[]> =>
    this.database.items
      .where('activeBoardId')
      .equals(boardId)
      .sortBy('orderKey');
  public children = (id: string): Promise<Item[]> =>
    this.database.items.where('parentProjectId').equals(id).toArray();
  public tags = (): Promise<Tag[]> =>
    this.database.tags.orderBy('name').toArray();
  public itemTags = (id: string): Promise<Relation[]> =>
    this.database.relations.where('itemId').equals(id).toArray();
  public history = (id: string): Promise<ItemEvent[]> =>
    this.database.events.where('itemId').equals(id).sortBy('occurredAt');
  public scratch = (): Promise<Scratchpad | undefined> =>
    this.database.scratchpads.get('global');
  public settings = async (): Promise<Settings> =>
    (await this.database.settings.get('app')) || defaultSettings;
  public async calendarItems(includeStandaloneTasks = false): Promise<Item[]> {
    if (includeStandaloneTasks) return this.database.items.toArray();
    const projects = await this.database.items
      .where('kind')
      .equals('project')
      .toArray();
    const children = projects.length
      ? await this.database.items
          .where('parentProjectId')
          .anyOf(projects.map((p) => p.id))
          .toArray()
      : [];
    return [...projects, ...children];
  }
  public async search(query: string, archived = false): Promise<Item[]> {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return [];
    const tags = (await this.tags()).filter((t) =>
      t.name.toLocaleLowerCase().includes(q),
    );
    const related = tags.length
      ? await this.database.relations
          .where('tagId')
          .anyOf(tags.map((t) => t.id))
          .toArray()
      : [];
    const ids = new Set(related.map((x) => x.itemId));
    const archivedProjects = new Set(
      (
        await this.database.items
          .where('kind')
          .equals('project')
          .filter((x) => !!x.archivedAt)
          .toArray()
      ).map((x) => x.id),
    );
    return this.database.items
      .filter(
        (x) =>
          (archived ||
            (!x.archivedAt &&
              (!x.parentProjectId ||
                !archivedProjects.has(x.parentProjectId)))) &&
          (x.title.toLocaleLowerCase().includes(q) ||
            x.description.toLocaleLowerCase().includes(q) ||
            ids.has(x.id)),
      )
      .limit(100)
      .toArray();
  }
  public async boardTagRelations(boardId: string): Promise<Relation[]> {
    const ids = await this.database.items
      .where('boardId')
      .equals(boardId)
      .primaryKeys();
    return ids.length
      ? this.database.relations.where('itemId').anyOf(ids).toArray()
      : [];
  }
  public async archivePage(
    query = '',
    cursor: { date: string; id: string } | null = null,
    limit = 50,
  ): Promise<ArchivePage> {
    const pageSize = Math.max(1, Math.min(200, limit));
    const records = await this.database.items
      .where('[archiveSortAt+id]')
      .between(
        ['', '\uffff'],
        cursor ? [cursor.date, cursor.id] : ['\uffff', '\uffff'],
        false,
        false,
      )
      .reverse()
      .filter((item) =>
        item.title
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      )
      .limit(pageSize + 1)
      .toArray();
    const items = records.slice(0, pageSize),
      last = items.at(-1);
    return {
      items,
      nextCursor:
        records.length > pageSize && last
          ? { date: last.completedAt || last.archivedAt!, id: last.id }
          : null,
    };
  }
  private async event(
    item: Item,
    type:
      'created' | 'moved' | 'completed' | 'reopened' | 'archived' | 'restored',
    from: string | null,
  ): Promise<void> {
    await this.database.events.add({
      id: crypto.randomUUID(),
      itemId: item.id,
      type,
      fromColumnId: from,
      toColumnId: item.columnId,
      occurredAt: new Date().toISOString(),
    });
  }
  public async saveColumn(
    boardId: string,
    input: Pick<
      Column,
      | 'name'
      | 'isDefaultNewItemColumn'
      | 'startsWorkOnFirstEntry'
      | 'completesItemOnEntry'
    >,
    id?: string,
  ): Promise<Column> {
    return this.transaction(async () => {
      if (!(await this.board(boardId))) throw Error('Board not found');
      const cols = await this.columns(boardId);
      const old = id ? cols.find((c) => c.id === id) : undefined;
      if (id && !old) throw Error('Column not found');
      if (
        cols.some(
          (c) =>
            c.id !== id &&
            c.name.toLocaleLowerCase() ===
              input.name.trim().toLocaleLowerCase(),
        )
      )
        throw Error('A column with this name already exists');
      const col = columnSchema.parse({
        ...old,
        ...(old ? touch(old) : newMeta()),
        boardId,
        ...input,
        orderKey:
          old?.orderKey ||
          generateKeyBetween(cols.at(-1)?.orderKey || null, null),
        isDefaultNewItemColumn:
          cols.length === 0 || input.isDefaultNewItemColumn,
      });
      if (
        old?.isDefaultNewItemColumn &&
        !col.isDefaultNewItemColumn &&
        !cols.some((c) => c.id !== id && c.isDefaultNewItemColumn)
      )
        throw Error('Choose another default column first');
      for (const c of cols) {
        if (
          (col.isDefaultNewItemColumn &&
            c.isDefaultNewItemColumn &&
            c.id !== id) ||
          (col.completesItemOnEntry && c.completesItemOnEntry && c.id !== id)
        )
          await this.database.columns.put({
            ...touch(c),
            isDefaultNewItemColumn: col.isDefaultNewItemColumn
              ? false
              : c.isDefaultNewItemColumn,
            completesItemOnEntry: col.completesItemOnEntry
              ? false
              : c.completesItemOnEntry,
          });
      }
      await this.database.columns.put(col);
      return col;
    });
  }
  public async reorderColumn(
    id: string,
    beforeId: string | null,
  ): Promise<void> {
    return this.transaction(async () => {
      const col = await this.database.columns.get(id);
      if (!col) throw Error('Column not found');
      const cols = (await this.columns(col.boardId)).filter((x) => x.id !== id);
      const index = beforeId
        ? cols.findIndex((c) => c.id === beforeId)
        : cols.length;
      if (index < 0) throw Error('Destination not found');
      await this.database.columns.put({
        ...touch(col),
        orderKey: generateKeyBetween(
          cols[index - 1]?.orderKey || null,
          cols[index]?.orderKey || null,
        ),
      });
    });
  }
  public async deleteColumn(
    id: string,
    destinationId: string | null,
    confirmed = false,
  ): Promise<void> {
    if (!confirmed) throw Error('Confirm column deletion');
    return this.transaction(async () => {
      const col = await this.database.columns.get(id);
      if (!col) throw Error('Column not found');
      const cols = await this.columns(col.boardId);
      const items = await this.database.items
        .where('columnId')
        .equals(id)
        .toArray();
      const destination = cols.find(
        (x) => x.id === destinationId && x.id !== id,
      );
      if ((items.length > 0 || cols.length > 1) && !destination)
        throw Error('Choose a destination and replacement default column');
      for (const item of items)
        await this.moveInternal(item.id, destination!.id, null, true);
      if (col.isDefaultNewItemColumn && destination)
        await this.database.columns.put({
          ...touch(destination),
          isDefaultNewItemColumn: true,
        });
      await this.database.columns.delete(id);
    });
  }
  public async create(
    boardId: string,
    title: string,
    kind: Item['kind'] = 'task',
    columnId?: string,
  ): Promise<Item> {
    return this.transaction(async () => {
      const board = await this.board(boardId);
      if (!board) throw Error('Board not found');
      if (kind === 'project' && board.kind !== 'root')
        throw Error('Projects can only be created on Dashboard');
      const cols = await this.columns(boardId);
      const col = columnId
        ? cols.find((c) => c.id === columnId)
        : cols.find((c) => c.isDefaultNewItemColumn);
      if (!col) throw Error('Create a column first');
      const siblings = await this.database.items
        .where('columnId')
        .equals(col.id)
        .sortBy('orderKey');
      const item = itemSchema.parse({
        ...newMeta(),
        kind,
        boardId,
        columnId: col.id,
        parentProjectId: board.projectId,
        title,
        description: '',
        priority: 'medium',
        plannedStartDate: null,
        dueDate: null,
        firstStartedAt: null,
        completedAt: null,
        archiveAfter: null,
        archivedAt: null,
        orderKey: generateKeyBetween(siblings.at(-1)?.orderKey || null, null),
        projectColorToken: kind === 'project' ? 'violet' : null,
      });
      await this.database.items.add(item);
      await this.event(item, 'created', null);
      if (kind === 'project') {
        const projectBoard = {
          ...newMeta(),
          kind: 'project' as const,
          projectId: item.id,
          name: item.title,
        };
        await this.database.boards.add(projectBoard);
        for (const name of ['todo', 'in-progress', 'completed']) {
          await this.saveColumn(projectBoard.id, {
            name,
            isDefaultNewItemColumn: name === 'todo',
            startsWorkOnFirstEntry: name === 'in-progress',
            completesItemOnEntry: name === 'completed',
          });
        }
      }
      return item;
    });
  }
  public async update(
    id: string,
    patch: Partial<
      Pick<
        Item,
        | 'title'
        | 'description'
        | 'priority'
        | 'plannedStartDate'
        | 'dueDate'
        | 'projectColorToken'
      >
    >,
    expected?: Partial<Pick<Item, 'title' | 'description'>>,
    generation?: string,
  ): Promise<Item> {
    return this.transaction(async () => {
      await this.checkGeneration(generation);
      const old = await this.item(id);
      if (!old) throw Error('Item not found');
      for (const field of ['title', 'description'] as const) {
        if (expected?.[field] !== undefined && old[field] !== expected[field])
          throw new EditConflictError();
      }
      const item = itemSchema.parse({ ...touch(old), ...patch });
      await this.database.items.put(item);
      return item;
    });
  }
  public async move(
    id: string,
    columnId: string,
    beforeId: string | null = null,
    confirmed = false,
  ): Promise<Item> {
    return this.transaction(() =>
      this.moveInternal(id, columnId, beforeId, confirmed),
    );
  }
  private async moveInternal(
    id: string,
    columnId: string,
    beforeId: string | null,
    confirmed: boolean,
  ): Promise<Item> {
    const old = await this.item(id);
    const col = await this.database.columns.get(columnId);
    if (!old || !col || old.boardId !== col.boardId)
      throw Error('Invalid destination');
    if (
      old.kind === 'project' &&
      col.completesItemOnEntry &&
      !old.completedAt &&
      !confirmed
    ) {
      const remaining = (await this.children(id)).filter(
        (x) => !x.completedAt,
      ).length;
      if (remaining)
        throw Error(
          `Confirm completion: ${remaining} child tasks remain incomplete`,
        );
    }
    const siblings = (
      await this.database.items
        .where('columnId')
        .equals(columnId)
        .sortBy('orderKey')
    ).filter((x) => x.id !== id);
    const i = beforeId
      ? siblings.findIndex((x) => x.id === beforeId)
      : siblings.length;
    if (i < 0) throw Error('Invalid ordering destination');
    const changed = old.columnId !== columnId;
    const item = {
      ...(changed
        ? transition(old, col, new Date().toISOString())
        : touch(old)),
      orderKey: generateKeyBetween(
        siblings[i - 1]?.orderKey || null,
        siblings[i]?.orderKey || null,
      ),
    };
    await this.database.items.put(item);
    if (changed) {
      await this.event(item, 'moved', old.columnId);
      if (!old.completedAt && item.completedAt)
        await this.event(item, 'completed', old.columnId);
      if (old.completedAt && !item.completedAt)
        await this.event(item, 'reopened', old.columnId);
    }
    return item;
  }
  public async archive(id: string, confirmed = false): Promise<void> {
    return this.transaction(async () => {
      const item = await this.item(id);
      if (!item || item.parentProjectId)
        throw Error('Only top-level items can be archived');
      if (!item.completedAt && !confirmed)
        throw Error('Confirm archiving this incomplete item');
      if (item.archivedAt) return;
      const next = { ...touch(item), archivedAt: new Date().toISOString() };
      await this.database.items.put(next);
      await this.event(next, 'archived', item.columnId);
    });
  }
  public async maintain(): Promise<void> {
    return this.transaction(async () => {
      const eligible = await this.database.items
        .where('archiveAfter')
        .between('', new Date().toISOString(), false, true)
        .filter((x) => !x.archivedAt && !!x.completedAt && !x.parentProjectId)
        .toArray();
      for (const x of eligible) await this.archive(x.id);
    });
  }
  public async restore(id: string): Promise<boolean> {
    return this.transaction(async () => {
      const old = await this.item(id);
      if (!old) throw Error('Item not found');
      if (old.parentProjectId)
        throw Error('Only top-level items can be restored');
      const cols = await this.columns(old.boardId);
      const col =
        cols.find((c) => c.id === old.columnId) ||
        cols.find((c) => c.isDefaultNewItemColumn);
      if (!col) throw Error('Create a dashboard column before restoring');
      const fallback = old.columnId !== col.id;
      const siblings = fallback
        ? await this.database.items
            .where('columnId')
            .equals(col.id)
            .sortBy('orderKey')
        : [];
      const now = new Date().toISOString();
      const next = {
        ...(fallback ? transition(old, col, now) : touch(old)),
        columnId: col.id,
        orderKey: fallback
          ? generateKeyBetween(siblings.at(-1)?.orderKey || null, null)
          : old.orderKey,
        archivedAt: null,
        archiveAfter:
          col.completesItemOnEntry && old.completedAt ? archiveTime(now) : null,
      };
      await this.database.items.put(next);
      await this.event(next, 'restored', old.columnId);
      return fallback;
    });
  }
  public async deleteItem(id: string, confirmed = false): Promise<void> {
    if (!confirmed) throw Error('Confirm permanent deletion');
    return this.transaction(async () => {
      const item = await this.item(id);
      if (!item) throw Error('Item not found');
      const children = item.kind === 'project' ? await this.children(id) : [];
      const ids = [id, ...children.map((x) => x.id)];
      await this.database.relations.where('itemId').anyOf(ids).delete();
      await this.database.events.where('itemId').anyOf(ids).delete();
      if (item.kind === 'project') {
        const board = await this.projectBoard(id);
        if (board) {
          await this.database.columns
            .where('boardId')
            .equals(board.id)
            .delete();
          await this.database.boards.delete(board.id);
        }
      }
      await this.database.items.bulkDelete(ids);
    });
  }
  public async saveTag(
    name: string,
    colorToken: Tag['colorToken'],
    id?: string,
  ): Promise<Tag> {
    return this.transaction(async () => {
      const tags = await this.tags();
      if (
        tags.some(
          (t) =>
            t.id !== id &&
            t.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
        )
      )
        throw Error('Tag names must be unique');
      const old = id ? tags.find((t) => t.id === id) : null;
      const tag = tagSchema.parse({
        ...old,
        ...(old ? touch(old) : newMeta()),
        name,
        colorToken,
      });
      await this.database.tags.put(tag);
      return tag;
    });
  }
  public async deleteTag(id: string): Promise<void> {
    return this.transaction(async () => {
      await this.database.relations.where('tagId').equals(id).delete();
      await this.database.tags.delete(id);
    });
  }
  public async setTag(
    itemId: string,
    tagId: string,
    selected: boolean,
  ): Promise<void> {
    return this.transaction(async () => {
      if (!(await this.item(itemId)) || !(await this.database.tags.get(tagId)))
        throw Error('Item or tag no longer exists');
      if (selected) await this.database.relations.put({ itemId, tagId });
      else await this.database.relations.delete([itemId, tagId]);
      const item = await this.item(itemId);
      await this.database.items.put(touch(item!));
    });
  }
  public async saveScratch(
    content: string,
    expected?: string,
    generation?: string,
  ): Promise<void> {
    if (content.length > 1000000)
      throw Error('Notes exceed the 1 MB text limit');
    return this.transaction(async () => {
      await this.checkGeneration(generation);
      const old = await this.scratch();
      if (expected !== undefined && (old?.content || '') !== expected)
        throw new EditConflictError();
      const now = new Date().toISOString();
      await this.database.scratchpads.put({
        id: 'global',
        content,
        createdAt: old?.createdAt || now,
        updatedAt: now,
        revision: (old?.revision || 0) + 1,
      });
    });
  }
  public async saveSettings(
    patch: Partial<Omit<Settings, 'id'>>,
  ): Promise<void> {
    await this.transaction(async () => {
      await this.database.settings.put({
        ...(await this.settings()),
        ...patch,
      });
    });
  }
  public async counts(): Promise<WorkspaceCounts> {
    return {
      items: await this.database.items.count(),
      boards: await this.database.boards.count(),
      events: await this.database.events.count(),
      tags: await this.database.tags.count(),
    };
  }
}
