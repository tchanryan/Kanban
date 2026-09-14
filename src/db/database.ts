import Dexie, { type Table, type EntityTable } from 'dexie';
import { snapshotBeforeMigration } from './snapshots';
import type {
  Board,
  Column,
  Item,
  ItemEvent,
  Tag,
  Relation,
  Scratchpad,
  Settings,
} from '../domain/model';
export class Database extends Dexie {
  boards!: EntityTable<Board, 'id'>;
  columns!: EntityTable<Column, 'id'>;
  items!: EntityTable<Item, 'id'>;
  events!: EntityTable<ItemEvent, 'id'>;
  tags!: EntityTable<Tag, 'id'>;
  relations!: Table<Relation, [string, string]>;
  scratchpads!: EntityTable<Scratchpad, 'id'>;
  settings!: EntityTable<Settings, 'id'>;
  snapshots!: EntityTable<
    { id: string; createdAt: string; payload: string },
    'id'
  >;
  constructor(name = 'kanban-calendar') {
    super(name);
    this.version(1).stores({
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
    // IndexedDB cannot index null. Keep this private derived key so archived
    // work never has to be scanned to render the active board.
    this.version(2)
      .stores({
        items:
          'id,boardId,activeBoardId,columnId,parentProjectId,archivedAt,archiveAfter,kind,[boardId+columnId]',
      })
      .upgrade(async (transaction) => {
        await snapshotBeforeMigration(transaction);
        await transaction
          .table('items')
          .toCollection()
          .modify((item) => {
            item.activeBoardId = item.archivedAt ? '' : item.boardId;
          });
      });
    this.version(3)
      .stores({
        items:
          'id,boardId,activeBoardId,columnId,parentProjectId,archivedAt,archiveAfter,kind,[boardId+columnId],[archiveSortAt+id]',
      })
      .upgrade(async (transaction) => {
        await snapshotBeforeMigration(transaction);
        await transaction
          .table('items')
          .toCollection()
          .modify((item) => {
            item.archiveSortAt = item.archivedAt
              ? item.completedAt || item.archivedAt
              : '';
          });
      });
    this.items.hook('creating', (_key, item) => {
      Object.assign(item, {
        activeBoardId: item.archivedAt ? '' : item.boardId,
        archiveSortAt: item.archivedAt
          ? item.completedAt || item.archivedAt
          : '',
      });
    });
    this.items.hook('updating', (changes, _key, item) => {
      const next = { ...item, ...changes };
      return {
        activeBoardId: next.archivedAt ? '' : next.boardId,
        archiveSortAt: next.archivedAt
          ? next.completedAt || next.archivedAt
          : '',
      };
    });
  }
}
export const db = new Database();
