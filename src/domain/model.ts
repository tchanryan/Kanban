import { z } from 'zod';
export const colors = ['violet', 'blue', 'teal', 'amber', 'rose'] as const;
const id = z.uuid();
const timestamp = z.iso.datetime();
const date = z.iso.date();
const meta = {
  id,
  createdAt: timestamp,
  updatedAt: timestamp,
  revision: z.number().int().positive(),
};
const title = z.string().trim().min(1).max(200);
export const boardSchema = z.object({
  ...meta,
  kind: z.enum(['root', 'project']),
  projectId: id.nullable(),
  name: title,
});
export const columnSchema = z.object({
  ...meta,
  boardId: id,
  name: title,
  orderKey: z.string().min(1).max(1000),
  isDefaultNewItemColumn: z.boolean(),
  startsWorkOnFirstEntry: z.boolean(),
  completesItemOnEntry: z.boolean(),
});
export const itemSchema = z
  .object({
    ...meta,
    kind: z.enum(['task', 'project']),
    boardId: id,
    columnId: id,
    parentProjectId: id.nullable(),
    title,
    description: z.string().max(1000000),
    priority: z.enum(['low', 'medium', 'high']),
    plannedStartDate: date.nullable(),
    dueDate: date.nullable(),
    firstStartedAt: timestamp.nullable(),
    completedAt: timestamp.nullable(),
    archivedAt: timestamp.nullable(),
    archiveAfter: timestamp.nullable(),
    orderKey: z.string().min(1).max(1000),
    projectColorToken: z.enum(colors).nullable(),
  })
  .refine(
    (x) => !x.plannedStartDate || !x.dueDate || x.plannedStartDate <= x.dueDate,
    { message: 'Planned start must be on or before due date' },
  );
export const eventSchema = z.object({
  id,
  itemId: id,
  type: z.enum([
    'created',
    'moved',
    'completed',
    'reopened',
    'archived',
    'restored',
  ]),
  fromColumnId: id.nullable(),
  toColumnId: id.nullable(),
  occurredAt: timestamp,
});
export const tagSchema = z.object({
  ...meta,
  name: title,
  colorToken: z.enum(colors),
});
export const relationSchema = z.object({ itemId: id, tagId: id });
export const scratchSchema = z.object({
  id: z.literal('global'),
  content: z.string().max(1000000),
  createdAt: timestamp,
  updatedAt: timestamp,
  revision: z.number().int().positive(),
});
export const settingsSchema = z.object({
  id: z.literal('app'),
  calendarShowProjects: z.boolean(),
  calendarShowTopLevelTasks: z.boolean(),
  calendarShowProjectTasks: z.boolean(),
  calendarMode: z.enum(['actual', 'planned', 'compare']),
});
export type Board = z.infer<typeof boardSchema>;
export type Column = z.infer<typeof columnSchema>;
export type Item = z.infer<typeof itemSchema>;
export type ItemEvent = z.infer<typeof eventSchema>;
export type Tag = z.infer<typeof tagSchema>;
export type Relation = z.infer<typeof relationSchema>;
export type Scratchpad = z.infer<typeof scratchSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  id: 'app',
  calendarShowProjects: true,
  calendarShowTopLevelTasks: false,
  calendarShowProjectTasks: false,
  calendarMode: 'actual',
};
export const newMeta = () => {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
};
export const touch = <T extends { revision: number }>(x: T) => ({
  ...x,
  updatedAt: new Date().toISOString(),
  revision: x.revision + 1,
});
export function localDate(value: Date | string = new Date()): string {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const overdue = (x: Item, today = localDate()) =>
  !!x.dueDate && !x.completedAt && x.dueDate < today;
export function addLocalDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDate(value);
}
export const archiveTime = (now: string) =>
  new Date(new Date(now).getTime() + 14 * 86400000).toISOString();
export function transition(item: Item, column: Column, now: string): Item {
  return {
    ...touch(item),
    columnId: column.id,
    firstStartedAt:
      item.firstStartedAt || (column.startsWorkOnFirstEntry ? now : null),
    completedAt: column.completesItemOnEntry ? item.completedAt || now : null,
    archiveAfter:
      column.completesItemOnEntry && !item.parentProjectId
        ? item.archiveAfter || archiveTime(now)
        : null,
  };
}
export function range(
  item: Item,
  mode: 'actual' | 'planned',
  children: Item[] = [],
): { start: string; end: string; label: string; open: boolean } | null {
  if (mode === 'planned') {
    if (!item.plannedStartDate && !item.dueDate) return null;
    const start = item.plannedStartDate || item.dueDate!;
    return {
      start,
      end: item.dueDate || start,
      label: item.plannedStartDate
        ? item.dueDate
          ? 'Planned'
          : 'Planned · no end date'
        : 'Due date',
      open: !item.dueDate,
    };
  }
  const starts = [item.firstStartedAt, ...children.map((x) => x.firstStartedAt)]
    .filter((x): x is string => !!x)
    .sort();
  const started = starts[0];
  const start = localDate(started || item.createdAt);
  return {
    start,
    end: item.completedAt
      ? localDate(item.completedAt)
      : started
        ? localDate()
        : start,
    label: started ? 'Actual' : 'Actual · creation fallback',
    open: !!started && !item.completedAt,
  };
}
