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
  if (key.length < 32) {
    return crypto.scryptSync(key, 'salt', 32);
  }
  return Buffer.from(key.slice(0, 32));
}

export function encrypt(text: string): string {
  try {
    if (!text || text.trim() === '') {
      throw new Error('Cannot encrypt empty string');
    }
    
    const iv = crypto.randomBytes(IV_LENGTH);
    const salt = crypto.randomBytes(SALT_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
    
    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final(),
    ]);
    
    const tag = cipher.getAuthTag();
    
    return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Encryption failed');
    throw new Error(`Encryption failed: ${error.message}`);
  }
}

export function decrypt(encryptedText: string): string | null {
  try {
    if (!encryptedText || encryptedText.trim() === '') {
      logger.warn('Decrypt called with empty string');
      return null;
    }
    
    const data = Buffer.from(encryptedText, 'base64');
    
    // Validate data length
    if (data.length < ENCRYPTED_POSITION) {
      logger.warn('Decrypt called with invalid data length');
      return null;
    }
    
    const salt = data.slice(0, SALT_LENGTH);
    const iv = data.slice(SALT_LENGTH, TAG_POSITION);
    const tag = data.slice(TAG_POSITION, ENCRYPTED_POSITION);
    const encrypted = data.slice(ENCRYPTED_POSITION);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    
    return decipher.update(encrypted) + decipher.final('utf8');
  } catch (error: any) {
    // "Unsupported state or unable to authenticate data" - safe handling
    logger.warn({ error: error.message }, 'Decryption failed (key missing or corrupted)');
    return null;
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
  const apiKey = decrypt(row.api_key_encrypted);
  const apiSecret = decrypt(row.api_secret_encrypted);
  
  // If decryption failed, return null
  if (!apiKey || !apiSecret) {
    logger.warn({ id }, 'Failed to decrypt API key');
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
  // For encrypted keys, just show last 4 chars
  if (key.length > 20) {
    return `****${key.slice(-4)}`;
  }
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

