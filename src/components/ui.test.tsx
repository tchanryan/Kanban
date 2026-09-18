import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { Autosave, Modal } from './ui';
import { Markdown } from './Markdown';
afterEach(cleanup);
describe('safe editable content', () => {
  it('never renders raw HTML or remote markdown images', async () => {
    const { container } = render(
      <Markdown
        text={
          '<script>alert(1)</script>\n\n![tracking](https://example.com/track)\n\n**Hello**'
        }
      />,
    );
    await screen.findByText('Hello');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
  it('retains failed text and allows retry', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(Error('quota'))
      .mockResolvedValue(undefined);
    render(
      <Autosave
        label="Notes"
        draftKey="test-notes"
        value=""
        save={save}
        multiline
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Unsaved work' },
    });
    await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByRole('textbox')).toHaveValue('Unsaved work');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Saved'),
    );
    expect(save).toHaveBeenLastCalledWith('Unsaved work', '');
  });
  it('labels dialogs and supports close', () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    const close = vi.fn();
    render(
      <Modal title="Confirm change" onClose={close}>
        Details
      </Modal>,
    );
    fireEvent.click(screen.getByLabelText('Close dialog'));
    expect(close).toHaveBeenCalled();
  });
  it('retains a failed draft across editor unmounts', async () => {
    const fail = vi.fn().mockRejectedValue(Error('quota'));
    const view = render(
      <Autosave
        label="Retained"
        draftKey="retained-draft"
        value="Original"
        save={fail}
      />,
    );
    fireEvent.change(screen.getByLabelText('Retained'), {
      target: { value: 'Recovery text' },
    });
    await screen.findByRole('button', { name: 'Retry' });
    view.unmount();
    const success = vi.fn().mockResolvedValue(undefined);
    render(
      <Autosave
        label="Retained"
        draftKey="retained-draft"
        value="Original"
        save={success}
      />,
    );
    expect(screen.getByLabelText('Retained')).toHaveValue('Recovery text');
    await screen.findByRole('button', { name: 'Retry' });
    // Storage recovers, but retry must keep the original dataset guard rather
    // than silently adopting the callback from a newly mounted editor.
    fail.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Saved'),
    );
    expect(fail).toHaveBeenLastCalledWith('Recovery text', 'Original');
    expect(success).not.toHaveBeenCalled();
  });
});
