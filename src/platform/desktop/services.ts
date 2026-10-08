import { createServices } from '../../app/createServices';
import { confirmAction } from '../../services/confirm';
import { DesktopWorkspaceRepository } from './desktopWorkspaceRepository';
import { NativeQuerySource } from './nativeQuerySource';
import { transport, notifications, desktopDrafts } from './runtime';
import { DesktopRecovery } from './recovery';
import { DesktopBackupStore } from './desktopBackupStore';
import { DesktopFiles } from './files';
import { ValidatedExternalLinks } from '../../services/externalLinks';
const recovery = new DesktopRecovery(transport, desktopDrafts);

export const services = createServices(
  new DesktopWorkspaceRepository(transport, notifications),
  new DesktopBackupStore(transport, desktopDrafts),
  {
    links: new ValidatedExternalLinks({
      async open(address: string): Promise<void> {
        await transport.invoke('open_external_link', { address });
      },
    }),
    recovery,
    storageDescription:
      'Disposable desktop preview. Native SQLite and verified local snapshots are separate from browser storage. Imports leave the source browser and file unchanged. Future browser and desktop edits are independent; use test data until release acceptance.',
    confirm: confirmAction,
    drafts: {
      flush: () => desktopDrafts.flushAll(),
      withDiscarded: (ids, action) => desktopDrafts.withDiscarded(ids, action),
    },
    files: new DesktopFiles(transport),
    storage: {
      requestPersistence: async () => {
        throw Error(
          'This disposable desktop preview uses native SQLite. Browser storage permissions do not apply.',
        );
      },
    },
  },
  new NativeQuerySource(notifications),
);
export const { workspace, workItemActions } = services;
export const deleteWorkItem = (id: string, confirmed: boolean): Promise<void> =>
  services.mutations.delete(id, confirmed);
export const servicesReady = (async () => {
  await transport.listen('workspace-committed', (version) =>
    notifications.publish(version),
  );
  if (await recovery.isAvailable()) await desktopDrafts.load();
  let closing = false;
  await transport.listen('desktop-close-requested', () => {
    if (closing) return;
    closing = true;
    const root = document.getElementById('root');
    if (root) root.inert = true;
    let finished = false;
    void (async () => {
      try {
        await desktopDrafts.flushAll();
      } catch {
        if (
          !(await confirmAction(
            'Some text is not saved. Keep recovery copies and close? Choose Cancel to continue editing.',
          ))
        )
          return;
        await desktopDrafts.retainAll();
      }
      await transport.invoke('finish_close');
      finished = true;
    })()
      .catch((error: unknown) => {
        window.dispatchEvent(
          new CustomEvent('save-error', {
            detail:
              error instanceof Error
                ? error.message
                : 'Could not preserve recovery text. The window will stay open.',
          }),
        );
      })
      .finally(() => {
        if (!finished) {
          closing = false;
          if (root) root.inert = false;
        }
      });
  });
  const reconcile = async (): Promise<void> => {
    try {
      notifications.publish(await transport.invoke('workspace_version'));
    } catch {
      /* Query reads surface storage errors; the next poll reconciles missed events. */
    }
  };
  await reconcile();
  window.setInterval(() => {
    void reconcile();
  }, 2000);
  window.addEventListener('focus', () => {
    void reconcile();
  });
})();
