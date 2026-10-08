import type { ExternalLinkOpener } from '../contracts/platform';

export function validatedExternalUrl(address: string): string {
  if (
    address.length > 8192 ||
    Array.from(address).some((character) => {
      const code = character.codePointAt(0)!;
      return code <= 32 || code === 127;
    })
  )
    throw new Error('Only absolute HTTP or HTTPS links can be opened.');
  const url = new URL(address);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  )
    throw new Error(
      'Only HTTP or HTTPS links without credentials can be opened.',
    );
  return url.href;
}

/** Validate before delegating to the platform's browser boundary. */
export class ValidatedExternalLinks implements ExternalLinkOpener {
  public constructor(private readonly destination: ExternalLinkOpener) {}

  public async open(address: string): Promise<void> {
    await this.destination.open(validatedExternalUrl(address));
  }
}
