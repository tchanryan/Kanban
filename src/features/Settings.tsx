import { TagManager } from './TagManager';
import { confirmAction } from '../services/confirm';
import { useState } from 'react';
import { useWorkspaceQuery } from '../components/useWorkspaceQuery';
import { QueryStatus } from '../components/QueryStatus';
import { services } from '../app/services';
import {
  encryptBackup,
  readBackup,
  type Backup,
} from '../services/backupCodec';
import { Modal } from '../components/ui';
import type { Run } from '../services/operations';
import { RecoveryDrafts } from './RecoveryDrafts';
import { NativeRecovery } from './NativeRecovery';
import type { BackupReview } from '../contracts/backups';
export function SettingsPage({ run }: { run: Run }) {
  const exportBackup = (): Promise<Backup> => services.backups.exportBackup();
  const replaceBackup = (
    input: unknown,
    confirmed: boolean,
    ticket?: string,
  ): Promise<void> => services.backups.replaceBackup(input, confirmed, ticket);
  const download = async (data: unknown, encrypted = false): Promise<void> =>
    services.platform.files.download(data, encrypted);
  const countsQuery = useWorkspaceQuery('counts');
  const snapshotsQuery = useWorkspaceQuery('snapshots');
  const counts = countsQuery.status === 'ready' ? countsQuery.data : undefined;
  const snapshots =
    snapshotsQuery.status === 'ready' ? snapshotsQuery.data : [];
  const [pass, setPass] = useState('');
  const [review, setReview] = useState<BackupReview | null>(null);
  const backup = review?.backup;
  const reviewBackup = async (input: Backup): Promise<void> => {
    setReview(await services.backups.reviewBackup(input));
  };
  const [storage, setStorage] = useState('');
  return (
    <div className="settings-page">
      <QueryStatus
        queries={[countsQuery, snapshotsQuery]}
        label="storage summary"
      />
      <RecoveryDrafts run={run} />
      {services.platform.recovery && (
        <NativeRecovery service={services.platform.recovery} />
      )}
      <section className="settings-section">
        <span className="eyebrow">Your data, your device</span>
        <h2>Data & Backups</h2>
        <p>
          Data is stored on this device. Use Export/Import to move or back up
          your data. There is no automatic cross-device sync.
        </p>
        <div className="stats">
          {counts &&
            Object.entries(counts).map(([k, v]) => (
              <div key={k}>
                <strong>{v}</strong>
                <span>{k}</span>
              </div>
            ))}
        </div>
        {!services.platform.recovery && (
          <button
            onClick={() =>
              run(async () => {
                const estimate =
                  await services.platform.storage.requestPersistence();
                const persisted = estimate.persisted;
                setStorage(
                  `${persisted ? 'Persistent storage granted' : 'Browser-managed storage'} · ${((estimate?.usage || 0) / 1048576).toFixed(1)} MB used of ${((estimate?.quota || 0) / 1048576).toFixed(0)} MB available`,
                );
              })
            }
          >
            Check / request persistent storage
          </button>
        )}
        <p className="muted">
          {storage ||
            services.platform.storageDescription ||
            'IndexedDB local storage. Clearing browser site data removes your work.'}
        </p>
        <hr />
        <h3>Export a backup</h3>
        <p className="muted">
          Plain JSON contains your work notes. Encrypted backups require the
          passphrase to restore; forgotten passphrases cannot be recovered.
        </p>
        <label className="field">
          Backup passphrase
          <input
            type="password"
            autoComplete="new-password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="At least 12 characters for encryption"
          />
        </label>
        <div className="button-row">
          <button
            onClick={() =>
              run(
                async () => download(await exportBackup()),
                'JSON backup exported',
              )
            }
          >
            Export JSON
          </button>
          <button
            onClick={() =>
              run(async () => {
                await download(
                  await encryptBackup(await exportBackup(), pass),
                  true,
                );
                setPass('');
              }, 'Encrypted backup exported')
            }
          >
            Export encrypted
          </button>
        </div>
        <h3>Import / replace</h3>
        {services.platform.recovery && (
          <p>
            To move a browser workspace here, open Settings in its original
            browser profile, resolve any recovery drafts and export JSON or an
            encrypted backup. Select that file below and review it before
            confirming. Keep the original export for rollback.
          </p>
        )}
        <p className="muted">
          Choose a JSON or encrypted backup. For encrypted files enter its
          passphrase above. Review the contents before replacing. A local
          recovery snapshot is kept.
        </p>
        <label className="field">
          Backup file
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file)
                run(async () => {
                  if (file.size > 100000000)
                    throw Error('Backup exceeds 100 MB');
                  setReview(null);
                  await reviewBackup(await readBackup(await file.text(), pass));
                  setPass('');
                });
            }}
          />
        </label>
        {!services.platform.recovery && (
          <>
            <h3>Local recovery snapshots</h3>
            <p className="muted">
              Last five pre-replacement snapshots. These do not protect against
              device loss or browser-data deletion.
            </p>
            {snapshotsQuery.status !== 'ready' ? null : snapshots.length ? (
              snapshots.map((s) => (
                <div className="snapshot" key={s.id}>
                  <span>{new Date(s.createdAt).toLocaleString()}</span>
                  <button
                    onClick={() =>
                      run(async () =>
                        reviewBackup(await readBackup(s.payload, '')),
                      )
                    }
                  >
                    Review restore
                  </button>
                  <button
                    onClick={() =>
                      run(async () => download(JSON.parse(s.payload)))
                    }
                  >
                    Download
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">No snapshots yet.</p>
            )}
          </>
        )}
        <hr />
        <button
          className="danger"
          onClick={() =>
            run(async () => {
              if (
                !(await confirmAction(
                  'This clears all live tasks, projects, tags, notes and history. A local recovery snapshot will remain. Type CLEAR to continue.',
                  'CLEAR',
                ))
              )
                return;
              const empty = await exportBackup();
              const root = empty.boards.find((x) => x.kind === 'root')!;
              const cleared = await services.backups.reviewBackup({
                ...empty,
                boards: [root],
                columns: [],
                items: [],
                events: [],
                tags: [],
                relations: [],
                scratchpads: [],
                settings: [],
              });
              await replaceBackup(cleared.backup, true, cleared.ticket);
            }, 'Live data cleared; recovery snapshot retained')
          }
        >
          Clear all live data…
        </button>
      </section>
      <TagManager run={run} />
      {backup && (
        <Modal
          title="Review replacement backup"
          onClose={() => setReview(null)}
        >
          <p>Exported {new Date(backup.exportedAt).toLocaleString()}</p>
          <p>
            {backup.boards.length} boards · {backup.columns.length} columns ·{' '}
            {backup.items.length} items · {backup.events.length} history events
            · {backup.tags.length} tags · {backup.relations.length} tag links ·{' '}
            {backup.scratchpads.length} notes · {backup.settings.length}{' '}
            settings records
          </p>
          <p className="warning">
            Replace ALL current live data with this backup? A recovery snapshot
            of your current dataset will be retained on this device.
          </p>
          {services.platform.recovery && (
            <p>
              The source browser and backup file stay unchanged. Browser and
              desktop edits remain independent. Recovery drafts and internal
              snapshots are not transferred. If desktop data changes after this
              review, select the file again.
            </p>
          )}
          <div className="button-row">
            <button onClick={() => setReview(null)}>Cancel</button>
            <button
              className="danger"
              onClick={() =>
                run(async () => {
                  await replaceBackup(backup, true, review?.ticket);
                  setReview(null);
                }, 'Import completed')
              }
            >
              Confirm replace all data
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
