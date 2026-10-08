export interface NativeBackup {
  appVersion: string | null;
  id: string;
  createdAt: string;
  version: { revision: number; generation: string };
  bytes: number;
  reason: string;
}
export interface RecoveryStatus {
  appVersion: string | null;
  available: boolean;
  storagePath: string;
  recoveryError: string | null;
  backupError: string | null;
  backups: NativeBackup[];
  secondary: {
    directory: string | null;
    error: string | null;
    backups: NativeBackup[];
  };
}
export interface RecoveryService {
  isAvailable(): Promise<boolean>;
  status(): Promise<RecoveryStatus>;
  backup(): Promise<void>;
  restore(id: string): Promise<void>;
  chooseSecondary(): Promise<void>;
  disableSecondary(): Promise<void>;
  restoreSecondary(id: string): Promise<void>;
}
