import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Markdown } from './Markdown';

const open = vi.hoisted(() => vi.fn<(address: string) => Promise<void>>());
vi.mock('../app/services', () => ({
  services: { platform: { links: { open } } },
}));
beforeEach(() => {
  open.mockReset();
});
afterEach(cleanup);

it('delegates an explicit link click without navigating the embedded window', async () => {
  open.mockResolvedValue(undefined);
  render(<Markdown text="[Documentation](https://example.com/docs)" />);
  const link = screen.getByRole('link', { name: 'Documentation' });
  expect(fireEvent.click(link)).toBe(false);
  await waitFor(() =>
    expect(open).toHaveBeenCalledWith('https://example.com/docs'),
  );
});

it('shows a browser-opening failure without exposing a native error', async () => {
  open.mockRejectedValue(new Error('Native internal detail'));
  render(<Markdown text="[Documentation](https://example.com/docs)" />);
  fireEvent.click(screen.getByRole('link', { name: 'Documentation' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not open this link',
  );
  expect(screen.queryByText('Native internal detail')).not.toBeInTheDocument();
});
