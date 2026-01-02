import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter, isExchangeUsable } from '../services/firestoreAdapter';
import { ExchangeConnectorFactory, type ExchangeName } from '../services/exchangeConnector';
import { decrypt } from '../services/keyManager';
import { logger } from '../utils/logger';
import { getFirebaseAdmin } from '../utils/firebase';

/**
 * Determine if exchange keys should be auto-cleared based on context and timing
 */
function shouldAutoClearKeys(
  uid: string,
  exchange: string,
  context: 'background_job' | 'user_request',
  existingDoc: any,
  reason: string
): { shouldClear: boolean; logData: any } {
  const now = Date.now();
  const updatedAt = existingDoc?.updatedAt?.toDate?.()?.getTime?.() || 0;
  const timeSinceUpdate = now - updatedAt;
  const RECENT_SAVE_WINDOW_MS = 60 * 1000; // 60 seconds as requested

  const wasRecentlySaved = timeSinceUpdate < RECENT_SAVE_WINDOW_MS;
  const isBackgroundJob = context === 'background_job';

  const logData = {
    uid,
    exchange,
    context,
    reason,
    wasRecentlySaved,
    timeSinceUpdateMs: timeSinceUpdate,
    updatedAt: existingDoc?.updatedAt?.toDate?.()?.toISOString?.(),
    recentSaveWindowMs: RECENT_SAVE_WINDOW_MS,
    timestamp: now
  };

  // Block auto-clearing if:
  // 1. It's a background job AND keys were recently saved, OR
  // 2. It's a user request (never auto-clear for user requests)
  const shouldClear = !(isBackgroundJob && wasRecentlySaved);

  if (!shouldClear) {
    console.log('🔥 [HARD_LOG] [EXCHANGE_AUTO_INVALIDATION_BLOCKED]', {
      ...logData,
      action: 'SKIPPED_KEY_CLEARING',
      blockReason: isBackgroundJob && wasRecentlySaved ? 'recent_manual_save' : 'user_request_context'
    });
  } else {
    console.log('🔥 [HARD_LOG] [EXCHANGE_AUTO_INVALIDATION_DETECTED]', {
      ...logData,
      action: 'KEYS_WILL_BE_CLEARED',
      caller: 'shouldAutoClearKeys'
    });
  }

  return { shouldClear, logData };
}

interface Balance {
  asset: string;
  free: number;
  locked: number;
  usdValue: number;
}

/**
 * Wallet Routes
 * Handles wallet balance fetching from connected exchanges
 */
export async function walletRoutes(fastify: FastifyInstance) {
  // GET /api/wallet/balances - Get user's spot balances from connected exchange
  fastify.get('/balances', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    // Use normalized exchange usability check - INVALID_KEYS must not leak to user
    const exchangeUsability = await isExchangeUsable(user?.uid, 'user_request');
    if (!exchangeUsability.usable) {
      return reply.code(200).send({ blocked: true, reason: "EXCHANGE_NOT_CONNECTED" });
    }
    try {
      const user = (request as any).user;
      const db = getFirebaseAdmin().firestore();

      // Check if user has exchange config
      const exchangeConfigDoc = await db
        .collection('users')
        .doc(user.uid)
        .collection('exchangeConfig')
        .doc('current')
        .get();

      if (!exchangeConfigDoc.exists) {
        return reply.code(404).send({
          error: 'No exchange connected',
          connected: false,
        });
      }

      const exchangeConfig = exchangeConfigDoc.data();

      // Check if user has explicitly disconnected
      if (exchangeConfig?.disconnected === true) {
        return reply.code(404).send({
          error: 'Exchange has been disconnected',
          connected: false,
        });
      }

      if (!exchangeConfig?.apiKeyEncrypted || !exchangeConfig?.secretEncrypted) {
        return reply.code(404).send({
          error: 'No exchange connected',
          connected: false,
        });
      }

      const exchange = (exchangeConfig.exchange || exchangeConfig.type) as ExchangeName;
      if (!['binance', 'bitget', 'weex', 'bingx'].includes(exchange)) {
        return reply.code(400).send({
          error: 'Unsupported exchange',
          connected: false,
        });
      }

      // Decrypt credentials (server-side only, never expose)
      // CRITICAL: If decryption fails, skip balance fetch and return clear diagnostic
      // Do NOT disable unrelated features
      let apiKey: string;
      let secret: string;
      let passphrase: string | undefined;

      try {
        // CRITICAL: Use decryptOrThrow to fail hard on decryption failure
        const { decryptOrThrow } = await import('../services/keyManager');
        apiKey = decryptOrThrow(exchangeConfig.apiKeyEncrypted, 'API key', 'user_request');
        secret = decryptOrThrow(exchangeConfig.secretEncrypted, 'secret key', 'user_request');
        passphrase = exchangeConfig.passphraseEncrypted
          ? decryptOrThrow(exchangeConfig.passphraseEncrypted, 'passphrase', 'user_request')
          : undefined;
      } catch (decryptErr: any) {
        // Get the current exchange config document to check timestamps
        const exchangeConfig = await firestoreAdapter.getExchangeConfig(user.uid);
        const dbInstance = getFirebaseAdmin().firestore();
        const docRef = dbInstance.collection('users').doc(user.uid).collection('exchangeConfig').doc('current');
        const docSnapshot = await docRef.get();

        const { shouldClear, logData } = shouldAutoClearKeys(
          user.uid,
          exchangeConfig?.exchange || 'unknown',
          'user_request', // This is a user-facing API call
          docSnapshot.data(),
          'wallet_balance_decrypt_failed'
        );

        if (!shouldClear) {
          logger.warn({
            uid: user.uid,
            timeSinceUpdateMs: logData.timeSinceUpdateMs,
            error: decryptErr.message
          }, 'EXCHANGE_AUTO_INVALIDATION_BLOCKED: Skipping key clearing in wallet balance check for recently manually saved exchange');
        } else {
          // CRITICAL: DO NOT write INVALID_KEYS - violates invariant
          // INVALID_KEYS should only be written in POST /exchange/connect for credential validation failures
          logger.warn({
            uid: user.uid,
            error: decryptErr.message
          }, 'EXCHANGE_WALLET_DECRYPTION_FAILED: Decryption failed but NOT writing INVALID_KEYS (invariant protection)');
        }
        return reply.code(400).send({
          error: 'Exchange decryption failed. Please reconnect your exchange.',
          connected: false,
          exchangeStatus: 'NOT_CONNECTED',
          decryptionFailed: true,
          diagnostic: 'Balance fetch failed - Exchange decryption error. Please reconnect exchange.',
        });
      }
      const testnet = exchangeConfig.testnet ?? true;

      // Log metadata only (no keys)
      logger.info({
        uid: user.uid,
        exchange,
        hasKey: !!apiKey,
        keyLength: apiKey?.length || 0,
        exchangeName: exchange,
      }, 'Fetching wallet balances');

      // Create exchange adapter
      const adapter = ExchangeConnectorFactory.create(exchange, {
        apiKey,
        secret,
        passphrase,
        testnet,
      });

      // Fetch account info
      if (!adapter.getAccount) {
        return reply.code(501).send({
          error: 'Exchange adapter does not support balance fetching',
        });
      }

      const accountInfo = await adapter.getAccount();

      // Process balances based on exchange
      let balances: Balance[] = [];
      let totalUsdValue = 0;

      if (exchange === 'binance') {
        // Binance format: { balances: [{ asset, free, locked }] }
        if (accountInfo.balances && Array.isArray(accountInfo.balances)) {
          // Get USDT price for conversion (simplified - use 1:1 for now, or fetch from ticker)
          const usdtPrice = 1; // Could fetch from ticker if needed

          balances = accountInfo.balances
            .filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
            .map((b: any) => {
              const free = parseFloat(b.free || '0');
              const locked = parseFloat(b.locked || '0');
              const total = free + locked;

              // For now, only calculate USD value for USDT, others use 0
              // In production, you'd fetch prices for all assets
              let usdValue = 0;
              if (b.asset === 'USDT' || b.asset === 'BUSD') {
                usdValue = total;
              } else if (b.asset === 'BTC') {
                // Simplified - would fetch BTC price in production
                usdValue = total * 50000; // Placeholder
              } else if (b.asset === 'ETH') {
                usdValue = total * 3000; // Placeholder
              }

              return {
                asset: b.asset,
                free,
                locked,
                usdValue,
              };
            });

          totalUsdValue = balances.reduce((sum, b) => sum + b.usdValue, 0);
        }
      } else if (exchange === 'bitget') {
        // Bitget format may differ - adjust based on actual API response
        if (accountInfo.data?.normal && Array.isArray(accountInfo.data.normal)) {
          balances = accountInfo.data.normal
            .filter((b: any) => parseFloat(b.available || '0') > 0 || parseFloat(b.locked || '0') > 0)
            .map((b: any) => {
              const free = parseFloat(b.available || '0');
              const locked = parseFloat(b.locked || '0');
              const total = free + locked;
              const usdValue = b.coin === 'USDT' ? total : 0; // Simplified

              return {
                asset: b.coin,
                free,
                locked,
                usdValue,
              };
            });

          totalUsdValue = balances.reduce((sum, b) => sum + b.usdValue, 0);
        }
      } else {
        // Generic handling for other exchanges
        balances = [];
        totalUsdValue = 0;
      }

      // Return sanitized balances (no keys, no secrets)
      return {
        exchange,
        connected: true,
        balances,
        totalUsdValue,
      };
    } catch (err: any) {
      logger.error({ err, uid: (request as any).user?.uid }, 'Error fetching wallet balances');
      
      // Don't expose internal errors
      if (err.message?.includes('Invalid API-key') || err.message?.includes('authentication')) {
        return reply.code(401).send({
          error: 'Invalid exchange credentials',
          connected: false,
        });
      }

      return reply.code(500).send({
        error: 'Could not fetch balances',
        connected: false,
      });
    }
  });
}

