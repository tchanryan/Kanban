import { z } from 'zod';
import { generateKeyBetween } from 'fractional-indexing';
import { flushDrafts } from './drafts';
import Dexie from 'dexie';
import {
  boardSchema,
  columnSchema,
  itemSchema,
  eventSchema,
  tagSchema,
  relationSchema,
  scratchSchema,
  settingsSchema,
} from '../domain/model';
import { db, type Database } from '../db/database';
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
export async function exportBackup(database: Database = db): Promise<Backup> {
  if (!Dexie.currentTransaction) await flushDrafts();
  return database.transaction('r', database.tables, async () => ({
    format: 'kanban-calendar',
    version: 1,
    exportedAt: new Date().toISOString(),
    boards: await database.boards.toArray(),
    columns: await database.columns.toArray(),
    items: (await database.items.toArray()).map((item) =>
      itemSchema.parse(item),
    ),
    events: await database.events.toArray(),
    tags: await database.tags.toArray(),
    relations: await database.relations.toArray(),
    scratchpads: await database.scratchpads.toArray(),
    settings: await database.settings.toArray(),
  }));
}
export async function replaceBackup(
  input: unknown,
  confirmed: boolean,
  database: Database = db,
) {
  if (!confirmed) throw Error('Confirm replacement before importing');
  const backup = validateBackup(input);
  await flushDrafts();
  await database.transaction('rw', database.tables, async () => {
    const before = await exportBackup(database);
    await database.snapshots.add({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      payload: JSON.stringify(before),
    });
    for (const name of [
      'boards',
      'columns',
      'items',
      'events',
      'tags',
      'relations',
      'scratchpads',
      'settings',
    ] as const) {
      await database.table(name).clear();
      await database.table(name).bulkAdd(backup[name]);
    }
    const snapshots = await database.snapshots
      .orderBy('createdAt')
      .reverse()
      .toArray();
    await database.snapshots.bulkDelete(snapshots.slice(5).map((s) => s.id));
  });
}
const envelope = z.object({
  format: z.literal('kanban-calendar-encrypted'),
  version: z.literal(1),
  kdf: z.literal('PBKDF2-SHA256'),
  iterations: z.literal(600000),
  salt: z.string().max(100),
  iv: z.string().max(100),
  ciphertext: z.string().max(150000000),
});
const encode = (bytes: Uint8Array) => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192)
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(out);
};
const decode = (s: string) => Uint8Array.from(atob(s), (x) => x.charCodeAt(0));
async function key(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function encryptBackup(data: Backup, passphrase: string) {
  if (passphrase.length < 12)
    throw Error('Use a passphrase of at least 12 characters');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await key(passphrase, salt),
    new TextEncoder().encode(JSON.stringify(data)),
  );
  return {
    format: 'kanban-calendar-encrypted',
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: 600000,
    salt: encode(salt),
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(encrypted)),
  };
}
export async function readBackup(text: string, passphrase: string) {
  if (text.length > 100000000)
    throw Error('Backup exceeds 100 MB safety limit');
  const input: unknown = JSON.parse(text);
  if (
    typeof input === 'object' &&
    input !== null &&
    'format' in input &&
    input.format === 'kanban-calendar-encrypted'
  ) {
    const e = envelope.parse(input);
    const salt = decode(e.salt),
      iv = decode(e.iv);
    if (salt.length !== 16 || iv.length !== 12)
      throw Error('Invalid encryption parameters');
    let decrypted: ArrayBuffer;
    try {
      decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        await key(passphrase, salt),
        decode(e.ciphertext),
      );
    } catch {
      throw Error('Incorrect passphrase or damaged encrypted backup');
    }
    return validateBackup(JSON.parse(new TextDecoder().decode(decrypted)));
  }
  return validateBackup(input);
}
export function download(data: unknown, encrypted = false) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `kanban-calendar-backup-${new Date().toISOString().replaceAll(':', '-')}${encrypted ? '.encrypted' : ''}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
