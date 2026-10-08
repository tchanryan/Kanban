import type { DeletionRepository } from '../contracts/workspace';
import type { DraftCoordinator } from '../contracts/platform';
export interface ItemDeletion {
  delete(id: string, confirmed: boolean): Promise<void>;
}
export class WorkItemMutations implements ItemDeletion {
  public constructor(
    private readonly repository: DeletionRepository,
    private readonly drafts: Pick<DraftCoordinator, 'withDiscarded'>,
  ) {}
  public async delete(id: string, confirmed: boolean): Promise<void> {
    if (!confirmed) throw Error('Confirm permanent deletion');
    const children = await this.repository.children(id);
    await this.drafts.withDiscarded(
      [id, ...children.map((item) => item.id)],
      () => this.repository.deleteItem(id, true),
    );
  }
}
