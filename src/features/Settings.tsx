import { TagManager } from './TagManager';
import { confirmAction } from '../services/confirm';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { workspace } from '../repositories/workspace';
import {
  download,
  exportBackup,
  encryptBackup,
  readBackup,
  replaceBackup,
  type Backup,
} from '../services/backups';
import { Modal } from '../components/ui';
import type { Run } from '../services/operations';
import { RecoveryDrafts } from './RecoveryDrafts';
export function SettingsPage({ run }: { run: Run }) {
  const counts = useLiveQuery(async () => workspace.counts(), []);
  const snapshots = useLiveQuery(async () => workspace.snapshots(), []) || [];
  const [pass, setPass] = useState('');
  const [backup, setBackup] = useState<Backup | null>(null);
  const [storage, setStorage] = useState('');
  return (
    <div className="settings-page">
      <RecoveryDrafts run={run} />
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
        <button
          onClick={() =>
            run(async () => {
              const persisted = await navigator.storage?.persist?.();
              const estimate = await navigator.storage?.estimate?.();
              setStorage(
                `${persisted ? 'Persistent storage granted' : 'Browser-managed storage'} · ${((estimate?.usage || 0) / 1048576).toFixed(1)} MB used of ${((estimate?.quota || 0) / 1048576).toFixed(0)} MB available`,
              );
            })
          }
        >
          Check / request persistent storage
        </button>
        <p className="muted">
          {storage ||
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
                download(await encryptBackup(await exportBackup(), pass), true);
                setPass('');
              }, 'Encrypted backup exported')
            }
          >
            Export encrypted
          </button>
        </div>
        <h3>Import / replace</h3>
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
                  setBackup(await readBackup(await file.text(), pass));
                  setPass('');
                });
            }}
          />
        </label>
        <h3>Local recovery snapshots</h3>
        <p className="muted">
          Last five pre-replacement snapshots. These do not protect against
          device loss or browser-data deletion.
        </p>
        {snapshots.length ? (
          snapshots.map((s) => (
            <div className="snapshot" key={s.id}>
              <span>{new Date(s.createdAt).toLocaleString()}</span>
              <button
                onClick={() =>
                  run(async () => setBackup(await readBackup(s.payload, '')))
                }
              >
                Review restore
              </button>
              <button onClick={() => download(JSON.parse(s.payload))}>
                Download
              </button>
            </div>
          ))
        ) : (
          <p className="muted">No snapshots yet.</p>
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
              await replaceBackup(
                {
                  ...empty,
                  boards: [root],
                  columns: [],
                  items: [],
                  events: [],
                  tags: [],
                  relations: [],
                  scratchpads: [],
                  settings: [],
                },
                true,
              );
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
          onClose={() => setBackup(null)}
        >
          <p>Exported {new Date(backup.exportedAt).toLocaleString()}</p>
          <p>
            {backup.boards.length} boards · {backup.columns.length} columns ·{' '}
            {backup.items.length} items · {backup.events.length} history events
            · {backup.tags.length} tags
          </p>
          <p className="warning">
            Replace ALL current live data with this backup? A recovery snapshot
            of your current dataset will be retained on this device.
          </p>
          <div className="button-row">
            <button onClick={() => setBackup(null)}>Cancel</button>
            <button
              className="danger"
              onClick={() =>
                run(async () => {
                  await replaceBackup(backup, true);
                  setBackup(null);
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
