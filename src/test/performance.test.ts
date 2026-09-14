import { it, expect } from 'vitest';
import { Database } from '../db/database';
import { WorkspaceRepository } from '../repositories/workspace';
import { newMeta, type Item, type Column } from '../domain/model';
import { generateNKeysBetween } from 'fractional-indexing';
it('queries the active board independently of 10,000 archived records and 25,000 events', async () => {
  const db = new Database(`scale-${crypto.randomUUID()}`);
  const repo = new WorkspaceRepository(db);
  try {
    const root = await repo.initialize();
    const keys = generateNKeysBetween(null, null, 20);
    const cols: Column[] = keys.map((orderKey, i) => ({
      ...newMeta(),
      boardId: root.id,
      name: `Column ${i}`,
      orderKey,
      isDefaultNewItemColumn: i === 0,
      startsWorkOnFirstEntry: false,
      completesItemOnEntry: false,
    }));
    await db.columns.bulkAdd(cols);
    const template = await repo.create(root.id, 'Fixture');
    const itemKeys = generateNKeysBetween(null, null, 11000);
    const rows: Item[] = itemKeys.map((orderKey, i) => ({
      ...template,
      id: crypto.randomUUID(),
      title: `Fixture ${i}`,
      columnId: cols[i % 20]!.id,
      orderKey,
      archivedAt: i >= 1000 ? new Date().toISOString() : null,
    }));
    await db.items.delete(template.id);
    await db.events.clear();
    await db.items.bulkAdd(rows);
    const project = await repo.create(root.id, 'Scale project', 'project');
    const projectBoard = (await repo.projectBoard(project.id))!;
    await repo.create(projectBoard.id, 'Independent project task');
    await db.events.bulkAdd(
      Array.from({ length: 25000 }, (_, i) => ({
        id: crypto.randomUUID(),
        itemId: rows[i % rows.length]!.id,
        type: 'created' as const,
        fromColumnId: null,
        toColumnId: cols[0]!.id,
        occurredAt: new Date().toISOString(),
      })),
    );
    const started = performance.now();
    const result = await repo.items(root.id);
    expect(result).toHaveLength(1001);
    expect(result.every((x) => !x.archivedAt)).toBe(true);
    expect(await db.events.count()).toBe(25002);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(db.items.schema.idxByName.activeBoardId).toBeDefined();
  } finally {
    await db.delete();
  }
}, 30000);
