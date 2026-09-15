import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { workspace } from '../repositories/workspace';
import type { Tag } from '../domain/model';
import { ColorPicker } from '../components/ColorPicker';
import type { Run } from '../services/operations';

export function TagPicker({ itemId, run }: { itemId: string; run: Run }) {
  const tags = useLiveQuery(() => workspace.tags(), []) || [];
  const relations =
    useLiveQuery(() => workspace.itemTags(itemId), [itemId]) || [];
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [color, setColor] = useState<Tag['colorToken']>('violet');
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const normalized = query.trim().toLocaleLowerCase();
  const matches = tags.filter((tag) =>
    tag.name.toLocaleLowerCase().includes(normalized),
  );
  const selected = tags.filter((tag) =>
    relations.some((relation) => relation.tagId === tag.id),
  );
  return (
    <section className="tag-editor" aria-label="Tags">
      <h3>Tags</h3>
      {selected.length > 0 && (
        <div className="tag-chips">
          {selected.map((tag) => (
            <button
              key={tag.id}
              className={`tag-chip color-${tag.colorToken}`}
              aria-label={`Remove tag ${tag.name}`}
              onClick={() => run(() => workspace.setTag(itemId, tag.id, false))}
            >
              <span className="tag-dot" />
              {tag.name}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
      <input
        aria-label="Find or create tag"
        placeholder="Search or create a tag…"
        maxLength={200}
        value={query}
        onFocus={() => setExpanded(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setExpanded(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && expanded) {
            event.preventDefault();
            event.stopPropagation();
            setExpanded(false);
          }
        }}
      />
      {expanded && (
        <div className="tag-suggestions">
          <div className="tag-suggestions-heading">
            <small>Tags from all tasks & projects</small>
            <button
              aria-label="Close tag suggestions"
              onClick={() => setExpanded(false)}
            >
              ×
            </button>
          </div>
          <div className="tag-options">
            {matches.map((tag) => (
              <label
                key={tag.id}
                className={`tag-option color-${tag.colorToken}`}
              >
                <input
                  type="checkbox"
                  checked={
                    pending[tag.id] ??
                    relations.some((relation) => relation.tagId === tag.id)
                  }
                  disabled={tag.id in pending}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setPending((current) => ({
                      ...current,
                      [tag.id]: checked,
                    }));
                    run(async () => {
                      try {
                        await workspace.setTag(itemId, tag.id, checked);
                      } finally {
                        setPending((current) => {
                          const next = { ...current };
                          delete next[tag.id];
                          return next;
                        });
                      }
                    });
                  }}
                />
                <span className="tag-dot" />
                <span>{tag.name}</span>
              </label>
            ))}
          </div>
          {!matches.length && (
            <p className="muted">
              {normalized
                ? 'No matching tags.'
                : 'No tags yet. Type a name to create one.'}
            </p>
          )}
          {normalized &&
            !tags.some(
              (tag) => tag.name.toLocaleLowerCase() === normalized,
            ) && (
              <div className="tag-create">
                <ColorPicker value={color} onChange={setColor} />
                <button
                  disabled={creating}
                  onClick={() =>
                    run(async () => {
                      setCreating(true);
                      try {
                        const tag = await workspace.saveTag(
                          query.trim(),
                          color,
                        );
                        await workspace.setTag(itemId, tag.id, true);
                        setQuery('');
                      } finally {
                        setCreating(false);
                      }
                    })
                  }
                >
                  + Create tag “{query.trim()}”
                </button>
              </div>
            )}
        </div>
      )}
    </section>
  );
}
