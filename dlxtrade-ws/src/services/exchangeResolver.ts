import { getFirebaseAdmin } from '../utils/firebase';
import { ExchangeConnectorFactory, type ExchangeName } from './exchangeConnector';
import { decrypt } from './keyManager';
import { firestoreAdapter } from './firestoreAdapter';
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
  try {
    const db = getFirebaseAdmin().firestore();
    
    // PRIMARY: Check exchangeConfig subcollection (where frontend saves credentials)
    const configDoc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();
    
    if (configDoc.exists) {
      const config = configDoc.data()!;
      
      // Validate required fields
      if (!config.exchange) {
        logger.warn({ uid }, 'Exchange config exists but missing exchange field');
      } else if (!config.apiKeyEncrypted || !config.secretEncrypted) {
        logger.warn({ uid, exchange: config.exchange }, 'Exchange config exists but missing encrypted credentials');
      } else {
        try {
          // Normalize exchange name
          const exchange = (config.exchange as string).toLowerCase().trim() as ExchangeName;
          const validExchanges: ExchangeName[] = ['binance', 'bitget', 'bingx', 'weex'];
          
          if (!validExchanges.includes(exchange)) {
            logger.warn({ uid, exchange: config.exchange }, 'Unsupported exchange name in config');
          } else {
            // Decrypt credentials
            let apiKey: string;
            let secret: string;
            let passphrase: string | undefined;
            
            try {
              apiKey = decrypt(config.apiKeyEncrypted);
              secret = decrypt(config.secretEncrypted);
              passphrase = config.passphraseEncrypted ? decrypt(config.passphraseEncrypted) : undefined;
            } catch (decryptErr: any) {
              logger.error({ uid, exchange, error: decryptErr.message }, 'Failed to decrypt exchange credentials');
              return null;
            }
            
            // Validate decrypted values
            if (!apiKey || !secret) {
              logger.warn({ uid, exchange }, 'Decrypted credentials are empty');
              return null;
            }
            
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
        } catch (parseErr: any) {
          logger.error({ uid, error: parseErr.message }, 'Error parsing exchange config');
        }
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

