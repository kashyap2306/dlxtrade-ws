import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { userEngineManager } from '../services/userEngineManager';
import { logger } from '../utils/logger';
import { decrypt } from '../services/keyManager';
import { BinanceAdapter } from '../services/binanceAdapter';
import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';

const toggleAutoTradeSchema = z.object({
  enabled: z.boolean(),
});

/**
 * PART 3 & 4: Auto-Trade Routes
 * Handles starting/stopping per-user auto-trade engine
 */
export async function autoTradeRoutes(fastify: FastifyInstance) {
  // GET /api/auto-trade/status - Get auto-trade status
  fastify.get('/status', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const db = admin.firestore(getFirebaseAdmin());
      
      // Get engine status from Firestore
      const engineStatus = await firestoreAdapter.getEngineStatus(user.uid);
      const userData = await firestoreAdapter.getUser(user.uid);
      
      // Check if user has exchange config (more reliable than userData.apiConnected)
      const exchangeConfigDoc = await db
        .collection('users')
        .doc(user.uid)
        .collection('exchangeConfig')
        .doc('current')
        .get();
      
      const hasExchangeConfig = exchangeConfigDoc.exists && 
        exchangeConfigDoc.data()?.apiKeyEncrypted && 
        exchangeConfigDoc.data()?.secretEncrypted;
      
      // Also check apiKeys collection for backward compatibility
      const apiKeysDoc = await db.collection('apiKeys').doc(user.uid).get();
      const hasApiKeys = apiKeysDoc.exists && 
        apiKeysDoc.data()?.apiKeyEncrypted && 
        apiKeysDoc.data()?.apiSecretEncrypted &&
        apiKeysDoc.data()?.status === 'connected';
      
      const isApiConnected = hasExchangeConfig || hasApiKeys || userData?.apiConnected || false;
      
      return {
        autoTradeEnabled: engineStatus?.autoTradeEnabled || false,
        engineRunning: engineStatus?.engineRunning || false,
        isApiConnected,
        apiStatus: isApiConnected ? 'connected' : 'disconnected',
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting auto-trade status');
      return reply.code(500).send({ error: err.message || 'Error fetching auto-trade status' });
    }
  });

  // POST /api/auto-trade/toggle - Toggle auto-trade ON/OFF
  fastify.post('/toggle', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = toggleAutoTradeSchema.parse(request.body);

      // PART 2: Verify user has connected API keys - check exchangeConfig first, then apiKeys collection
      const db = admin.firestore(getFirebaseAdmin());
      
      // Check exchangeConfig collection (primary source)
      const exchangeConfigDoc = await db
        .collection('users')
        .doc(user.uid)
        .collection('exchangeConfig')
        .doc('current')
        .get();
      
      let apiKey: string | null = null;
      let apiSecret: string | null = null;
      let exchangeName: string | null = null;
      let testnet: boolean = true;
      
      if (exchangeConfigDoc.exists) {
        const exchangeConfig = exchangeConfigDoc.data();
        if (exchangeConfig?.apiKeyEncrypted && exchangeConfig?.secretEncrypted) {
          apiKey = decrypt(exchangeConfig.apiKeyEncrypted);
          apiSecret = decrypt(exchangeConfig.secretEncrypted);
          exchangeName = exchangeConfig.exchange || exchangeConfig.type || 'binance';
          testnet = exchangeConfig.testnet ?? true;
        }
      }
      
      // Fallback to apiKeys collection if exchangeConfig not found
      if (!apiKey || !apiSecret) {
        const apiKeysDoc = await db.collection('apiKeys').doc(user.uid).get();
        if (apiKeysDoc.exists) {
          const apiKeysData = apiKeysDoc.data();
          if (apiKeysData?.apiKeyEncrypted && apiKeysData?.apiSecretEncrypted && apiKeysData?.status === 'connected') {
            apiKey = decrypt(apiKeysData.apiKeyEncrypted);
            apiSecret = decrypt(apiKeysData.apiSecretEncrypted);
            exchangeName = apiKeysData.exchange || 'binance';
            testnet = apiKeysData.testnet ?? true;
          }
        }
      }
      
      // If still no keys found, return error
      if (!apiKey || !apiSecret) {
        return reply.code(400).send({
          error: 'Please connect your exchange API keys first in Settings > Exchange Accounts.',
        });
      }

      if (body.enabled) {
        // PART 3 & 4: Start auto-trade engine
        try {
          // Validate API keys again (only for Binance)
          if (exchangeName === 'binance' || !exchangeName) {
            const testAdapter = new BinanceAdapter(apiKey, apiSecret, testnet);
            const validation = await testAdapter.validateApiKey();
            
            if (!validation.valid || !validation.canTrade) {
              return reply.code(400).send({
                error: 'API key validation failed. Please check your API keys.',
              });
            }
          }

          // Get or create user engine
          let engine = userEngineManager.getUserEngine(user.uid);
          if (!engine) {
            await userEngineManager.createUserEngine(user.uid, apiKey, apiSecret, testnet);
            engine = userEngineManager.getUserEngine(user.uid)!;
          }

          // Get settings to determine symbol
          const settings = await firestoreAdapter.getSettings(user.uid);
          const symbol = settings?.symbol || 'BTCUSDT';

          // Start the auto-trade engine
          await userEngineManager.startAutoTrade(user.uid);

          // Update engineStatus in Firestore
          const engineStatusRef = db.collection('engineStatus').doc(user.uid);
          await engineStatusRef.set({
            uid: user.uid,
            engineRunning: true,
            autoTradeEnabled: true,
            lastStarted: admin.firestore.Timestamp.now(),
            updatedAt: admin.firestore.Timestamp.now(),
          }, { merge: true });

          // Update user document
          await firestoreAdapter.createOrUpdateUser(user.uid, {
            autoTradeEnabled: true,
            engineStatus: 'running',
          });

          // Update settings
          await firestoreAdapter.saveSettings(user.uid, {
            ...settings,
            autoTradeEnabled: true,
          });

          // PART 6: Log activity
          await firestoreAdapter.logActivity(user.uid, 'AUTO_TRADE_ENABLED', {
            message: 'Auto-trade engine started',
            symbol,
          });

          logger.info({ uid: user.uid, symbol }, 'Auto-trade enabled');

          return {
            message: 'Auto-trade enabled successfully',
            enabled: true,
            status: 'running',
          };
        } catch (error: any) {
          logger.error({ error: error.message, uid: user.uid }, 'Error starting auto-trade');
          return reply.code(500).send({
            error: `Failed to start auto-trade: ${error.message}`,
          });
        }
      } else {
        // PART 3 & 4: Stop auto-trade engine
        try {
          await userEngineManager.stopAutoTrade(user.uid);

          // Update engineStatus in Firestore
          const engineStatusRef = db.collection('engineStatus').doc(user.uid);
          await engineStatusRef.set({
            uid: user.uid,
            engineRunning: false,
            autoTradeEnabled: false,
            lastStopped: admin.firestore.Timestamp.now(),
            updatedAt: admin.firestore.Timestamp.now(),
          }, { merge: true });

          // Update user document
          await firestoreAdapter.createOrUpdateUser(user.uid, {
            autoTradeEnabled: false,
            engineStatus: 'stopped',
          });

          // Update settings
          const settings = await firestoreAdapter.getSettings(user.uid);
          if (settings) {
            await firestoreAdapter.saveSettings(user.uid, {
              ...settings,
              autoTradeEnabled: false,
            });
          }

          // PART 6: Log activity
          await firestoreAdapter.logActivity(user.uid, 'AUTO_TRADE_DISABLED', {
            message: 'Auto-trade engine stopped',
          });

          logger.info({ uid: user.uid }, 'Auto-trade disabled');

          return {
            message: 'Auto-trade disabled successfully',
            enabled: false,
            status: 'stopped',
          };
        } catch (error: any) {
          logger.error({ error: error.message, uid: user.uid }, 'Error stopping auto-trade');
          return reply.code(500).send({
            error: `Failed to stop auto-trade: ${error.message}`,
          });
        }
      }
    } catch (err: any) {
      logger.error({ err }, 'Error toggling auto-trade');
      return reply.code(500).send({ error: err.message || 'Error toggling auto-trade' });
    }
  });
}

