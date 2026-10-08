import type { Item } from '../domain/model';
import type { WorkItemRepository } from '../contracts/workspace';
import type { ItemDeletion } from './workItemMutations';

/** Coordinates user confirmation; the repository owns transactional data rules. */
export class WorkItemActions {
  public constructor(
    private readonly repository: WorkItemRepository,
    private readonly confirm: (message: string) => Promise<boolean>,
    private readonly deletion: ItemDeletion,
  ) {}

  public async move(
    item: Item,
    columnId: string,
    beforeId: string | null = null,
  ): Promise<void> {
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

  public async deleteFromTile(item: Item): Promise<void> {
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
    await this.deletion.delete(item.id, true);
  }
}
