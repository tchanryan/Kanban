import type { Database } from '../../db/database';
import { WorkspaceRepository } from '../../repositories/workspace';
import { DexieBackupStore } from '../../repositories/dexieBackupStore';
import {
  createServices,
  type ApplicationServices,
} from '../../app/createServices';
import { confirmAction } from '../../services/confirm';
import { webFiles } from './files';
import { webDrafts } from './drafts';
import type { StorageStatus } from '../../contracts/platform';
import { DexieQuerySource } from './dexieQuerySource';
import { ValidatedExternalLinks } from '../../services/externalLinks';
export function createWebServices(database: Database): ApplicationServices {
  return createServices(
    new WorkspaceRepository(database),
    new DexieBackupStore(database),
    {
      links: new ValidatedExternalLinks({
        async open(address: string): Promise<void> {
          window.open(address, '_blank', 'noopener,noreferrer');
        },
      }),
      files: webFiles,
      drafts: webDrafts,
      confirm: confirmAction,
      storage: {
        async requestPersistence(): Promise<StorageStatus> {
          const persisted = await navigator.storage?.persist?.();
          const estimate = await navigator.storage?.estimate?.();
          return {
            persisted: persisted ?? false,
            usage: estimate?.usage ?? 0,
            quota: estimate?.quota ?? 0,
          };
        },
      },
    },
    new DexieQuerySource(),
  );
}
