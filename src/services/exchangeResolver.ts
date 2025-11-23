import type { ExchangeName } from './exchangeConnector';
import { firestoreAdapter, type ActiveExchangeContext } from './firestoreAdapter';
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
export async function resolveExchangeConnector(uid: string): Promise<ResolvedExchangeConnector | null> {
  try {
    const active = await firestoreAdapter.getActiveExchangeForUser(uid);

    // Handle fallback object when no exchange is configured
    if (active && typeof active === 'object' && 'exchangeConfigured' in active && active.exchangeConfigured === false) {
      logger.debug({ uid }, 'Exchange integration not configured');
      return null;
    }

    // Type assertion since we've handled the fallback case
    const activeContext = active as any;
    // ActiveExchangeContext should be valid at this point
    if (!activeContext.adapter) {
      logger.warn({ uid }, 'resolveExchangeConnector requested but user has no exchange adapter');
      return null;
    }

    if (!activeContext.apiKey || !activeContext.secret) {
      logger.warn({ uid, exchange: activeContext.name }, 'Active exchange missing credentials');
      return null;
    }

    return {
      exchange: activeContext.name as ExchangeName,
      connector: activeContext.adapter,
      credentials: {
        apiKey: activeContext.apiKey,
        secret: activeContext.secret,
        passphrase: activeContext.passphrase,
        testnet: activeContext.testnet ?? false,
      },
    };
  } catch (err: any) {
    logger.error({ uid, error: err.message }, 'Error resolving exchange connector');
    return null;
  }
}

