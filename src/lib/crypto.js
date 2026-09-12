import crypto from 'node:crypto';

/**
 * Šifriranje osjetljivih vrijednosti prije upisa u bazu (AES-256-GCM).
 *
 * Štiti refresh tokene: ako netko dođe do datoteke baze, bez ključa iz okruženja
 * ne može njima pristupiti Google računu.
 */
const keyFrom = (secret) => crypto.createHash('sha256').update(String(secret)).digest();

export function encrypt(plain, secret) {
  if (plain == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decrypt(payload, secret) {
  if (!payload) return null;
  const [iv, tag, data] = String(payload).split('.');
  if (!iv || !tag || !data) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null; // kriv ključ ili oštećen zapis
  }
}

/** Tokeni aplikacije se pamte samo kao otisak — iz baze se ne mogu pročitati. */
export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');
