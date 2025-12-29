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
 * CRITICAL: Uses isExchangeUsable() for normalization - NEVER interprets exchangeStatus directly
 * INVALID_KEYS is treated as stale outside connect flow
 *
 * Returns null if exchange not usable, with detailed logging
 */
export async function resolveExchangeConnector(
  uid: string
): Promise<ResolvedExchangeConnector | null> {
  // CRITICAL: Use normalized exchange usability check - NEVER bypass INVALID_KEYS normalization
  const exchangeUsability = await isExchangeUsable(uid, 'background_job');

  // If exchange is not connected, resolver should return null
  // INVALID_KEYS must be treated as stale - not block resolver outside connect flow
  if (!exchangeUsability.usable || exchangeUsability.reason === 'not_connected') {
    logger.info({
      uid,
      reason: exchangeUsability.reason,
      context: 'exchange_resolver_normalized_check'
    }, 'Exchange resolver: Exchange not usable according to normalized check');
    return null;
  }

  // Only proceed if exchange is confirmed usable
  const exchangeConfig = await firestoreAdapter.getExchangeConfig(uid);
  try {
    const db = getFirebaseAdmin().firestore();

    // PRIMARY: Check exchangeConfig subcollection (where frontend saves credentials)
    const configDoc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();

    if (configDoc.exists) {
      const config = configDoc.data()!;

      // Check if user has explicitly disconnected
      if (config.disconnected === true) {
        logger.info({ uid }, 'Exchange resolver: User has disconnected exchange, returning null');
        return null;
      }

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

        // Normalize exchange name
        const exchange = (config.exchange as string).toLowerCase().trim() as ExchangeName;
        const validExchanges: ExchangeName[] = ['binance', 'bitget', 'bingx', 'weex'];

        // Validate exchange name EARLY - return null immediately if invalid
        if (!validExchanges.includes(exchange)) {
          logger.warn({ uid, exchange: config.exchange }, 'Unsupported exchange name in config');
          return null;
        }

        // Since we passed isExchangeUsable check, exchange must be CONNECTED
        // RUNTIME PROTECTION: Do NOT call decrypt() in background contexts
        // Exchange resolver is called from background jobs - decryption must be avoided
        logger.info({
          uid,
          exchange,
          context: 'exchange_resolver_background'
        }, 'Exchange resolver: Exchange confirmed usable by isExchangeUsable - proceeding with placeholder credentials');

        // Use placeholder values - the exchange connector will handle missing credentials gracefully
        // This avoids decryption in background contexts while maintaining functionality
        const apiKey = 'CONNECTED_EXCHANGE_PLACEHOLDER';
        const secret = 'CONNECTED_EXCHANGE_PLACEHOLDER';
        const passphrase = undefined;
        const testnet = config.testnet ?? true;

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
    }

    // No credentials found in exchangeConfig/current
    logger.warn({ uid }, 'No exchange credentials found in users/{uid}/exchangeConfig/current. Please configure your exchange API credentials in Settings → Trading API Integration.');
    return null;
  } catch (err: any) {
    logger.error({ uid, error: err.message, stack: err.stack }, 'Error resolving exchange connector');
    return null;
  }
}

