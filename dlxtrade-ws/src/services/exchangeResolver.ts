import { getFirebaseAdmin } from '../utils/firebase';
import { ExchangeConnectorFactory, type ExchangeName } from './exchangeConnector';
import { decrypt, decryptOrThrow } from './keyManager';
import { firestoreAdapter, isExchangeUsable } from './firestoreAdapter';
import { logger } from '../utils/logger';

export interface ResolvedExchangeConnector {
  exchange: ExchangeName;
  connector: any;
  credentials: {
    apiKey: string;
    secret: string;
    passphrase?: string;
    testnet: boolean;
  };
}

/**
 * Unified exchange connector resolver
 * Primary source: users/{uid}/exchangeConfig/current
 * Secondary fallback: integrations system
 * 
 * Returns null if no credentials found, with detailed logging
 */
export async function resolveExchangeConnector(
  uid: string
): Promise<ResolvedExchangeConnector | null> {
  const exchangeConfig = await firestoreAdapter.getExchangeConfig(uid);
  if (exchangeConfig?.exchangeStatus === 'INVALID_KEYS') return null;
  try {
    const db = getFirebaseAdmin().firestore();

    // PRIMARY: Check exchangeConfig subcollection (where frontend saves credentials)
    const configDoc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();

    if (configDoc.exists) {
      const config = configDoc.data()!;

      // ONE-TIME CLEANUP: Delete corrupted exchangeConfig documents
      const hasExchange = !!config.exchange;
      const hasApiKey = !!config.apiKeyEncrypted;
      const hasSecret = !!(config.secretKeyEncrypted || config.secretEncrypted);

      if (!hasExchange || !hasApiKey || !hasSecret) {
        // CRITICAL: Document exists but is corrupted - delete it once
        logger.warn({
          uid,
          hasExchange,
          hasApiKey,
          hasSecret,
          existingFields: Object.keys(config)
        }, '[EXCHANGE_CONFIG_CLEANUP] Corrupted exchangeConfig found - deleting once');

        await configDoc.ref.delete();
        return null; // Treat as not connected
      }

      try {
        // Normalize exchange name
        const exchange = (config.exchange as string).toLowerCase().trim() as ExchangeName;
        const validExchanges: ExchangeName[] = ['binance', 'bitget', 'bingx', 'weex'];

        // Validate exchange name EARLY - return null immediately if invalid
        if (!validExchanges.includes(exchange)) {
          logger.warn({ uid, exchange: config.exchange }, 'Unsupported exchange name in config');
          return null;
        }

        // Proceed with decryption and connector creation
        // CRITICAL: Use decryptOrThrow to fail hard on decryption failure
        let apiKey: string;
        let secret: string;
        let passphrase: string | undefined;
        let decryptionFailed = false;
        let decryptionError: string | null = null;

        // HARD RESET: one-time clean up if decrypt fails (cache per UID)
        const memory = (global as any).__EXCHANGE_KEY_INVALID_CACHE = (global as any).__EXCHANGE_KEY_INVALID_CACHE || {};
        if (!memory[uid]) {
          try {
            apiKey = decryptOrThrow(config.apiKeyEncrypted, 'API key');
            secret = decryptOrThrow(config.secretKeyEncrypted || config.secretEncrypted, 'secret key');
            passphrase = config.passphraseEncrypted ? decryptOrThrow(config.passphraseEncrypted, 'passphrase') : undefined;
            memory[uid] = false;
          } catch (decryptErr: any) {
            decryptionFailed = true;
            decryptionError = decryptErr.message || 'Unknown decryption error';
            logger.error({ uid, exchange, error: decryptErr.message, errorCode: decryptErr.message?.includes('EXCHANGE_KEY_DECRYPTION_FAILED') ? 'DECRYPTION_FAILED' : 'UNKNOWN' }, 'EXCHANGE_KEY_DECRYPTION_FAILED: Cleaning up undecryptable exchange credentials');
            // HARD DELETE keys + mark status
            await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').set({
              apiKeyEncrypted: require('firebase-admin').firestore.FieldValue.delete(),
              secretKeyEncrypted: require('firebase-admin').firestore.FieldValue.delete(),
              passphraseEncrypted: require('firebase-admin').firestore.FieldValue.delete(),
              exchangeStatus: 'INVALID_KEYS',
              updatedAt: new Date()
            }, { merge: true });
            memory[uid] = true;
            return null;
          }
        } else if (memory[uid] === true) {
          // Already zapped for this session
          return null;
        }

        const testnet = config.testnet ?? true;

        // CRITICAL: Validate decrypted credentials before creating connector
        if (!apiKey || apiKey.trim() === '') {
          logger.error({ uid, exchange }, 'EXCHANGE_KEY_DECRYPTION_FAILED: Decrypted API key is empty');
          return null;
        }
        if (!secret || secret.trim() === '') {
          logger.error({ uid, exchange }, 'EXCHANGE_KEY_DECRYPTION_FAILED: Decrypted secret is empty');
          return null;
        }
        // Passphrase is optional for some exchanges, but required for Bitget
        if (exchange === 'bitget' && (!passphrase || passphrase.trim() === '')) {
          logger.error({ uid, exchange }, 'EXCHANGE_KEY_DECRYPTION_FAILED: Decrypted passphrase is empty (required for Bitget)');
          return null;
        }

        // Create connector using factory
        try {
          const connector = ExchangeConnectorFactory.create(exchange, {
            apiKey,
            secret,
            passphrase,
            testnet,
          });

          logger.info({ uid, exchange, testnet }, 'Exchange connector resolved from exchangeConfig');

          return {
            exchange,
            connector,
            credentials: {
              apiKey,
              secret,
              passphrase,
              testnet,
            },
          };
        } catch (createErr: any) {
          logger.error({ uid, exchange, error: createErr.message }, 'Failed to create exchange connector');
          return null;
        }
      } catch (parseErr: any) {
        logger.error({ uid, error: parseErr.message }, 'Error parsing exchange config');
        return null;
      }
    }

    // No credentials found in exchangeConfig/current
    logger.warn({ uid }, 'No exchange credentials found in users/{uid}/exchangeConfig/current. Please configure your exchange API credentials in Settings → Trading API Integration.');
    return null;
  } catch (err: any) {
    logger.error({ uid, error: err.message, stack: err.stack }, 'Error resolving exchange connector');
    return null;
  }
}

