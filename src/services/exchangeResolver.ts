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
    const active: ActiveExchangeContext = await firestoreAdapter.getActiveExchangeForUser(uid);
  // ActiveExchangeContext no longer has fallback - this should not happen
  if (!active.adapter) {
    logger.warn({ uid }, 'resolveExchangeConnector requested but user has no exchange adapter');
    return null;
  }

    if (!active.apiKey || !active.secret) {
      logger.warn({ uid, exchange: active.name }, 'Active exchange missing credentials');
      return null;
    }

    return {
      exchange: active.name as ExchangeName,
      connector: active.adapter,
      credentials: {
        apiKey: active.apiKey,
        secret: active.secret,
        passphrase: active.passphrase,
        testnet: active.testnet ?? false,
      },
    };
  } catch (err: any) {
    logger.error({ uid, error: err.message }, 'Error resolving exchange connector');
    return null;
  }
}

