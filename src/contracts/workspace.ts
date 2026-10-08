import type {
  Board,
  Column,
  Item,
  ItemEvent,
  Relation,
  Scratchpad,
  Settings,
  Tag,
} from '../domain/model';

export interface ArchiveCursor {
  date: string;
  id: string;
}
export interface ArchivePage {
  items: Item[];
  nextCursor: ArchiveCursor | null;
}
export interface EditorItem {
  item: Item | undefined;
  generation: string;
}
export interface EditorScratch {
  scratch: Scratchpad | undefined;
  generation: string;
}
export interface WorkspaceCounts {
  items: number;
  boards: number;
  events: number;
  tags: number;
}
export interface RecoverySnapshot {
  id: string;
  createdAt: string;
  payload: string;
}
export type ColumnInput = Pick<
  Column,
  | 'name'
  | 'isDefaultNewItemColumn'
  | 'startsWorkOnFirstEntry'
  | 'completesItemOnEntry'
>;
export type ItemPatch = Partial<
  Pick<
    Item,
    | 'title'
    | 'description'
    | 'priority'
    | 'plannedStartDate'
    | 'dueDate'
    | 'projectColorToken'
  >
>;
export type ExpectedText = Partial<Pick<Item, 'title' | 'description'>>;

/** Queries return domain values, never storage handles or query builders. */
export interface WorkspaceQueries {
  root(): Promise<Board | undefined>;
  board(id: string): Promise<Board | undefined>;
  projectBoard(id: string): Promise<Board | undefined>;
  item(id: string): Promise<Item | undefined>;
  editorItem(id: string): Promise<EditorItem>;
  editorScratch(): Promise<EditorScratch>;
  columns(boardId: string): Promise<Column[]>;
  items(boardId: string): Promise<Item[]>;
  children(id: string): Promise<Item[]>;
  tags(): Promise<Tag[]>;
  itemTags(id: string): Promise<Relation[]>;
  boardTagRelations(boardId: string): Promise<Relation[]>;
  history(id: string): Promise<ItemEvent[]>;
  scratch(): Promise<Scratchpad | undefined>;
  settings(): Promise<Settings>;
  calendarItems(includeStandaloneTasks?: boolean): Promise<Item[]>;
  search(query: string, archived?: boolean): Promise<Item[]>;
  archivePage(
    query?: string,
    cursor?: ArchiveCursor | null,
    limit?: number,
  ): Promise<ArchivePage>;
  counts(): Promise<WorkspaceCounts>;
}

/** Each mutation resolves only after its complete transaction commits. */
export interface WorkspaceCommands {
  initialize(): Promise<Board>;
  saveColumn(boardId: string, input: ColumnInput, id?: string): Promise<Column>;
  reorderColumn(id: string, beforeId: string | null): Promise<void>;
  deleteColumn(
    id: string,
    destinationId: string | null,
    confirmed?: boolean,
  ): Promise<void>;
  create(
    boardId: string,
    title: string,
    kind?: Item['kind'],
    columnId?: string,
  ): Promise<Item>;
  update(
    id: string,
    patch: ItemPatch,
    expected?: ExpectedText,
    generation?: string,
  ): Promise<Item>;
  move(
    id: string,
    columnId: string,
    beforeId?: string | null,
    confirmed?: boolean,
  ): Promise<Item>;
  archive(id: string, confirmed?: boolean): Promise<void>;
  maintain(): Promise<void>;
  restore(id: string): Promise<boolean>;
  deleteItem(id: string, confirmed?: boolean): Promise<void>;
  saveTag(
    name: string,
    colorToken: Tag['colorToken'],
    id?: string,
  ): Promise<Tag>;
  deleteTag(id: string): Promise<void>;
  setTag(itemId: string, tagId: string, selected: boolean): Promise<void>;
  saveScratch(
    content: string,
    expected?: string,
    generation?: string,
  ): Promise<void>;
  saveSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<void>;
}

export type Workspace = WorkspaceQueries & WorkspaceCommands;
export type DeletionRepository = Pick<WorkspaceQueries, 'children'> &
  Pick<WorkspaceCommands, 'deleteItem'>;
export type WorkItemRepository = Pick<
  WorkspaceQueries,
  'columns' | 'children'
> &
  Pick<WorkspaceCommands, 'move'>;
