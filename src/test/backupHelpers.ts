import type { Database } from '../db/database';
import { DexieBackupStore } from '../repositories/dexieBackupStore';
import { BackupService } from '../services/backupService';
import { webDrafts } from '../platform/web/drafts';
import type { Backup } from '../domain/backup';
export {
  validateBackup,
  encryptBackup,
  readBackup,
} from '../services/backupCodec';
export function exportBackup(database: Database): Promise<Backup> {
  return new BackupService(
    new DexieBackupStore(database),
    webDrafts,
  ).exportBackup();
}
export function replaceBackup(
  input: unknown,
  confirmed: boolean,
  database: Database,
): Promise<void> {
  return new BackupService(
    new DexieBackupStore(database),
    webDrafts,
  ).replaceBackup(input, confirmed);
}
