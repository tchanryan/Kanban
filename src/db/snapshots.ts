import type { Transaction } from 'dexie';
import { itemSchema } from '../domain/model';
export async function snapshotBeforeMigration(transaction: Transaction) {
  const names = [
    'boards',
    'columns',
    'items',
    'events',
    'tags',
    'relations',
    'scratchpads',
    'settings',
  ];
  const payload: Record<string, unknown> = {
    format: 'kanban-calendar',
    version: 1,
    exportedAt: new Date().toISOString(),
  };
  for (const name of names) {
    const records = await transaction.table(name).toArray();
    payload[name] =
      name === 'items'
        ? records.map((record) => itemSchema.parse(record))
        : records;
  }
  await transaction.table('snapshots').add({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    payload: JSON.stringify(payload),
  });
  const snapshots = await transaction
    .table('snapshots')
    .orderBy('createdAt')
    .reverse()
    .primaryKeys();
  await transaction.table('snapshots').bulkDelete(snapshots.slice(5));
}
