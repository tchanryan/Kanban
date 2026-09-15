import { afterEach, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { AsyncCheckbox } from './AsyncCheckbox';
import type { Run } from '../services/operations';

afterEach(cleanup);

it('keeps the selection after save until the subscription catches up, then accepts external changes', async () => {
  let operation: Promise<unknown>;
  const run: Run = (fn) => {
    operation = fn();
  };
  const save = vi.fn().mockResolvedValue(undefined);
  const { rerender } = render(
    <AsyncCheckbox checked={false} save={save} run={run} />,
  );
  const checkbox = screen.getByRole('checkbox');
  fireEvent.click(checkbox);
  await act(async () => {
    await operation;
  });
  expect(checkbox).toBeChecked();
  expect(checkbox).toBeDisabled();
  expect(save).toHaveBeenCalledWith(true);
  rerender(<AsyncCheckbox checked save={save} run={run} />);
  expect(checkbox).toBeChecked();
  expect(checkbox).toBeEnabled();
  rerender(<AsyncCheckbox checked={false} save={save} run={run} />);
  expect(checkbox).not.toBeChecked();
});

it('restores the saved state and reports failed writes', async () => {
  const failure = Error('Write failed');
  const report = vi.fn();
  let operation: Promise<unknown>;
  const run: Run = (fn) => {
    operation = fn().catch(report);
  };
  render(
    <AsyncCheckbox checked save={() => Promise.reject(failure)} run={run} />,
  );
  const checkbox = screen.getByRole('checkbox');
  fireEvent.click(checkbox);
  expect(checkbox).not.toBeChecked();
  await act(async () => {
    await operation;
  });
  expect(checkbox).toBeChecked();
  expect(checkbox).toBeEnabled();
  expect(report).toHaveBeenCalledWith(failure);
});
