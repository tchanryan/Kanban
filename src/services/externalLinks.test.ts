import { expect, it, vi } from 'vitest';
import { ValidatedExternalLinks } from './externalLinks';

it('normalizes web links and preserves the injected destination receiver', async () => {
  const destination = {
    open: vi.fn(async function (this: unknown, address: string): Promise<void> {
      expect(this).toBe(destination);
      expect(address).toBe('https://example.com/path?q=one#two');
    }),
  };
  await new ValidatedExternalLinks(destination).open(
    'https://EXAMPLE.com/path?q=one#two',
  );
  expect(destination.open).toHaveBeenCalledOnce();
});

it.each([
  'file:///C:/Windows/win.ini',
  'javascript:alert(1)',
  'data:text/html,x',
  'mailto:user@example.com',
  '//example.com',
  '/relative',
  '',
  'https://user:secret@example.com',
  'https://example.com\n',
  'https://example.com/' + 'a'.repeat(8192),
])(
  'rejects unsafe input before invoking the destination: %s',
  async (address) => {
    const destination = { open: vi.fn(async (): Promise<void> => {}) };
    await expect(
      new ValidatedExternalLinks(destination).open(address),
    ).rejects.toThrow();
    expect(destination.open).not.toHaveBeenCalled();
  },
);
