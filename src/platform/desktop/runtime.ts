import { tauriTransport, CommitNotifications } from './transport';
import { DurableDrafts } from './durableDrafts';
export const transport = tauriTransport();
export const notifications = new CommitNotifications();
export const desktopDrafts = new DurableDrafts(transport, notifications);
