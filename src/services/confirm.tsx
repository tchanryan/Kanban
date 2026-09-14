import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';

type Request = {
  message: string;
  requiredText: string | undefined;
  resolve: (value: boolean) => void;
  id: number;
  notice: boolean;
};
let sequence = 0;
const queue: Request[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
export function confirmAction(
  message: string,
  requiredText?: string,
  notice = false,
): Promise<boolean> {
  return new Promise((resolve) => {
    queue.push({ message, requiredText, resolve, id: ++sequence, notice });
    emit();
  });
}
function Confirmation({ request }: { request: Request }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const description = useId();
  const [text, setText] = useState('');
  const destructive = /delete|discard|clears all/i.test(request.message);
  const finish = (accepted: boolean) => {
    ref.current?.close();
    queue.shift();
    emit();
    request.resolve(accepted);
  };
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    cancel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirmation-dialog"
      aria-label={
        request.notice
          ? 'Notice'
          : destructive
            ? 'Confirm deletion or discard'
            : 'Confirm action'
      }
      aria-describedby={description}
      onCancel={(event) => {
        event.preventDefault();
        finish(false);
      }}
    >
      <span className="eyebrow">
        {destructive ? 'Please confirm' : 'Before you continue'}
      </span>
      <h2>
        {request.notice
          ? 'Notice'
          : destructive
            ? 'Are you sure?'
            : 'Confirm action'}
      </h2>
      <p id={description}>{request.message}</p>
      {request.requiredText && (
        <label className="field">
          Type {request.requiredText} to confirm
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
      )}
      <div className="confirmation-actions">
        {!request.notice && (
          <button ref={cancel} onClick={() => finish(false)}>
            Cancel
          </button>
        )}
        <button
          ref={request.notice ? cancel : undefined}
          className={destructive ? 'danger' : 'primary'}
          disabled={!!request.requiredText && text !== request.requiredText}
          onClick={() => finish(true)}
        >
          {request.notice ? 'OK' : destructive ? 'Confirm' : 'Continue'}
        </button>
      </div>
    </dialog>
  );
}
export function ConfirmationHost() {
  const request = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => queue[0],
  );
  return request
    ? createPortal(
        <Confirmation key={request.id} request={request} />,
        document.body,
      )
    : null;
}
