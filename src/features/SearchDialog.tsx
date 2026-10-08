import { useState, useEffect } from 'react';
import { useWorkspaceQuery } from '../components/useWorkspaceQuery';
import { QueryStatus } from '../components/QueryStatus';
import { Modal } from '../components/ui';
import type { Item } from '../domain/model';
export function SearchDialog({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (item: Item) => void;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [archived, setArchived] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(timer);
  }, [q]);
  const searchQuery = useWorkspaceQuery('search', debounced, archived);
  const items = searchQuery.status === 'ready' ? searchQuery.data : [];
  return (
    <Modal title="Search your work" onClose={onClose}>
      <input
        autoFocus
        data-autofocus
        aria-label="Search titles, notes and tags"
        placeholder="Search titles, notes and tags…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => setArchived(e.target.checked)}
        />
        Include archived work
      </label>
      <div className="search-results">
        <QueryStatus queries={[searchQuery]} label="search results" />
        {items.map((i) => (
          <button
            key={i.id}
            onClick={() => {
              onClose();
              onOpen(i);
            }}
          >
            <span className="eyebrow">
              {i.kind}
              {i.archivedAt ? ' · archived' : ''}
            </span>
            <strong>{i.title}</strong>
          </button>
        ))}
        {searchQuery.status === 'ready' && !items.length && (
          <p className="muted">
            {q ? 'No matching work.' : 'Type to search your local workspace.'}
          </p>
        )}
      </div>
    </Modal>
  );
}
