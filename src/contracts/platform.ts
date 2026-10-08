import type { RecoveryService } from './recovery';
export interface DraftCoordinator {
  flush(): Promise<void>;
  withDiscarded<T>(ids: string[], operation: () => Promise<T>): Promise<T>;
}
export interface FileDelivery {
  download(data: unknown, encrypted?: boolean): void | Promise<void>;
}
export interface StorageStatus {
  persisted: boolean;
  usage: number;
  quota: number;
}
export interface StorageAccess {
  requestPersistence(): Promise<StorageStatus>;
}
export interface ExternalLinkOpener {
  open(address: string): Promise<void>;
}
export interface PlatformServices {
  links: ExternalLinkOpener;
  recovery?: RecoveryService;
  storageDescription?: string;
  files: FileDelivery;
  storage: StorageAccess;
  drafts: DraftCoordinator;
  confirm(message: string): Promise<boolean>;
}
