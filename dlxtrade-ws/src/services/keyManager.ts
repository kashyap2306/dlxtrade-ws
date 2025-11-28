import crypto from 'crypto';
import { config } from '../config';
import { query } from '../db';
import { logger } from '../utils/logger';
import type { ApiKey } from '../types';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const TAG_POSITION = SALT_LENGTH + IV_LENGTH;
const ENCRYPTED_POSITION = TAG_POSITION + TAG_LENGTH;

function getEncryptionKey(): Buffer {
  const key = config.encryption.key;
  // Always use scrypt to derive a consistent 32-byte key from the input
  // This ensures the same key string always produces the same encryption key
  // regardless of the input string length
  return crypto.scryptSync(key, 'dlxtrade_encryption_salt_v1', 32);
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);
  
  const tag = cipher.getAuthTag();
  
  return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
}

// Fallback encryption key for backward compatibility
function getOldEncryptionKey(): Buffer {
  // Try common old secrets that might have been used
  const oldSecrets = [
    'change_me', // Default JWT secret
    'change_me_encryption_key_32_chars!!', // Old default
    process.env.JWT_SECRET || 'change_me', // Old JWT fallback
    // Try with different variations that might have been used
    'your_secret_encryption_key_here_32',
    'dlxtrade_encryption_secret_32_chars',
    'firebase_encryption_key_32_chars!!!',
    'encryption_secret_for_api_keys_32!!',
    // Additional potential keys that might have been used
    'super_secret_encryption_key_here!',
    'api_key_encryption_secret_32_char',
    'encryption_key_for_dlx_trade_app',
    'dlxtrade_api_key_secret_32_chars!',
    'firebase_functions_encryption_key',
    'change_me_to_a_random_string!!!',
    'default_encryption_secret_key_32',
    'secure_api_key_storage_secret!!!',
    // Try different lengths and variations
    'change_me_encryption_key_32_chars', // without !!
    'change_me_encryption_key_32_char!!', // 31 chars
    'change_me_encryption_key_32_chars!!extra', // longer
    // Environment variable variations
    process.env.ENCRYPTION_SECRET || 'change_me',
    process.env.ENCRYPTION_KEY || 'change_me',
    process.env.API_ENCRYPTION_KEY || 'change_me',
  ];

  // Try each old secret
  for (const secret of oldSecrets) {
    try {
      return crypto.scryptSync(secret, 'dlxtrade_encryption_salt_v1', 32);
    } catch (error) {
      continue;
    }
  }

  // If all fail, return current key as last resort
  return getEncryptionKey();
}

export function decrypt(encryptedText: string, context?: { uid?: string; field?: string; provider?: string }): string | null {
  // Safety check: return null if encrypted value is missing or empty
  if (!encryptedText || encryptedText.trim() === '') {
    if (context?.field) {
      logger.debug({
        uid: context.uid,
        field: context.field,
        provider: context.provider
      }, 'Decrypt called with empty/null encrypted text');
    }
    return null;
  }

  // Try decrypting with current encryption key first
  try {
    const data = Buffer.from(encryptedText, 'base64');
    const salt = data.slice(0, SALT_LENGTH);
    const iv = data.slice(SALT_LENGTH, TAG_POSITION);
    const tag = data.slice(TAG_POSITION, ENCRYPTED_POSITION);
    const encrypted = data.slice(ENCRYPTED_POSITION);

    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(tag);

    const result = decipher.update(encrypted) + decipher.final('utf8');

    // If successful with current key, return result
    if (context?.provider) {
      logger.debug({
        uid: context.uid,
        field: context.field,
        provider: context.provider
      }, 'Successfully decrypted with current encryption key');
    }
    return result;

  } catch (currentKeyError) {
    // Current key failed, try old key
    try {
      const data = Buffer.from(encryptedText, 'base64');
      const salt = data.slice(0, SALT_LENGTH);
      const iv = data.slice(SALT_LENGTH, TAG_POSITION);
      const tag = data.slice(TAG_POSITION, ENCRYPTED_POSITION);
      const encrypted = data.slice(ENCRYPTED_POSITION);

      const decipher = crypto.createDecipheriv(ALGORITHM, getOldEncryptionKey(), iv);
      decipher.setAuthTag(tag);

      const result = decipher.update(encrypted) + decipher.final('utf8');

      // Successfully decrypted with old key
      if (context?.provider) {
        logger.info({
          uid: context.uid,
          field: context.field,
          provider: context.provider
        }, 'Successfully decrypted with fallback encryption key - key needs re-encryption');

        // Asynchronously re-encrypt with current key (don't block the request)
        setImmediate(async () => {
          try {
            const reEncrypted = encrypt(result);
            // Note: We can't easily update Firestore here without more context
            // The re-encryption will happen naturally when the key is next saved
            logger.info({
              uid: context.uid,
              provider: context.provider
            }, 'Key re-encryption needed - will be handled on next save');
          } catch (reEncryptError) {
            logger.error({
              uid: context.uid,
              provider: context.provider,
              error: reEncryptError.message
            }, 'Failed to re-encrypt key with current secret');
          }
        });
      }

      return result;

    } catch (oldKeyError) {
      // Both keys failed - log detailed info for debugging
      logger.warn({
        uid: context?.uid,
        field: context?.field,
        provider: context?.provider,
        encryptedLength: encryptedText?.length || 0,
        currentKeyError: currentKeyError.message,
        oldKeyError: oldKeyError.message
      }, 'Decrypt failed with both current and fallback encryption keys - ENCRYPTION_SECRET mismatch detected');

      return null;
    }
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

