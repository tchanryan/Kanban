import type { RecoveryService, RecoveryStatus } from '../contracts/recovery';
import { confirmAction } from '../services/confirm';

export function SecondaryRecovery({
  status,
  service,
  busy,
  run,
}: {
  status: RecoveryStatus['secondary'];
  service: RecoveryService;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
}) {
  return (
    <div>
      <h3>Additional backup folder</h3>
      <p>
        Choose a folder on another drive for a second copy of verified
        snapshots. Copies are unencrypted. A folder on the same drive cannot
        protect against loss of that drive.
      </p>
      <p>
        {status.directory ? (
          <>
            Folder: <code className="storage-path">{status.directory}</code>
          </>
        ) : (
          'No additional folder selected.'
        )}
      </p>
      {status.error && (
        <p role="alert">
          Additional backups need attention: {status.error} Local saves and
          local backups continue.
        </p>
      )}
      <button
        disabled={busy}
        onClick={() => void run(() => service.chooseSecondary())}
      >
        Choose backup folder
      </button>{' '}
      {(status.directory || status.error) && (
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (
                await confirmAction(
                  'Stop making additional copies? Existing files in that folder will be kept.',
                )
              )
                await service.disableSecondary();
            })
          }
        >
          Stop additional copies
        </button>
      )}
      <p>
        A new selection creates a dedicated Kanban folder inside the chosen
        folder. To recover existing copies, select the dedicated folder itself.
        Back up now retries copying after you reconnect its drive.
      </p>
      {status.backups.length > 0 && (
        <>
          <p>
            {status.backups.length} verified additional snapshots. Last copy:{' '}
            {new Date(status.backups[0]!.createdAt).toLocaleString()}.
          </p>
          <ul>
            {status.backups.map((entry) => (
              <li key={entry.id}>
                {new Date(entry.createdAt).toLocaleString()} · revision{' '}
                {entry.version.revision}{' '}
                <button
                  disabled={busy}
                  aria-label={`Restore additional backup ${entry.id}`}
                  onClick={() =>
                    void run(async () => {
                      if (
                        await confirmAction(
                          `Replace the current workspace with the additional backup from ${new Date(entry.createdAt).toLocaleString()}? The copy will be verified again. Original files and pending recovery text will be retained.`,
                        )
                      )
                        await service.restoreSecondary(entry.id);
                    })
                  }
                >
                  Restore additional backup
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
