import { useSyncExternalStore } from 'react';
import {
  getDrafts,
  subscribeDrafts,
  withDiscardedDrafts,
} from '../services/drafts';
import type { Run } from './Board';
export function RecoveryDrafts({ run }: { run: Run }) {
  const drafts = useSyncExternalStore(subscribeDrafts, getDrafts);
  if (!drafts.length) return null;
  return (
    <section className="settings-section recovery-drafts">
      <h2>Recovery drafts</h2>
      <p>
        These edits have not been saved. They are retained in this tab until you
        save or discard them. Download the text before closing the browser if
        you cannot resolve a save error.
      </p>
      {drafts.map(([id, draft]) => (
        <div className="draft-recovery" key={id}>
          <h3>{draft.label}</h3>
          <p role="status">{draft.error || draft.status}</p>
          <textarea
            aria-label={`Unsaved ${draft.label}`}
            readOnly
            value={draft.text}
          />
          <div className="button-row">
            <button
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([draft.text], { type: 'text/plain' }),
                );
                const link = document.createElement('a');
                link.href = url;
                link.download = 'kanban-calendar-unsaved-note.txt';
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Download text
            </button>
            <button
              className="danger"
              onClick={() => {
                if (
                  window.confirm(
                    'Discard this unsaved draft? Download a copy first if you still need it.',
                  )
                )
                  run(() => withDiscardedDrafts([id], async () => undefined));
              }}
            >
              Discard draft
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
