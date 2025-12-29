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
 *
 * CRITICAL INVALID_KEYS PROTECTION:
 * - decrypt() failures MUST NEVER set INVALID_KEYS or mutate exchangeStatus
 * - Decryption failures should be treated as "exchange not configured" not "invalid keys"
 * - INVALID_KEYS is ONLY for credential validation failures, not encryption failures
 */

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;

// CRITICAL: SINGLE SOURCE OF TRUTH - Cached encryption key resolved ONCE at process startup
let CACHED_ENCRYPTION_KEY: Buffer | null = null;
let CACHED_ENCRYPTION_SECRET: string | null = null;
let CACHED_KEY_HASH: string | null = null;

/**
 * CRITICAL: Initialize encryption key cache at server startup
 * This MUST be called once before any encrypt/decrypt operations
 * Throws immediately if ENCRYPTION_SECRET is invalid/missing
 */
export function initializeEncryptionKey(): void {
  if (CACHED_ENCRYPTION_KEY !== null) {
    // Already initialized - this should never happen in normal operation
    logger.warn('initializeEncryptionKey() called multiple times - this should not happen');
    return;
  }

  const keyString = process.env.ENCRYPTION_SECRET;
  if (!keyString) {
    throw new Error('ENCRYPTION_SECRET environment variable is not set - server cannot start without valid encryption key');
  }
  if (keyString.length < KEY_LENGTH) {
    throw new Error(`ENCRYPTION_SECRET must be at least ${KEY_LENGTH} characters long, got ${keyString.length}`);
  }

  // Cache the key and secret for lifetime of process
  CACHED_ENCRYPTION_SECRET = keyString;
  CACHED_ENCRYPTION_KEY = Buffer.from(keyString.slice(0, KEY_LENGTH), 'utf8');
  CACHED_KEY_HASH = createHash('sha256').update(keyString).digest('hex');

  logger.info({
    keyLength: keyString.length,
    keyHash: CACHED_KEY_HASH.slice(0, 8), // Log only first 8 chars of hash
    source: 'ENCRYPTION_SECRET'
  }, '🔐 ENCRYPTION KEY CACHED - Single source of truth established for process lifetime');
}

function getEncryptionKey(): Buffer {
  // CRITICAL: Must use cached key only - never re-read from process.env
  if (CACHED_ENCRYPTION_KEY === null) {
    throw new Error('ENCRYPTION KEY NOT INITIALIZED - initializeEncryptionKey() must be called at server startup');
  }
  return CACHED_ENCRYPTION_KEY;
}

function getIV(): Buffer {
  return crypto.randomBytes(IV_LENGTH);
}

export function encrypt(text: string): string {
  if (!text) return '';

  // CRITICAL: Verify key is initialized before encryption
  if (CACHED_ENCRYPTION_KEY === null || CACHED_KEY_HASH === null) {
    throw new Error('ENCRYPTION_KEY_NOT_INITIALIZED - encrypt() called before initializeEncryptionKey()');
  }

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

export function decrypt(cipherText: string, context?: string): string | null {
  // CRITICAL: If encrypted value is missing or empty, do NOT attempt decryption
  // Treat as unconfigured provider / invalidated keys
  if (!cipherText || cipherText.trim().length === 0) {
    return null;
  }

  // CRITICAL: Verify key is initialized before decryption
  if (CACHED_ENCRYPTION_KEY === null || CACHED_KEY_HASH === null) {
    logger.error('ENCRYPTION_KEY_NOT_INITIALIZED - decrypt() called before initializeEncryptionKey()');
    return null;
  }

  // RUNTIME PROTECTION: Prevent background decryption that can poison exchange usability
  // decrypt() is allowed for exchange operations and provider configurations
  const allowedContexts = ['exchange_connect', 'exchange_validate', 'user_request', 'provider_config', 'diagnostics'];
  if (context && !allowedContexts.includes(context)) {
    const error = new Error(
      `FATAL: decrypt() called in forbidden context '${context}'. ` +
      `Decryption is ONLY allowed in: ${allowedContexts.join(', ')}. ` +
      `This prevents background decryption failures from poisoning exchange usability.`
    );
    logger.error({
      context,
      allowedContexts,
      stack: error.stack
    }, '[DECRYPTION_VIOLATION]');
    throw error;
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

// CRITICAL: Hash MUST be derived from the SAME cached key used for encryption/decryption
export function getEncryptionKeyHash(prefixLength: number = 8): string {
  if (CACHED_KEY_HASH === null) {
    throw new Error('ENCRYPTION KEY NOT INITIALIZED - initializeEncryptionKey() must be called at server startup');
  }
  return CACHED_KEY_HASH.slice(0, prefixLength);
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

/**
 * CRITICAL: Verify encryption key consistency across the application
 * Call this from background jobs and API routes to ensure same key is used
 */
export function verifyEncryptionKeyConsistency(context: string): void {
  if (CACHED_ENCRYPTION_KEY === null || CACHED_KEY_HASH === null || CACHED_ENCRYPTION_SECRET === null) {
    throw new Error(`ENCRYPTION_KEY_NOT_INITIALIZED in ${context} - initializeEncryptionKey() must be called at server startup`);
  }

  // Verify the cached key still matches the original secret
  const currentKey = Buffer.from(CACHED_ENCRYPTION_SECRET.slice(0, KEY_LENGTH), 'utf8');
  if (!CACHED_ENCRYPTION_KEY.equals(currentKey)) {
    throw new Error(`ENCRYPTION_KEY_CORRUPTED in ${context} - cached key does not match original secret`);
  }

  const currentHash = getEncryptionKeyHash(8);
  logger.debug({
    context,
    keyHash: currentHash,
    cached: true
  }, `ENCRYPTION_KEY_VERIFIED in ${context} - using cached key`);
}

/**
 * CRITICAL: Get encryption key status for diagnostics
 */
export function getEncryptionKeyStatus(): {
  initialized: boolean;
  keyLength: number;
  keyHash: string;
  cached: boolean;
} {
  return {
    initialized: CACHED_ENCRYPTION_KEY !== null,
    keyLength: CACHED_ENCRYPTION_SECRET?.length || 0,
    keyHash: CACHED_KEY_HASH ? CACHED_KEY_HASH.slice(0, 8) : '',
    cached: CACHED_ENCRYPTION_KEY !== null
  };
}

/**
 * CRITICAL: Test function to verify encryption/decryption consistency
 * Used for auditing and debugging encryption stability
 */
export async function testEncryptionConsistency(): Promise<{
  success: boolean;
  keyHash: string;
  testResults: any[];
  errors: string[];
}> {
  const results = [];
  const errors = [];

  try {
    // Test 1: Verify key is cached
    const status = getEncryptionKeyStatus();
    results.push({ test: 'key_cached', success: status.cached, details: status });

    if (!status.cached) {
      errors.push('Encryption key not cached - initializeEncryptionKey() not called');
      return { success: false, keyHash: '', testResults: results, errors };
    }

    // Test 2: Verify hash consistency
    const hash1 = getEncryptionKeyHash(8);
    const hash2 = getEncryptionKeyHash(8);
    const hashConsistent = hash1 === hash2;
    results.push({ test: 'hash_consistent', success: hashConsistent, details: { hash1, hash2 } });

    if (!hashConsistent) {
      errors.push('Encryption key hash inconsistent between calls');
    }

    // Test 3: Test encrypt/decrypt round trip
    const testData = 'test_encryption_data_' + Date.now();
    const encrypted = encrypt(testData);
    const decrypted = decrypt(encrypted);
    const roundTripSuccess = decrypted === testData;
    results.push({ test: 'round_trip', success: roundTripSuccess, details: { original: testData, encrypted: encrypted?.substring(0, 20) + '...', decrypted } });

    if (!roundTripSuccess) {
      errors.push('Encrypt/decrypt round trip failed');
    }

    // Test 4: Test decryptOrThrow with valid data
    try {
      const throwResult = decryptOrThrow(encrypted, 'test_field');
      const throwSuccess = throwResult === testData;
      results.push({ test: 'decrypt_or_throw', success: throwSuccess, details: { result: throwResult } });

      if (!throwSuccess) {
        errors.push('decryptOrThrow returned wrong result');
      }
    } catch (throwErr: any) {
      errors.push(`decryptOrThrow failed: ${throwErr.message}`);
      results.push({ test: 'decrypt_or_throw', success: false, details: { error: throwErr.message } });
    }

    // Test 5: Test decryptOrThrow with invalid data
    try {
      decryptOrThrow('invalid_encrypted_data', 'test_field');
      errors.push('decryptOrThrow should have thrown for invalid data');
      results.push({ test: 'decrypt_or_throw_invalid', success: false, details: { error: 'Should have thrown' } });
    } catch (throwErr: any) {
      const expectedError = throwErr.message?.includes('EXCHANGE_KEY_DECRYPTION_FAILED');
      results.push({ test: 'decrypt_or_throw_invalid', success: expectedError, details: { error: throwErr.message } });

      if (!expectedError) {
        errors.push(`decryptOrThrow threw unexpected error: ${throwErr.message}`);
      }
    }

    const success = errors.length === 0;
    return {
      success,
      keyHash: hash1,
      testResults: results,
      errors
    };

  } catch (err: any) {
    errors.push(`Test execution failed: ${err.message}`);
    return {
      success: false,
      keyHash: '',
      testResults: results,
      errors
    };
  }
}

export const keyManager = {
  encrypt,
  decrypt,
  decryptOrThrow,
  maskKey,
  verifyEncryptionKeyConsistency,
  getEncryptionKeyStatus,
  testEncryptionConsistency
};