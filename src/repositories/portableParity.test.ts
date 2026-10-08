import { expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { Database } from '../db/database';
import { WorkspaceRepository } from './workspace';
import { DexieBackupStore } from './dexieBackupStore';
import { validateBackup, type Backup } from '../domain/backup';
import { encryptBackup, readBackup } from '../services/backupCodec';

function canonical(backup: Backup): unknown {
  const { exportedAt: _, ...data } = backup;
  void _;
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? [...value].sort((a, b) =>
            JSON.stringify(a).localeCompare(JSON.stringify(b)),
          )
        : value,
    ]),
  );
}
it('keeps a browser export oracle with projects, history, missing archived columns and Unicode', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
  let sequence = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(
    () => `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  );
  const database = new Database('portable-source-oracle');
  const repo = new WorkspaceRepository(database);
  const backups = new DexieBackupStore(database);
  try {
    await database.delete();
    await database.open();
    const root = await repo.initialize();
    const inbox = await repo.saveColumn(root.id, {
      name: 'Inbox',
      isDefaultNewItemColumn: true,
      startsWorkOnFirstEntry: false,
      completesItemOnEntry: false,
    });
    const done = await repo.saveColumn(root.id, {
      name: 'Done',
      isDefaultNewItemColumn: false,
      startsWorkOnFirstEntry: true,
      completesItemOnEntry: true,
    });
    const project = await repo.create(root.id, 'Migration project', 'project');
    const board = (await repo.projectBoard(project.id))!;
    const child = await repo.create(board.id, 'Child task');
    await repo.update(child.id, {
      description: 'Preserve 😀 café 東京\nsecond line',
      plannedStartDate: '2026-01-02',
      dueDate: '2026-02-03',
    });
    const archived = await repo.create(root.id, 'Archived former column');
    await repo.move(archived.id, done.id);
    await repo.archive(archived.id);
    await repo.deleteColumn(done.id, inbox.id, true);
    // Older valid exports can retain a removed column on archived items.
    await database.items.update(archived.id, { columnId: done.id });
    const tag = await repo.saveTag('Shared tag', 'teal');
    await repo.setTag(child.id, tag.id, true);
    await repo.setTag(project.id, tag.id, true);
    await repo.saveScratch('Browser original notes\nDo not modify source');
    await repo.saveSettings({
      calendarMode: 'compare',
      calendarShowProjectTasks: true,
    });
    const exported = validateBackup(await backups.export());
    const path = 'native/workspace/tests/fixtures/portable-v1.json';
    if (process.env.WRITE_NATIVE_FIXTURES === '1')
      writeFileSync(path, JSON.stringify(exported, null, 2) + '\n');
    expect(exported).toEqual(JSON.parse(readFileSync(path, 'utf8')));
    const encrypted = await encryptBackup(
      exported,
      'synthetic-test-passphrase',
    );
    expect(
      canonical(
        await readBackup(
          JSON.stringify(encrypted),
          'synthetic-test-passphrase',
        ),
      ),
    ).toEqual(canonical(exported));
    await expect(
      readBackup(JSON.stringify(encrypted), 'wrong passphrase'),
    ).rejects.toThrow();
    expect(await backups.export()).toEqual(exported);
  } finally {
    await database.delete();
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});

it('imports the native round-trip export into Dexie without changing canonical data', async () => {
  const input = validateBackup(
    JSON.parse(
      readFileSync('native/workspace/tests/fixtures/portable-v1.json', 'utf8'),
    ),
  );
  const native = validateBackup(
    JSON.parse(
      readFileSync(
        'native/workspace/tests/fixtures/portable-native.json',
        'utf8',
      ),
    ),
  );
  const database = new Database(`portable-return-${crypto.randomUUID()}`);
  try {
    const backups = new DexieBackupStore(database);
    await backups.replace(native);
    expect(canonical(await backups.export())).toEqual(canonical(input));
    expect(await backups.snapshots()).toHaveLength(1);
  } finally {
    await database.delete();
  }
});
