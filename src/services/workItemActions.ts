import type { Item } from '../domain/model';
import { workspace, type WorkspaceRepository } from '../repositories/workspace';
import { confirmAction } from './confirm';
import { deleteWorkItem } from './mutations';

/** Coordinates user confirmation; the repository owns transactional data rules. */
export class WorkItemActions {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly confirm: (message: string) => Promise<boolean>,
  ) {}

  async move(item: Item, columnId: string, beforeId: string | null = null) {
    const columns = await this.repository.columns(item.boardId);
    const destination = columns.find((column) => column.id === columnId);
    let confirmed = false;
    if (
      item.kind === 'project' &&
      destination?.completesItemOnEntry &&
      !item.completedAt
    ) {
      const remaining = (await this.repository.children(item.id)).filter(
        (child) => !child.completedAt,
      ).length;
      if (remaining) {
        confirmed = await this.confirm(
          `Complete “${item.title}” with ${remaining} incomplete child tasks? Child tasks will remain unchanged.`,
        );
        if (!confirmed) return;
      }
    }
    await this.repository.move(item.id, columnId, beforeId, confirmed);
  }

  async deleteFromTile(item: Item) {
    if (
      !(await this.confirm(
        `Permanently delete ${item.kind} “${item.title}” and its history? This cannot be undone.`,
      ))
    )
      return;
    if (item.kind === 'project') {
      const children = await this.repository.children(item.id);
      if (
        children.length &&
        !(await this.confirm(
          `This project contains ${children.length} task${children.length === 1 ? '' : 's'}, including any completed tasks. Permanently delete the project, all these tasks, and their history? This cannot be undone.`,
        ))
      )
        return;
    }
    await deleteWorkItem(item.id, true, this.repository);
  }
}

export const workItemActions = new WorkItemActions(workspace, confirmAction);
