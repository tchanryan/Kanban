import { workspace, type WorkspaceRepository } from '../repositories/workspace';
import { withDiscardedDrafts } from './drafts';
export async function deleteWorkItem(
  id: string,
  confirmed: boolean,
  repository: WorkspaceRepository = workspace,
) {
  if (!confirmed) throw Error('Confirm permanent deletion');
  const children = await repository.children(id);
  return withDiscardedDrafts([id, ...children.map((item) => item.id)], () =>
    repository.deleteItem(id, true),
  );
}
