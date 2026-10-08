import { useState } from 'react';
import { useWorkspaceQuery } from '../components/useWorkspaceQuery';
import { QueryStatus } from '../components/QueryStatus';
import { workspace } from '../app/services';
import { Autosave, Markdown } from '../components/ui';
export function Scratchpad() {
  const scratchQuery = useWorkspaceQuery('editorScratch');
  const result = scratchQuery.data;
  const scratch = result?.scratch;
  const [notesPreview, setNotesPreview] = useState(false);
  if (!result || scratchQuery.status !== 'ready')
    return <QueryStatus queries={[scratchQuery]} label="notes" />;
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
          generation={result.generation}
          value={scratch?.content || ''}
          save={(text, expected) =>
            workspace.saveScratch(text, expected, result.generation)
          }
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
