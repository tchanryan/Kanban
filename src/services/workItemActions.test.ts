import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../db/database';
import { WorkspaceRepository } from '../repositories/workspace';
import { WorkItemActions } from './workItemActions';

let database: Database;
let repository: WorkspaceRepository;
let boardId: string;
let doneId: string;
const confirm = vi.fn<(message: string) => Promise<boolean>>();
let actions: WorkItemActions;

beforeEach(async () => {
  database = new Database(`actions-${crypto.randomUUID()}`);
  repository = new WorkspaceRepository(database);
  boardId = (await repository.initialize()).id;
  for (const name of ['Todo', 'Done']) {
    const column = await repository.saveColumn(boardId, {
      name,
      isDefaultNewItemColumn: name === 'Todo',
      startsWorkOnFirstEntry: false,
      completesItemOnEntry: name === 'Done',
    });
    if (name === 'Done') doneId = column.id;
  }
  confirm.mockReset();
  actions = new WorkItemActions(repository, confirm);
});
afterEach(async () => database.delete());

async function projectWithChild() {
  const project = await repository.create(boardId, 'Project', 'project');
  const board = await repository.projectBoard(project.id);
  const child = await repository.create(board!.id, 'Child');
  return { project, child };
}

describe('work item actions', () => {
  it('cancels project completion without changing the project or its history', async () => {
    const { project, child } = await projectWithChild();
    confirm.mockResolvedValue(false);
    await actions.move(project, doneId);
    expect((await repository.item(project.id))?.columnId).toBe(
      project.columnId,
    );
    expect((await repository.item(child.id))?.completedAt).toBeNull();
    expect(await repository.history(project.id)).toHaveLength(1);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('completes a confirmed project while preserving incomplete children', async () => {
    const { project, child } = await projectWithChild();
    confirm.mockResolvedValue(true);
    await actions.move(project, doneId);
    expect((await repository.item(project.id))?.completedAt).not.toBeNull();
    expect((await repository.item(child.id))?.completedAt).toBeNull();
  });

  it('moves ordinary tasks without confirmation and preserves the requested order', async () => {
    const first = await repository.create(boardId, 'First');
    const second = await repository.create(boardId, 'Second');
    await actions.move(second, first.columnId, first.id);
    expect((await repository.items(boardId)).map((item) => item.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('requires the second deletion confirmation even when all children are completed', async () => {
    const { project, child } = await projectWithChild();
    const childDone = (await repository.columns(child.boardId)).find(
      (column) => column.completesItemOnEntry,
    )!;
    await repository.move(child.id, childDone.id);
    confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await actions.deleteFromTile(project);
    expect(await repository.item(project.id)).toBeDefined();
    expect(await repository.item(child.id)).toBeDefined();
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockResolvedValue(true);
    await actions.deleteFromTile(project);
    expect(await repository.item(project.id)).toBeUndefined();
    expect(await repository.item(child.id)).toBeUndefined();
    expect(await repository.projectBoard(project.id)).toBeUndefined();
  });

  it('keeps a task when the first deletion confirmation is cancelled', async () => {
    const task = await repository.create(boardId, 'Keep');
    confirm.mockResolvedValue(false);
    await actions.deleteFromTile(task);
    expect(await repository.item(task.id)).toBeDefined();
    expect(confirm).toHaveBeenCalledOnce();
  });
});
