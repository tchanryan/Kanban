import type { Workspace } from '../contracts/workspace';
import type { WorkspaceBackupStore } from '../contracts/backups';
import type { PlatformServices } from '../contracts/platform';
import { BackupService } from '../services/backupService';
import { WorkItemActions } from '../services/workItemActions';
import { WorkItemMutations } from '../services/workItemMutations';
import { WorkspaceQueryStore } from '../services/workspaceQueryStore';
import type { QuerySource } from '../contracts/queries';
export interface ApplicationServices {
  workspace: Workspace;
  backups: BackupService;
  mutations: WorkItemMutations;
  workItemActions: WorkItemActions;
  platform: PlatformServices;
  queries: WorkspaceQueryStore;
}
export function createServices(
  workspace: Workspace,
  backupStore: WorkspaceBackupStore,
  platform: PlatformServices,
  querySource: QuerySource,
): ApplicationServices {
  const mutations = new WorkItemMutations(workspace, platform.drafts);
  return {
    queries: new WorkspaceQueryStore(
      {
        root: () => workspace.root(),
        board: (id) => workspace.board(id),
        projectBoard: (id) => workspace.projectBoard(id),
        item: (id) => workspace.item(id),
        editorItem: (id) => workspace.editorItem(id),
        editorScratch: () => workspace.editorScratch(),
        columns: (id) => workspace.columns(id),
        items: (id) => workspace.items(id),
        children: (id) => workspace.children(id),
        tags: () => workspace.tags(),
        itemTags: (id) => workspace.itemTags(id),
        boardTagRelations: (id) => workspace.boardTagRelations(id),
        history: (id) => workspace.history(id),
        scratch: () => workspace.scratch(),
        settings: () => workspace.settings(),
        calendarItems: (includeStandalone) =>
          workspace.calendarItems(includeStandalone),
        search: (query, archived) => workspace.search(query, archived),
        archivePage: (query, cursor, limit) =>
          workspace.archivePage(query, cursor, limit),
        counts: () => workspace.counts(),
        snapshots: () => backupStore.snapshots(),
      },
      querySource,
    ),
    workspace,
    backups: new BackupService(backupStore, platform.drafts),
    mutations,
    workItemActions: new WorkItemActions(
      workspace,
      (message) => platform.confirm(message),
      mutations,
    ),
    platform,
  };
}
