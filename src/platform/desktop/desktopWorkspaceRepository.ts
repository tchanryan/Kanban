import { z } from 'zod';
import {
  boardSchema,
  columnSchema,
  itemSchema,
  eventSchema,
  tagSchema,
  relationSchema,
  scratchSchema,
  settingsSchema,
  type Item,
  type Tag,
  type Settings,
} from '../../domain/model';
import type {
  Workspace,
  ArchiveCursor,
  ColumnInput,
  ItemPatch,
  ExpectedText,
} from '../../contracts/workspace';
import {
  type NativeTransport,
  CommitNotifications,
  replySchema,
} from './transport';
const optional = <T>(schema: z.ZodType<T>) =>
  schema.nullable().transform((value) => value ?? undefined);
const empty = z.null().transform(() => undefined);
export class DesktopWorkspaceRepository implements Workspace {
  public constructor(
    private readonly transport: NativeTransport,
    private readonly notifications: CommitNotifications,
  ) {}
  private async request<T>(
    channel: 'workspace_command' | 'workspace_query',
    name: string,
    args: Record<string, unknown> | undefined,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const operation = args ? { name, args } : { name };
    const reply = replySchema.parse(
      await this.transport.invoke(channel, {
        [channel === 'workspace_query' ? 'query' : 'command']: operation,
      }),
    );
    if (channel === 'workspace_command')
      this.notifications.publish(reply.version);
    return schema.parse(reply.value);
  }
  public root(): ReturnType<Workspace['root']> {
    return this.request(
      'workspace_query',
      'root',
      undefined,
      optional(boardSchema),
    );
  }
  public board(id: string): ReturnType<Workspace['board']> {
    return this.request(
      'workspace_query',
      'board',
      { id },
      optional(boardSchema),
    );
  }
  public projectBoard(id: string): ReturnType<Workspace['projectBoard']> {
    return this.request(
      'workspace_query',
      'projectBoard',
      { id },
      optional(boardSchema),
    );
  }
  public item(id: string): ReturnType<Workspace['item']> {
    return this.request(
      'workspace_query',
      'item',
      { id },
      optional(itemSchema),
    );
  }
  public editorItem(id: string): ReturnType<Workspace['editorItem']> {
    return this.request(
      'workspace_query',
      'editorItem',
      { id },
      z.object({ item: optional(itemSchema), generation: z.uuid() }),
    );
  }
  public editorScratch(): ReturnType<Workspace['editorScratch']> {
    return this.request(
      'workspace_query',
      'editorScratch',
      undefined,
      z.object({ scratch: optional(scratchSchema), generation: z.uuid() }),
    );
  }
  public columns(boardId: string): ReturnType<Workspace['columns']> {
    return this.request(
      'workspace_query',
      'columns',
      { boardId },
      z.array(columnSchema),
    );
  }
  public items(boardId: string): ReturnType<Workspace['items']> {
    return this.request(
      'workspace_query',
      'items',
      { boardId },
      z.array(itemSchema),
    );
  }
  public children(id: string): ReturnType<Workspace['children']> {
    return this.request(
      'workspace_query',
      'children',
      { id },
      z.array(itemSchema),
    );
  }
  public tags(): ReturnType<Workspace['tags']> {
    return this.request(
      'workspace_query',
      'tags',
      undefined,
      z.array(tagSchema),
    );
  }
  public itemTags(id: string): ReturnType<Workspace['itemTags']> {
    return this.request(
      'workspace_query',
      'itemTags',
      { id },
      z.array(relationSchema),
    );
  }
  public boardTagRelations(
    boardId: string,
  ): ReturnType<Workspace['boardTagRelations']> {
    return this.request(
      'workspace_query',
      'boardTagRelations',
      { boardId },
      z.array(relationSchema),
    );
  }
  public history(id: string): ReturnType<Workspace['history']> {
    return this.request(
      'workspace_query',
      'history',
      { id },
      z.array(eventSchema),
    );
  }
  public scratch(): ReturnType<Workspace['scratch']> {
    return this.request(
      'workspace_query',
      'scratch',
      undefined,
      optional(scratchSchema),
    );
  }
  public settings(): ReturnType<Workspace['settings']> {
    return this.request(
      'workspace_query',
      'settings',
      undefined,
      settingsSchema,
    );
  }
  public calendarItems(
    includeStandaloneTasks = false,
  ): ReturnType<Workspace['calendarItems']> {
    return this.request(
      'workspace_query',
      'calendarItems',
      { includeStandaloneTasks },
      z.array(itemSchema),
    );
  }
  public search(
    query: string,
    archived = false,
  ): ReturnType<Workspace['search']> {
    return this.request(
      'workspace_query',
      'search',
      { query, archived },
      z.array(itemSchema),
    );
  }
  public archivePage(
    query = '',
    cursor: ArchiveCursor | null = null,
    limit = 50,
  ): ReturnType<Workspace['archivePage']> {
    return this.request(
      'workspace_query',
      'archivePage',
      { query, cursor, limit },
      z.object({
        items: z.array(itemSchema),
        nextCursor: z.object({ date: z.string(), id: z.uuid() }).nullable(),
      }),
    );
  }
  public counts(): ReturnType<Workspace['counts']> {
    return this.request(
      'workspace_query',
      'counts',
      undefined,
      z.object({
        items: z.number().int().nonnegative(),
        boards: z.number().int().nonnegative(),
        events: z.number().int().nonnegative(),
        tags: z.number().int().nonnegative(),
      }),
    );
  }
  public initialize(): ReturnType<Workspace['initialize']> {
    return this.request(
      'workspace_command',
      'initialize',
      undefined,
      boardSchema,
    );
  }
  public saveColumn(
    boardId: string,
    input: ColumnInput,
    id?: string,
  ): ReturnType<Workspace['saveColumn']> {
    return this.request(
      'workspace_command',
      'saveColumn',
      { boardId, input, id },
      columnSchema,
    );
  }
  public reorderColumn(
    id: string,
    beforeId: string | null,
  ): ReturnType<Workspace['reorderColumn']> {
    return this.request(
      'workspace_command',
      'reorderColumn',
      { id, beforeId },
      empty,
    );
  }
  public deleteColumn(
    id: string,
    destinationId: string | null,
    confirmed = false,
  ): ReturnType<Workspace['deleteColumn']> {
    return this.request(
      'workspace_command',
      'deleteColumn',
      { id, destinationId, confirmed },
      empty,
    );
  }
  public create(
    boardId: string,
    title: string,
    kind: Item['kind'] = 'task',
    columnId?: string,
  ): ReturnType<Workspace['create']> {
    return this.request(
      'workspace_command',
      'create',
      { boardId, title, kind, columnId },
      itemSchema,
    );
  }
  public update(
    id: string,
    patch: ItemPatch,
    expected?: ExpectedText,
    generation?: string,
  ): ReturnType<Workspace['update']> {
    return this.request(
      'workspace_command',
      'update',
      { id, patch, expected, generation },
      itemSchema,
    );
  }
  public move(
    id: string,
    columnId: string,
    beforeId: string | null = null,
    confirmed = false,
  ): ReturnType<Workspace['move']> {
    return this.request(
      'workspace_command',
      'move',
      { id, columnId, beforeId, confirmed },
      itemSchema,
    );
  }
  public archive(
    id: string,
    confirmed = false,
  ): ReturnType<Workspace['archive']> {
    return this.request(
      'workspace_command',
      'archive',
      { id, confirmed },
      empty,
    );
  }
  public maintain(): ReturnType<Workspace['maintain']> {
    return this.request('workspace_command', 'maintain', undefined, empty);
  }
  public restore(id: string): ReturnType<Workspace['restore']> {
    return this.request('workspace_command', 'restore', { id }, z.boolean());
  }
  public deleteItem(
    id: string,
    confirmed = false,
  ): ReturnType<Workspace['deleteItem']> {
    return this.request(
      'workspace_command',
      'deleteItem',
      { id, confirmed },
      empty,
    );
  }
  public saveTag(
    name: string,
    colorToken: Tag['colorToken'],
    id?: string,
  ): ReturnType<Workspace['saveTag']> {
    return this.request(
      'workspace_command',
      'saveTag',
      { name, colorToken, id },
      tagSchema,
    );
  }
  public deleteTag(id: string): ReturnType<Workspace['deleteTag']> {
    return this.request('workspace_command', 'deleteTag', { id }, empty);
  }
  public setTag(
    itemId: string,
    tagId: string,
    selected: boolean,
  ): ReturnType<Workspace['setTag']> {
    return this.request(
      'workspace_command',
      'setTag',
      { itemId, tagId, selected },
      empty,
    );
  }
  public saveScratch(
    content: string,
    expected?: string,
    generation?: string,
  ): ReturnType<Workspace['saveScratch']> {
    return this.request(
      'workspace_command',
      'saveScratch',
      { content, expected, generation },
      empty,
    );
  }
  public saveSettings(
    patch: Partial<Omit<Settings, 'id'>>,
  ): ReturnType<Workspace['saveSettings']> {
    return this.request('workspace_command', 'saveSettings', { patch }, empty);
  }
}
