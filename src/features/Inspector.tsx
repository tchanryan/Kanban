import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { workspace } from '../repositories/workspace';
import { colors, type Item, type Tag } from '../domain/model';
import { Autosave, Markdown } from '../components/ui';
import type { Run } from './Board';
import { deleteWorkItem } from '../services/mutations';
import { Link } from 'react-router-dom';
import { useModalIsolation } from '../components/useModalIsolation';
export function Inspector({
  id,
  onClose,
  run,
}: {
  id: string;
  onClose: () => void;
  run: Run;
}) {
  const panel = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(
    () => window.matchMedia('(max-width: 950px)').matches,
  );
  const result = useLiveQuery(
    async () => ({ item: await workspace.item(id) }),
    [id],
  );
  const item = result?.item;
  const cols =
    useLiveQuery(
      async () =>
        item ? workspace.columns(item.boardId) : Promise.resolve([]),
      [item?.boardId],
    ) || [];
  const tags = useLiveQuery(async () => workspace.tags(), []) || [];
  const relations =
    useLiveQuery(async () => workspace.itemTags(id), [id]) || [];
  const events = useLiveQuery(async () => workspace.history(id), [id]) || [];
  const [query, setQuery] = useState('');
  const [color, setColor] = useState<Tag['colorToken']>('violet');
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 950px)');
    const change = () => setNarrow(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const loadedId = item?.id;
  useModalIsolation(panel, narrow && !!loadedId);
  useEffect(() => {
    const previous = document.activeElement;
    if (loadedId) panel.current?.querySelector('input')?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [loadedId]);
  if (!item)
    return (
      <aside className="inspector">
        {result ? (
          <>
            <h2>Item unavailable</h2>
            <p>
              This item was deleted or replaced. Any unsaved text remains in{' '}
              <Link to="/settings" onClick={onClose}>
                Recovery drafts in Settings
              </Link>
              .
            </p>
          </>
        ) : (
          'Loading details…'
        )}
        <button onClick={onClose}>Close</button>
      </aside>
    );
  const patch = (value: Parameters<typeof workspace.update>[1]) =>
    run(() => workspace.update(id, value));
  const move = (columnId: string) =>
    run(async () => {
      let confirmed = false;
      const col = cols.find((c) => c.id === columnId);
      if (
        item.kind === 'project' &&
        col?.completesItemOnEntry &&
        !item.completedAt
      ) {
        const n = (await workspace.children(id)).filter(
          (x) => !x.completedAt,
        ).length;
        if (n) {
          confirmed = window.confirm(
            `Complete “${item.title}” with ${n} incomplete child tasks? Their status will not change.`,
          );
          if (!confirmed) return;
        }
      }
      await workspace.move(id, columnId, null, confirmed);
    });
  return (
    <aside
      ref={panel}
      className="inspector"
      aria-label="Item details"
      role={narrow ? 'dialog' : 'complementary'}
      aria-modal={narrow || undefined}
      onKeyDown={(e) => {
        if (!narrow || e.key !== 'Tab') return;
        const focusable = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,textarea,select,summary,a[href]',
          ) || [],
        ).filter((el) => el.getClientRects().length);
        const first = focusable[0],
          last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
    >
      <header>
        <span className="eyebrow">{item.kind} details</span>
        <button aria-label="Close details" onClick={onClose}>
          ×
        </button>
      </header>
      <Autosave
        key={`${id}-title`}
        draftKey={`${id}-title`}
        label="Title"
        value={item.title}
        save={(title, expected) =>
          workspace
            .update(id, { title }, { title: expected })
            .then((item) => item.title)
        }
      />
      <label className="field">
        Priority
        <select
          aria-label="Priority"
          value={item.priority}
          onChange={(e) =>
            patch({ priority: e.target.value as Item['priority'] })
          }
        >
          {['low', 'medium', 'high'].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Move to…
        <select value={item.columnId} onChange={(e) => move(e.target.value)}>
          {cols.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="date-fields">
        <label className="field">
          Planned start
          <input
            type="date"
            value={item.plannedStartDate || ''}
            onChange={(e) =>
              patch({ plannedStartDate: e.target.value || null })
            }
          />
        </label>
        <label className="field">
          Due date
          <input
            type="date"
            value={item.dueDate || ''}
            onChange={(e) => patch({ dueDate: e.target.value || null })}
          />
        </label>
      </div>
      <dl>
        <dt>Actual start</dt>
        <dd>
          {item.firstStartedAt
            ? new Date(item.firstStartedAt).toLocaleString()
            : 'Not started'}
        </dd>
        <dt>Completed</dt>
        <dd>
          {item.completedAt
            ? new Date(item.completedAt).toLocaleString()
            : 'Not complete'}
        </dd>
      </dl>
      {item.kind === 'project' && (
        <label className="field">
          Project colour
          <select
            value={item.projectColorToken || 'violet'}
            onChange={(e) =>
              patch({ projectColorToken: e.target.value as Tag['colorToken'] })
            }
          >
            {colors.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
      )}
      <details open>
        <summary>Tags</summary>
        <input
          aria-label="Find or create tag"
          placeholder="Find or create a tag…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="tag-picker">
          {tags
            .filter((t) =>
              t.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
            )
            .map((t) => (
              <label key={t.id} className={`check color-${t.colorToken}`}>
                <input
                  type="checkbox"
                  checked={relations.some((r) => r.tagId === t.id)}
                  onChange={(e) =>
                    run(() => workspace.setTag(id, t.id, e.target.checked))
                  }
                />
                {t.name}
              </label>
            ))}
        </div>
        {query.trim() &&
          !tags.some(
            (t) =>
              t.name.toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
          ) && (
            <div className="button-row">
              <select
                aria-label="New tag colour"
                value={color}
                onChange={(e) => setColor(e.target.value as Tag['colorToken'])}
              >
                {colors.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <button
                onClick={() =>
                  run(async () => {
                    const tag = await workspace.saveTag(query, color);
                    await workspace.setTag(id, tag.id, true);
                    setQuery('');
                  })
                }
              >
                + Create tag
              </button>
            </div>
          )}
      </details>
      <details>
        <summary>History · {events.length} events</summary>
        <ol className="history">
          {events.map((e) => (
            <li key={e.id}>
              <strong>{e.type}</strong> -{' '}
              <time dateTime={e.occurredAt}>
                {new Date(e.occurredAt).toLocaleDateString('en-US')}{' '}
                {new Date(e.occurredAt).toLocaleTimeString('en-US')}
              </time>
            </li>
          ))}
        </ol>
      </details>
      <details>
        <summary>Archive & deletion</summary>
        <div className="button-row">
          {!item.parentProjectId && !item.archivedAt && (
            <button
              onClick={() => {
                if (
                  !item.completedAt &&
                  !window.confirm(
                    `Archive incomplete ${item.kind} “${item.title}”? You can restore it later.`,
                  )
                )
                  return;
                run(async () => {
                  await workspace.archive(id, true);
                  onClose();
                }, 'Item archived');
              }}
            >
              Archive
            </button>
          )}
          {item.archivedAt && (
            <button
              onClick={() => run(() => workspace.restore(id), 'Item restored')}
            >
              Restore
            </button>
          )}
          <button
            className="danger"
            onClick={() =>
              run(async () => {
                const children =
                  item.kind === 'project' ? await workspace.children(id) : [];
                if (
                  window.confirm(
                    `Permanently delete “${item.title}”${item.kind === 'project' ? `, its board, ${children.length} child tasks, and all child history` : ' and its history'}? This cannot be undone.`,
                  )
                ) {
                  await deleteWorkItem(id, true);
                  onClose();
                }
              }, 'Deletion finished')
            }
          >
            Delete permanently…
          </button>
        </div>
      </details>
      <div className="section-heading">
        <h3>Description / Notes</h3>
        <button onClick={() => setPreview(!preview)}>
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>
      {preview ? (
        <Markdown text={item.description} />
      ) : (
        <Autosave
          key={`${id}-description`}
          draftKey={`${id}-description`}
          label="Description"
          value={item.description}
          save={(description, expected) =>
            workspace.update(id, { description }, { description: expected })
          }
          multiline
        />
      )}
    </aside>
  );
}
