import { z } from 'zod';
import { generateKeyBetween } from 'fractional-indexing';
import {
  boardSchema,
  columnSchema,
  itemSchema,
  eventSchema,
  tagSchema,
  relationSchema,
  scratchSchema,
  settingsSchema,
} from './model';
const schema = z.object({
  format: z.literal('kanban-calendar'),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  boards: z.array(boardSchema),
  columns: z.array(columnSchema),
  items: z.array(itemSchema),
  events: z.array(eventSchema),
  tags: z.array(tagSchema),
  relations: z.array(relationSchema),
  scratchpads: z.array(scratchSchema),
  settings: z.array(settingsSchema),
});
export type Backup = z.infer<typeof schema>;
export function validateBackup(input: unknown): Backup {
  const data = schema.parse(input);
  for (const record of [...data.columns, ...data.items])
    generateKeyBetween(record.orderKey, null);
  for (const entities of [
    data.boards,
    data.columns,
    data.items,
    data.events,
    data.tags,
    data.scratchpads,
    data.settings,
  ]) {
    if (new Set(entities.map((x) => x.id)).size !== entities.length)
      throw Error('Duplicate record IDs');
  }
  const boards = new Map(data.boards.map((x) => [x.id, x]));
  const cols = new Map(data.columns.map((x) => [x.id, x]));
  const items = new Map(data.items.map((x) => [x.id, x]));
  const tags = new Set(data.tags.map((x) => x.id));
  const identities = [
    ...data.boards,
    ...data.columns,
    ...data.items,
    ...data.events,
    ...data.tags,
  ].map((record) => record.id);
  if (new Set(identities).size !== identities.length)
    throw Error('Record IDs must be unique across entity types');
  const columnOrders = new Set<string>(),
    itemOrders = new Set<string>();
  for (const column of data.columns) {
    const key = `${column.boardId}/${column.orderKey}`;
    if (columnOrders.has(key)) throw Error('Duplicate column order keys');
    columnOrders.add(key);
  }
  for (const item of data.items) {
    const key = `${item.columnId}/${item.orderKey}`;
    if (itemOrders.has(key)) throw Error('Duplicate item order keys');
    itemOrders.add(key);
  }
  const roots = data.boards.filter((x) => x.kind === 'root');
  if (roots.length !== 1 || roots[0]!.projectId !== null)
    throw Error('Backup must have exactly one root board');
  for (const b of data.boards) {
    const columns = data.columns.filter((c) => c.boardId === b.id);
    if (
      columns.length &&
      columns.filter((c) => c.isDefaultNewItemColumn).length !== 1
    )
      throw Error('Invalid default columns');
    if (columns.filter((c) => c.completesItemOnEntry).length > 1)
      throw Error('Multiple completion columns');
    if (
      new Set(columns.map((c) => c.name.toLocaleLowerCase())).size !==
      columns.length
    )
      throw Error('Duplicate column names');
    if (
      b.kind === 'project' &&
      (!b.projectId || items.get(b.projectId)?.kind !== 'project')
    )
      throw Error('Invalid project board');
  }
  for (const c of data.columns)
    if (!boards.has(c.boardId)) throw Error('Column references missing board');
  for (const i of data.items) {
    const board = boards.get(i.boardId);
    if (!board) throw Error('Item references missing board');
    const col = cols.get(i.columnId);
    if ((!col && !i.archivedAt) || (col && col.boardId !== i.boardId))
      throw Error('Invalid item column');
    if (
      i.kind === 'project' &&
      (board.kind !== 'root' ||
        i.parentProjectId !== null ||
        data.boards.filter((b) => b.projectId === i.id).length !== 1)
    )
      throw Error('Invalid project ownership');
    if (
      board.projectId !== i.parentProjectId ||
      (i.parentProjectId && items.get(i.parentProjectId)?.kind !== 'project')
    )
      throw Error('Invalid parent project');
    if (i.parentProjectId && (i.archivedAt || i.archiveAfter))
      throw Error('Child tasks cannot be archived separately');
    if (i.archiveAfter && !i.completedAt)
      throw Error('Archive schedule requires completion');
  }
  for (const e of data.events)
    if (!items.has(e.itemId)) throw Error('History references missing item');
  for (const r of data.relations)
    if (!items.has(r.itemId) || !tags.has(r.tagId))
      throw Error('Invalid tag association');
  if (
    new Set(data.relations.map((x) => `${x.itemId}/${x.tagId}`)).size !==
    data.relations.length
  )
    throw Error('Duplicate tag associations');
  if (
    new Set(data.tags.map((t) => t.name.toLocaleLowerCase())).size !==
    data.tags.length
  )
    throw Error('Duplicate tag names');
  return data;
}
