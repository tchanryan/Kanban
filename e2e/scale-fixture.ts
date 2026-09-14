import { generateNKeysBetween } from 'fractional-indexing';
import {
  newMeta,
  defaultSettings,
  type Item,
  type Column,
  type Board,
} from '../src/domain/model';
import type { Backup } from '../src/services/backups';
export function scaleFixture(): Backup {
  const root: Board = {
    ...newMeta(),
    kind: 'root',
    projectId: null,
    name: 'Dashboard',
  };
  const boardKeys = generateNKeysBetween(null, null, 5);
  const columns = (boardId: string): Column[] =>
    boardKeys.map((orderKey, i) => ({
      ...newMeta(),
      boardId,
      name: `Stage ${i + 1}`,
      orderKey,
      isDefaultNewItemColumn: i === 0,
      startsWorkOnFirstEntry: i === 1,
      completesItemOnEntry: i === 4,
    }));
  const rootColumns = columns(root.id),
    boards = [root],
    allColumns = [...rootColumns],
    items: Item[] = [];
  const template: Item = {
    ...newMeta(),
    kind: 'task',
    boardId: root.id,
    columnId: rootColumns[0]!.id,
    parentProjectId: null,
    title: 'Fixture',
    description: 'Synthetic performance fixture',
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
  const keys = generateNKeysBetween(null, null, 11010);
  for (let p = 0; p < 3; p++) {
    const project: Item = {
      ...template,
      ...newMeta(),
      kind: 'project',
      title: `Scale project ${p + 1}`,
      orderKey: keys[p]!,
      projectColorToken: 'blue',
    };
    items.push(project);
    const board: Board = {
      ...newMeta(),
      kind: 'project',
      projectId: project.id,
      name: project.title,
    };
    boards.push(board);
    allColumns.push(...columns(board.id));
  }
  for (let i = 0; i < 11000; i++) {
    const active = i < 1000;
    const board =
      active && i >= 700 ? boards[1 + Math.floor((i - 700) / 100)]! : root;
    const col = allColumns.filter((c) => c.boardId === board.id)[i % 5]!;
    items.push({
      ...template,
      ...newMeta(),
      boardId: board.id,
      parentProjectId: board.projectId,
      columnId: col.id,
      title: `Scale task ${i}`,
      orderKey: keys[i + 3]!,
      archivedAt: active ? null : '2025-01-15T00:00:00.000Z',
      completedAt: active ? null : '2025-01-01T00:00:00.000Z',
    });
  }
  const events = Array.from({ length: 25000 }, (_, i) => ({
    id: crypto.randomUUID(),
    itemId: items[i % items.length]!.id,
    type: 'created' as const,
    fromColumnId: null,
    toColumnId: items[i % items.length]!.columnId,
    occurredAt: '2025-01-01T00:00:00.000Z',
  }));
  return {
    format: 'kanban-calendar',
    version: 1,
    exportedAt: new Date().toISOString(),
    boards,
    columns: allColumns,
    items,
    events,
    tags: [],
    relations: [],
    scratchpads: [],
    settings: [defaultSettings],
  };
}
