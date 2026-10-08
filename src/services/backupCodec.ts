import { z } from 'zod';
import { validateBackup, type Backup } from '../domain/backup';
export { validateBackup, type Backup } from '../domain/backup';
const envelope = z.object({
  format: z.literal('kanban-calendar-encrypted'),
  version: z.literal(1),
  kdf: z.literal('PBKDF2-SHA256'),
  iterations: z.literal(600000),
  salt: z.string().max(100),
  iv: z.string().max(100),
  ciphertext: z.string().max(150000000),
});
export type EncryptedBackup = z.infer<typeof envelope>;
const encode = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192)
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(out);
};
const decode = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s), (x) => x.charCodeAt(0));
async function key(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function encryptBackup(
  data: Backup,
  passphrase: string,
): Promise<EncryptedBackup> {
  if (passphrase.length < 12)
    throw Error('Use a passphrase of at least 12 characters');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await key(passphrase, salt),
    new TextEncoder().encode(JSON.stringify(data)),
  );
  return {
    format: 'kanban-calendar-encrypted',
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: 600000,
    salt: encode(salt),
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(encrypted)),
  };
}
export async function readBackup(
  text: string,
  passphrase: string,
): Promise<Backup> {
  if (text.length > 100000000)
    throw Error('Backup exceeds 100 MB safety limit');
  const input: unknown = JSON.parse(text);
  if (
    typeof input === 'object' &&
    input !== null &&
    'format' in input &&
    input.format === 'kanban-calendar-encrypted'
  ) {
    const e = envelope.parse(input);
    const salt = decode(e.salt),
      iv = decode(e.iv);
    if (salt.length !== 16 || iv.length !== 12)
      throw Error('Invalid encryption parameters');
    let decrypted: ArrayBuffer;
    try {
      decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        await key(passphrase, salt),
        decode(e.ciphertext),
      );
    } catch {
      throw Error('Incorrect passphrase or damaged encrypted backup');
    }
    return validateBackup(JSON.parse(new TextDecoder().decode(decrypted)));
  }
  return validateBackup(input);
}
