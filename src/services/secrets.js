// Шифрование секретов (токены интеграций) для хранения в БД.
// AES-256-GCM, ключ выводится из SECRETS_KEY/JWT_SECRET через SHA-256.
import crypto from 'node:crypto';
import { config } from '../config.js';

function key() {
  const base = process.env.SECRETS_KEY || config.jwt.secret || 'dev-secret';
  return crypto.createHash('sha256').update(String(base)).digest(); // 32 байта
}

// Возвращает base64(iv[12] + tag[16] + ciphertext).
export function encryptSecret(plain) {
  if (plain == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(data) {
  if (!data) return null;
  try {
    const buf = Buffer.from(String(data), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return null; // не расшифровалось (сменился ключ/повреждено)
  }
}
