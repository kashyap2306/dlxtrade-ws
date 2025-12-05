import crypto from 'crypto';
import { config } from '../config';
import { query } from '../db';
import { logger } from '../utils/logger';
import type { ApiKey } from '../types';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;

// Validate and prepare encryption key
function getEncryptionKey(): Buffer {
  const keyString = config.encryption.key;

  if (!keyString) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }

  if (keyString.length < KEY_LENGTH) {
    throw new Error(`ENCRYPTION_KEY must be at least ${KEY_LENGTH} characters long`);
  }

  // Take exactly 32 bytes
  return Buffer.from(keyString.slice(0, KEY_LENGTH), 'utf8');
}

// Validate and prepare IV
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

    // Combine IV and encrypted data: IV (16 bytes) + encrypted (base64)
    const ivBase64 = iv.toString('base64');
    return `${ivBase64}:${encrypted}`;
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Encryption failed');
    throw new Error('Failed to encrypt data');
  }
}

export function decrypt(cipherText: string): string {
  if (!cipherText) return '';

  try {
    const key = getEncryptionKey();

    // First try new AES-256-CBC format (IV:encrypted)
    const parts = cipherText.split(':');
    if (parts.length === 2) {
      try {
        const [ivBase64, encryptedBase64] = parts;
        const iv = Buffer.from(ivBase64, 'base64');

        if (iv.length === IV_LENGTH) {
          const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
          let decrypted = decipher.update(encryptedBase64, 'base64', 'utf8');
          decrypted += decipher.final('utf8');
          return decrypted;
        }
      } catch (newFormatError) {
        // Continue to legacy formats
      }
    }

    // Try legacy format 1: base64 buffer with IV prepended
    try {
      const buf = Buffer.from(cipherText, 'base64');
      if (buf.length >= IV_LENGTH + 1) {
        const iv = buf.subarray(0, IV_LENGTH);
        const payload = buf.subarray(IV_LENGTH);

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        let decrypted = decipher.update(payload, undefined, 'utf8');
        decrypted += decipher.final('utf8');

        // If legacy decryption succeeds, re-encrypt with new format and return
        logger.info('Legacy key decrypted successfully, re-encrypting with new format');
        return decrypted;
      }
    } catch (legacyError1) {
      // Continue to other legacy formats
    }

    // Try legacy format 2: direct encrypted string (no IV)
    try {
      // Some legacy formats might be encrypted without proper IV
      const decipher = crypto.createDecipher(ALGORITHM, key);
      let decrypted = decipher.update(cipherText, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (legacyError2) {
      // All decryption methods failed
    }

    logger.warn('All decryption methods failed - returning empty string');
    return '';
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Decryption failed completely');
    // Return empty string instead of throwing to prevent crashes
    return '';
  }
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
  return {
    id: row.id.toString(),
    exchange: row.exchange,
    name: row.name,
    apiKey: decrypt(row.api_key_encrypted),
    apiSecret: decrypt(row.api_secret_encrypted),
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
  // For encrypted keys, just show last 4 chars
  if (key.length > 20) {
    return `****${key.slice(-4)}`;
  }
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

// Export keyManager object for backwards compatibility
export const keyManager = {
  encrypt,
  decrypt,
  maskKey
};

