import { db } from '../db/database';
import { createWebServices } from '../platform/web/createWebServices';
// Desktop will use a separate entry point and supply native adapters.
export const services = createWebServices(db);
export const servicesReady = Promise.resolve();
export const { workspace, workItemActions } = services;
export const deleteWorkItem = (id: string, confirmed: boolean): Promise<void> =>
  services.mutations.delete(id, confirmed);
