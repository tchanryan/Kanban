import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { workspace } from '../repositories/workspace';
import { Autosave, Markdown } from '../components/ui';
export function Scratchpad() {
  const scratch = useLiveQuery(async () => workspace.scratch(), []);
  const [notesPreview, setNotesPreview] = useState(false);
  return (
    <section className="scratchpad">
      <div className="section-heading">
        <h2>Quick Notes</h2>
        <button onClick={() => setNotesPreview(!notesPreview)}>
          {notesPreview ? 'Edit' : 'Preview'}
        </button>
      </div>
      <p className="muted">A little space to clear your mind.</p>
      {notesPreview ? (
        <Markdown text={scratch?.content || ''} />
      ) : (
        <Autosave
          label="Scratchpad"
          draftKey="scratchpad-global"
          value={scratch?.content || ''}
          save={(text, expected) => workspace.saveScratch(text, expected)}
          multiline
        />
      )}
      {scratch && (
        <small className="muted">
          Updated {new Date(scratch.updatedAt).toLocaleString()}
        </small>
      )}
    </section>
  );
}
