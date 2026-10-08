import { z } from 'zod';
import type { RecoveryService, RecoveryStatus } from '../../contracts/recovery';
import { type NativeTransport, versionSchema } from './transport';
import type { DurableDrafts } from './durableDrafts';
const backupSchema = z.object({
  appVersion: z.string().nullable().default(null),
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  version: versionSchema,
  bytes: z.number().nonnegative(),
  reason: z.string(),
});
const statusSchema = z.object({
  appVersion: z.string().nullable(),
  available: z.boolean(),
  storagePath: z.string(),
  recoveryError: z.string().nullable(),
  backupError: z.string().nullable(),
  backups: z.array(backupSchema),
  secondary: z.object({
    directory: z.string().nullable(),
    error: z.string().nullable(),
    backups: z.array(backupSchema),
  }),
});
export class DesktopRecovery implements RecoveryService {
  public constructor(
    private readonly transport: NativeTransport,
    private readonly drafts: DurableDrafts,
  ) {}
  public async isAvailable(): Promise<boolean> {
    return z
      .boolean()
      .parse(await this.transport.invoke('workspace_available'));
  }
  public async status(): Promise<RecoveryStatus> {
    return statusSchema.parse(await this.transport.invoke('recovery_status'));
  }
  public async backup(): Promise<void> {
    await this.drafts.retainAll();
    await this.transport.invoke('backup_now');
  }
  public async restore(id: string): Promise<void> {
    await this.restoreFrom('restore_backup', id);
  }
  public async chooseSecondary(): Promise<void> {
    await this.drafts.retainAll();
    z.boolean().parse(await this.transport.invoke('choose_secondary_folder'));
  }
  public async disableSecondary(): Promise<void> {
    await this.transport.invoke('disable_secondary_folder');
  }
  public async restoreSecondary(id: string): Promise<void> {
    await this.restoreFrom('restore_secondary_backup', id);
  }
  private async restoreFrom(command: string, id: string): Promise<void> {
    z.uuid().parse(id);
    const root = document.getElementById('root');
    if (root) root.inert = true;
    try {
      await this.drafts.retainAll();
      versionSchema.parse(
        await this.transport.invoke(command, { id, confirmed: true }),
      );
      window.location.reload();
    } catch (error) {
      if (root) root.inert = false;
      throw error;
    }
  }
}
