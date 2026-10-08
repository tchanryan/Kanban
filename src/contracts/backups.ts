import type { Backup } from '../domain/backup';
import type { RecoverySnapshot } from './workspace';

export interface BackupReview {
  backup: Backup;
  ticket?: string | undefined;
}
/** Replacement requires a safety snapshot; canonical data and generation change atomically. */
export interface WorkspaceBackupStore {
  export(): Promise<Backup>;
  preview?(backup: Backup): Promise<string>;
  replace(backup: Backup, ticket?: string): Promise<void>;
  snapshots(): Promise<RecoverySnapshot[]>;
}
