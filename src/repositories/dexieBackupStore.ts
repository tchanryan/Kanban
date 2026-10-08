import type { Database } from '../db/database';
import type { WorkspaceBackupStore } from '../contracts/backups';
import type { RecoverySnapshot } from '../contracts/workspace';
import { validateBackup, type Backup } from '../domain/backup';
import { itemSchema } from '../domain/model';
export class DexieBackupStore implements WorkspaceBackupStore {
  public constructor(private readonly database: Database) {}
  public async export(): Promise<Backup> {
    return this.database.transaction('r', this.database.tables, async () => ({
      format: 'kanban-calendar',
      version: 1,
      exportedAt: new Date().toISOString(),
      boards: await this.database.boards.toArray(),
      columns: await this.database.columns.toArray(),
      items: (await this.database.items.toArray()).map((item) =>
        itemSchema.parse(item),
      ),
      events: await this.database.events.toArray(),
      tags: await this.database.tags.toArray(),
      relations: await this.database.relations.toArray(),
      scratchpads: await this.database.scratchpads.toArray(),
      settings: await this.database.settings.toArray(),
    }));
  }
  public async replace(input: Backup): Promise<void> {
    const backup = validateBackup(input);
    await this.database.transaction('rw', this.database.tables, async () => {
      const before = await this.export();
      // Change the dataset identity in the same transaction as the replacement.
      // Old editors must not overwrite restored records even if their text matches.
      await this.database.metadata.put({
        id: 'generation',
        value: crypto.randomUUID(),
      });
      await this.database.snapshots.add({
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
        await this.database.table(name).clear();
        await this.database.table(name).bulkAdd(backup[name]);
      }
      const snapshots = await this.database.snapshots
        .orderBy('createdAt')
        .reverse()
        .toArray();
      await this.database.snapshots.bulkDelete(
        snapshots.slice(5).map((s) => s.id),
      );
    });
  }
  public snapshots(): Promise<RecoverySnapshot[]> {
    return this.database.snapshots.orderBy('createdAt').reverse().toArray();
  }
}
