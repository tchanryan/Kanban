import { useEffect, useState } from 'react';
import type { RecoveryService, RecoveryStatus } from '../contracts/recovery';
import { confirmAction } from '../services/confirm';
import { SecondaryRecovery } from './SecondaryRecovery';

export function NativeRecovery({ service }: { service: RecoveryService }) {
  const [status, setStatus] = useState<RecoveryStatus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void service
        .status()
        .then((value) => {
          if (active) setStatus(value);
        })
        .catch((failure: unknown) => {
          if (active)
            setError(
              failure instanceof Error
                ? failure.message
                : 'Could not read backup status.',
            );
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [service]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      setStatus(await service.status());
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Recovery operation failed. Original files are retained.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="settings-section"
      aria-label="Native backups and recovery"
    >
      <h2>
        {status?.available === false ? 'Workspace recovery' : 'Native backups'}
      </h2>
      <p>
        Local snapshots are unencrypted. They protect against some mistakes and
        corruption, but not loss of this drive.
      </p>
      {status && (
        <>
          {status.appVersion && <p>Application version: {status.appVersion}</p>}
          <p>
            Storage: <code className="storage-path">{status.storagePath}</code>
          </p>
          {status.recoveryError && (
            <p role="alert">
              {status.recoveryError} Original files are retained. Select a
              backup below to recover into a separate copy.
            </p>
          )}
          {status.backupError && (
            <p role="alert">Backup needs attention: {status.backupError}</p>
          )}
          <SecondaryRecovery
            status={status.secondary}
            service={service}
            busy={busy}
            run={run}
          />
          <p>
            {status.backups.length
              ? `Last backup: ${new Date(status.backups[0]!.createdAt).toLocaleString()}. ${(status.backups.reduce((sum, entry) => sum + entry.bytes, 0) / 1048576).toFixed(1)} MB in listed snapshots.`
              : 'No completed backups are available yet.'}
          </p>
          <button
            disabled={busy || !status.available}
            onClick={() => void run(() => service.backup())}
          >
            Back up now
          </button>
          <p>
            Automatic backups run after the first change and within five minutes
            of further changes. Retention keeps 12 recent, 7 daily and 4 weekly
            snapshots, sharing files across categories.
          </p>
          <ul>
            {status.backups.map((entry) => (
              <li key={entry.id}>
                {new Date(entry.createdAt).toLocaleString()} · revision{' '}
                {entry.version.revision} · {entry.reason}{' '}
                <button
                  disabled={busy}
                  aria-label={`Restore backup ${entry.id}`}
                  onClick={() =>
                    void run(async () => {
                      if (
                        await confirmAction(
                          `Restore the backup from ${new Date(entry.createdAt).toLocaleString()} (revision ${entry.version.revision})? A healthy current workspace will be backed up first. Original files and pending recovery text will be retained.`,
                        )
                      )
                        await service.restore(entry.id);
                    })
                  }
                >
                  Restore backup
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {!status && !error && <p role="status">Checking native storage…</p>}
      {busy && <p role="status">Working…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
