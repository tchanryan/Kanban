import { z } from 'zod';
import type { WorkspaceBackupStore } from '../../contracts/backups';
import type { RecoverySnapshot } from '../../contracts/workspace';
import { validateBackup, type Backup } from '../../domain/backup';
import type { DurableDrafts } from './durableDrafts';
import { type NativeTransport, versionSchema } from './transport';

export class DesktopBackupStore implements WorkspaceBackupStore {
  private reviewed: { ticket: string; payload: string } | undefined;
  public constructor(
    private readonly transport: NativeTransport,
    private readonly drafts: Pick<DurableDrafts, 'flushAll'>,
    private readonly reload: () => void = () => window.location.reload(),
  ) {}
  public async export(): Promise<Backup> {
    return validateBackup(await this.transport.invoke('portable_export'));
  }
  public async preview(backup: Backup): Promise<string> {
    this.reviewed = undefined;
    const validated = validateBackup(backup);
    const preview = z
      .object({ ticket: z.uuid(), expected: versionSchema })
      .parse(
        await this.transport.invoke('portable_preview', { backup: validated }),
      );
    this.reviewed = {
      ticket: preview.ticket,
      payload: JSON.stringify(validated),
    };
    return preview.ticket;
  }
  public async replace(backup: Backup, ticket?: string): Promise<void> {
    if (
      !ticket ||
      ticket !== this.reviewed?.ticket ||
      JSON.stringify(validateBackup(backup)) !== this.reviewed.payload
    )
      throw Error('Review this backup again before importing.');
    this.reviewed = undefined;
    const root = document.getElementById('root');
    if (root) root.inert = true;
    try {
      await this.drafts.flushAll();
      z.object({ current: versionSchema }).parse(
        await this.transport.invoke('portable_import', {
          ticket,
          confirmed: true,
        }),
      );
      this.reload();
    } catch (error) {
      if (root) root.inert = false;
      throw error;
    }
  }
  public async snapshots(): Promise<RecoverySnapshot[]> {
    return [];
  }
}
