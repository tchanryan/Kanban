import { confirmAction } from '../services/confirm';
import {
  useEffect,
  useRef,
  useSyncExternalStore,
  lazy,
  Suspense,
  type ReactNode,
} from 'react';

import {
  getDraft,
  subscribeDraft,
  editDraft,
  flushDraft,
  discardDrafts,
  rebaseDraft,
} from '../services/drafts';
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose} aria-label={title}>
      <div className="modal-heading">
        <h2>{title}</h2>
        <button aria-label="Close dialog" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Autosave({
  value,
  save,
  label,
  draftKey,
  multiline = false,
}: {
  value: string;
  save: (value: string, expected: string) => Promise<unknown>;
  label: string;
  draftKey: string;
  multiline?: boolean;
}) {
  const draft = useSyncExternalStore(
    (listener) => subscribeDraft(draftKey, listener),
    () => getDraft(draftKey),
  );
  useEffect(
    () => () => {
      void flushDraft(draftKey).catch(() => undefined);
    },
    [draftKey],
  );
  const props = {
    'aria-label': label,
    value: draft?.text ?? value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      editDraft(draftKey, e.target.value, save, value, label),
    onBlur: () => {
      void flushDraft(draftKey).catch(() => undefined);
    },
  };
  return (
    <div className="field">
      <label htmlFor={draftKey}>{label}</label>
      {multiline ? (
        <textarea id={draftKey} {...props} rows={10} />
      ) : (
        <input id={draftKey} {...props} />
      )}
      <span className="save-state" role="status">
        {draft?.status || 'Saved'}
        {draft?.status.startsWith('Save failed') && (
          <button
            type="button"
            onClick={async () => {
              editDraft(draftKey, draft.text, save, value, label);
              void flushDraft(draftKey).catch(() => undefined);
            }}
          >
            Retry
          </button>
        )}
      </span>
      {draft?.status.startsWith('Save failed') && (
        <div className="draft-recovery">
          <p role="alert">{draft.error}</p>
          <p>Currently saved:</p>
          <pre>{value || '(empty)'}</pre>
          <div className="button-row">
            <button
              type="button"
              onClick={async () => {
                if (
                  await confirmAction(
                    'Discard this unsaved draft and use the currently saved text?',
                  )
                )
                  discardDrafts(draftKey);
              }}
            >
              Use saved version
            </button>
            <button
              type="button"
              onClick={async () => {
                if (
                  await confirmAction(
                    'Replace the currently saved text with your draft?',
                  )
                ) {
                  rebaseDraft(draftKey, value, save);
                  void flushDraft(draftKey).catch(() => undefined);
                }
              }}
            >
              Keep my text
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const MarkdownContent = lazy(() =>
  import('./Markdown').then((module) => ({ default: module.Markdown })),
);
export function Markdown({ text }: { text: string }) {
  return (
    <Suspense fallback={<p role="status">Loading preview…</p>}>
      <MarkdownContent text={text} />
    </Suspense>
  );
}
