import { confirmAction } from '../services/confirm';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Archive } from 'lucide-react';
import { workspace } from '../repositories/workspace';
import { deleteWorkItem } from '../services/mutations';
import type { Item } from '../domain/model';
import type { Run } from '../services/operations';
type Cursor = { date: string; id: string } | null;
export function ArchivePage({
  onOpen,
  run,
}: {
  onOpen: (item: Item) => void;
  run: Run;
}) {
  const [q, setQ] = useState('');
  const [cursors, setCursors] = useState<Cursor[]>([null]);
  const cursor = cursors.at(-1) || null;
  const page = useLiveQuery(
    () => workspace.archivePage(q, cursor),
    [q, cursor],
  );
  const items = page?.items || [];
  return (
    <section className="archive-page">
      <h2>Room for what’s next. A record of what’s done.</h2>
      <p className="muted">
        Completed top-level work moves here after 14 days. Projects keep their
        child tasks and history.
      </p>
      <input
        aria-label="Search archive"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setCursors([null]);
        }}
        placeholder="Search archive…"
      />
      {!page ? (
        <p role="status">Loading archive…</p>
      ) : !items.length ? (
        <div className="empty-state">
          <Archive size={32} />
          <h3>
            {cursor
              ? 'No items on this page'
              : q
                ? 'No matching archived work'
                : 'No archived work'}
          </h3>
          <p>Your history will be here when you need it.</p>
        </div>
      ) : (
        <div className="archive-list">
          {items.map((i) => (
            <div className="archive-row" key={i.id}>
              <button onClick={() => onOpen(i)}>
                <span className="eyebrow">{i.kind}</span>
                <strong>{i.title}</strong>
                <small>
                  Completed:{' '}
                  {i.completedAt
                    ? new Date(i.completedAt).toLocaleDateString()
                    : 'Not complete'}{' '}
                  · Archived: {new Date(i.archivedAt!).toLocaleDateString()}
                </small>
              </button>
              <button
                onClick={() =>
                  run(async () => {
                    const fallback = await workspace.restore(i.id);
                    if (fallback)
                      await confirmAction(
                        'Restored to the default column because the previous column no longer exists.',
                        undefined,
                        true,
                      );
                  }, 'Item restored')
                }
              >
                Restore
              </button>
              <button
                className="danger"
                onClick={() =>
                  run(async () => {
                    const children =
                      i.kind === 'project'
                        ? await workspace.children(i.id)
                        : [];
                    if (
                      await confirmAction(
                        `Permanently delete “${i.title}”${i.kind === 'project' ? `, its board and ${children.length} child tasks` : ''}, including all associated history? This cannot be undone.`,
                      )
                    )
                      await deleteWorkItem(i.id, true);
                  })
                }
              >
                Delete…
              </button>
            </div>
          ))}
        </div>
      )}
      <nav className="archive-pagination button-row" aria-label="Archive pages">
        <button
          disabled={cursors.length === 1}
          onClick={() => setCursors((x) => x.slice(0, -1))}
        >
          Previous page
        </button>
        <span role="status">
          Page {cursors.length} · {items.length} items
        </span>
        <button
          disabled={!page?.nextCursor}
          onClick={async () => {
            if (page?.nextCursor) setCursors((x) => [...x, page.nextCursor]);
          }}
        >
          Next page
        </button>
      </nav>
    </section>
  );
}
