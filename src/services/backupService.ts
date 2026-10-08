import type { BackupReview, WorkspaceBackupStore } from '../contracts/backups';
import type { DraftCoordinator } from '../contracts/platform';
import type { RecoverySnapshot } from '../contracts/workspace';
import { validateBackup, type Backup } from '../domain/backup';

export class BackupService {
  public constructor(
    private readonly store: WorkspaceBackupStore,
    private readonly drafts: Pick<DraftCoordinator, 'flush'>,
  ) {}
  public async exportBackup(): Promise<Backup> {
    await this.drafts.flush();
    return this.store.export();
  }
  public async replaceBackup(
    input: unknown,
    confirmed: boolean,
    ticket?: string,
  ): Promise<void> {
    if (!confirmed) throw Error('Confirm replacement before importing');
    const backup = validateBackup(input);
    await this.drafts.flush();
    await this.store.replace(backup, ticket);
  }
  public async reviewBackup(input: unknown): Promise<BackupReview> {
    const backup = validateBackup(input);
    await this.drafts.flush();
    const ticket = await this.store.preview?.(backup);
    return { backup, ticket };
  }
  public snapshots(): Promise<RecoverySnapshot[]> {
    return this.store.snapshots();
  }
}
