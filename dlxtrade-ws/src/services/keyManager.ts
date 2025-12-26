import * as crypto from 'crypto';
import { config } from '../config';
import { query } from '../db';
import { logger } from '../utils/logger';
import type { ApiKey } from '../types';
import { createHash } from 'crypto';

/**
 * CRITICAL ENCRYPTION POLICY:
 * - ENCRYPTION_SECRET must NEVER be rotated once deployed
 * - Old encrypted data is unrecoverable by design (security feature)
 * - If ENCRYPTION_SECRET changes, ALL users must reconnect their exchanges
 * - No fallback secrets, no recovery mechanisms, no migrations
 */

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;

function getEncryptionKey(): Buffer {
  // ENFORCE: Always use ONLY process.env.ENCRYPTION_SECRET (no fallback!)
  const keyString = process.env.ENCRYPTION_SECRET;
  if (!keyString) {
    throw new Error('ENCRYPTION_SECRET environment variable is not set');
  }
  if (keyString.length < KEY_LENGTH) {
    throw new Error(`ENCRYPTION_SECRET must be at least ${KEY_LENGTH} characters long`);
  }
  return Buffer.from(keyString.slice(0, KEY_LENGTH), 'utf8');
}

function getIV(): Buffer {
  return crypto.randomBytes(IV_LENGTH);
}

export function encrypt(text: string): string {
  if (!text) return '';
  try {
    const key = getEncryptionKey();
    const iv = getIV();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const ivBase64 = iv.toString('base64');
    return `${ivBase64}:${encrypted}`;
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Encryption failed');
    throw new Error('Failed to encrypt data');
  }
}

export function decrypt(cipherText: string): string | null {
  // CRITICAL: If encrypted value is missing or empty, do NOT attempt decryption
  // Treat as unconfigured provider / invalidated keys
  if (!cipherText || cipherText.trim().length === 0) {
    return null;
  }

  try {
    const key = getEncryptionKey();
    const parts = cipherText.split(':');

    // STANDARD FORMAT: iv:encrypted
    if (parts.length === 2) {
      const [ivBase64, encryptedBase64] = parts;
      const iv = Buffer.from(ivBase64, 'base64');

      if (iv.length === IV_LENGTH) {
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        let decrypted = decipher.update(encryptedBase64, 'base64', 'utf8');
        decrypted += decipher.final('utf8');

        // CRITICAL: If decryption succeeded but result is empty, treat as corrupted
        if (!decrypted || decrypted.trim() === '') {
          logger.warn({
            cipherTextLength: cipherText.length,
            cipherTextPrefix: cipherText.substring(0, 20) + '...'
          }, 'Decryption succeeded but returned empty string - treating as CORRUPTED');
          return null;
        }

        return decrypted;
      }
    }

    // Invalid format or corrupted value
    logger.warn({
      cipherTextLength: cipherText.length,
      cipherTextFormat: parts.length === 2 ? 'iv:encrypted' : 'unknown'
    }, 'Decryption failed - invalid format or wrong encryption secret - treating as CORRUPTED');
    return null;
  } catch (error) {
    // Expected failure when ENCRYPTION_SECRET mismatches old data
    logger.warn({
      error: (error as Error).message,
      cipherTextLength: cipherText?.length || 0
    }, 'Decryption failed - invalid ENCRYPTION_SECRET or corrupted data - treating as CORRUPTED');
    return null;
  }
}

/**
 * Decrypt with hard fail - throws error if decryption fails
 * Use this for exchange API keys where empty string means invalid credentials
 */
export function decryptOrThrow(cipherText: string, fieldName: string = 'field'): string {
  if (!cipherText) {
    throw new Error(`EXCHANGE_KEY_DECRYPTION_FAILED: ${fieldName} is empty or missing`);
  }

  const decrypted = decrypt(cipherText);

  if (decrypted === null) {
    const encryptionKeyHash = getEncryptionKeyHash(8);
    logger.error({
      fieldName,
      encryptionKeyHash,
      cipherTextLength: cipherText.length,
      cipherTextPrefix: cipherText.substring(0, 20) + '...'
    }, 'EXCHANGE_KEY_DECRYPTION_FAILED: Decryption returned null - CORRUPTED key');
    throw new Error(
      `EXCHANGE_KEY_DECRYPTION_FAILED: Failed to decrypt ${fieldName} - invalid ENCRYPTION_SECRET or corrupted data. ` +
      'Please re-enter your exchange API keys.'
    );
  }

  return decrypted;
}

// FIXED: Hash MUST be derived from the SAME key used for encryption/decryption
export function getEncryptionKeyHash(prefixLength: number = 8): string {
  const key = process.env.ENCRYPTION_SECRET || '';
  const digest = createHash('sha256').update(key).digest('hex');
  return digest.slice(0, prefixLength);
}

export async function listKeys(): Promise<Omit<ApiKey, 'apiKey' | 'apiSecret'>[]> {
  const rows = await query<any>(`
    SELECT id, exchange, name, testnet, created_at, updated_at
    FROM api_keys
    ORDER BY created_at DESC
  `);

  return rows.map((row) => ({
    id: row.id.toString(),
    exchange: row.exchange,
    name: row.name,
    testnet: row.testnet,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getKey(id: number): Promise<ApiKey | null> {
  const rows = await query<any>(
    'SELECT * FROM api_keys WHERE id = $1',
    [id]
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  const apiKey = decrypt(row.api_key_encrypted);
  const apiSecret = decrypt(row.api_secret_encrypted);

  // If decryption failed, return null to indicate corrupted keys
  if (apiKey === null || apiSecret === null) {
    logger.warn({ id: row.id, exchange: row.exchange }, 'API key decryption returned null - CORRUPTED data');
    return null;
  }

  return {
    id: row.id.toString(),
    exchange: row.exchange,
    name: row.name,
    apiKey,
    apiSecret,
    testnet: row.testnet,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createKey(
  exchange: string,
  name: string,
  apiKey: string,
  apiSecret: string,
  testnet: boolean
): Promise<number> {
  const rows = await query<any>(
    `INSERT INTO api_keys (exchange, name, api_key_encrypted, api_secret_encrypted, testnet)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [exchange, name, encrypt(apiKey), encrypt(apiSecret), testnet]
  );

  logger.info({ exchange, name, testnet }, 'API key created');
  return rows[0].id;
}

export async function updateKey(
  id: number,
  updates: Partial<{ name: string; apiKey: string; apiSecret: string; testnet: boolean }>
): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (updates.name !== undefined) {
    fields.push(`name = $${paramCount++}`);
    values.push(updates.name);
  }
  if (updates.apiKey !== undefined) {
    fields.push(`api_key_encrypted = $${paramCount++}`);
    values.push(encrypt(updates.apiKey));
  }
  if (updates.apiSecret !== undefined) {
    fields.push(`api_secret_encrypted = $${paramCount++}`);
    values.push(encrypt(updates.apiSecret));
  }
  if (updates.testnet !== undefined) {
    fields.push(`testnet = $${paramCount++}`);
    values.push(updates.testnet);
  }

  if (fields.length === 0) return;

  fields.push(`updated_at = NOW()`);
  values.push(id);

  await query(
    `UPDATE api_keys SET ${fields.join(', ')} WHERE id = $${paramCount}`,
    values
  );

  logger.info({ id }, 'API key updated');
}

export async function deleteKey(id: number): Promise<void> {
  await query('DELETE FROM api_keys WHERE id = $1', [id]);
  logger.info({ id }, 'API key deleted');
}

export function maskKey(key: string): string {
  if (!key || key.length <= 8) return '****';
  if (key.length > 20) {
    return `****${key.slice(-4)}`;
  }
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export const keyManager = {
  encrypt,
  decrypt,
  decryptOrThrow,
  maskKey
};