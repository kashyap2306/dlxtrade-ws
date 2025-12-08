import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { ExchangeConnectorFactory, type ExchangeName, type ExchangeCredentials } from '../services/exchangeConnector';
import { encrypt, decrypt } from '../services/keyManager';
import { logger } from '../utils/logger';
import * as admin from 'firebase-admin';

function safeDate(value: any) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

const exchangeConfigSchema = z.object({
  exchange: z.enum(['binance', 'bitget', 'weex', 'bingx']).optional(),
  type: z.enum(['binance', 'bitget', 'weex', 'bingx']).optional(),
  apiKey: z.string().min(1),
  secret: z.string().min(1).optional(),
  passphrase: z.string().optional(),
  testnet: z.boolean().optional().default(true),
});

export async function exchangeRoutes(fastify: FastifyInstance) {

  // POST /api/exchange/test - Test exchange connection
  fastify.post('/test', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = z.object({
        exchange: z.enum(['binance', 'bitget', 'weex', 'bingx']).optional(),
        apiKey: z.string().optional(),
        secret: z.string().optional(),
        passphrase: z.string().optional(),
        testnet: z.boolean().optional().default(true),
      }).parse(request.body);

      let credentials: ExchangeCredentials;
      let exchange: ExchangeName;

      // If credentials provided, use them; otherwise load from user's config
      if (body.apiKey && body.secret) {
        exchange = body.exchange || 'binance';
        credentials = {
          apiKey: body.apiKey,
          secret: body.secret,
          passphrase: body.passphrase,
          testnet: body.testnet ?? true,
        };
      } else {
        // Load from user's saved config
        const { getFirebaseAdmin } = await import('../utils/firebase');
        const db = getFirebaseAdmin().firestore();
        const doc = await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get();

        if (!doc.exists) {
          return reply.code(400).send({ error: 'No exchange configuration found. Please save your credentials first.' });
        }

        const config = doc.data()!;
        exchange = config.exchange as ExchangeName;
        
        // Decrypt credentials
        credentials = {
          apiKey: decrypt(config.apiKeyEncrypted),
          secret: decrypt(config.secretEncrypted),
          passphrase: config.passphraseEncrypted ? decrypt(config.passphraseEncrypted) : undefined,
          testnet: config.testnet ?? true,
        };
      }

      // Validate required fields
      const requiredFields = ExchangeConnectorFactory.getRequiredFields(exchange);
      if (requiredFields.includes('passphrase') && !credentials.passphrase) {
        return reply.code(400).send({ error: 'Passphrase is required for this exchange' });
      }

      // Create connector and test
      const connector = ExchangeConnectorFactory.create(exchange, credentials);
      const result = await connector.testConnection();

      logger.info({ uid: user.uid, exchange, success: result.success }, 'Exchange connection test');

      return {
        success: result.success,
        message: result.message,
        exchange,
      };
    } catch (err: any) {
      logger.error({ err }, 'Error testing exchange connection');
      return reply.code(500).send({ 
        error: err.message || 'Error testing exchange connection',
        success: false,
      });
    }
  });

  // POST /api/exchange/test-trade - Place a test trade order
  fastify.post('/exchange/test-trade', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { exchange?: ExchangeName; symbol?: string; side?: 'BUY' | 'SELL'; quantity?: number } }>, reply: FastifyReply) => {
    const user = (request as any).user;
    
    try {
      const body = z.object({
        exchange: z.enum(['binance', 'bitget', 'weex', 'bingx']).optional(),
        symbol: z.string().optional().default('BTCUSDT'),
        side: z.enum(['BUY', 'SELL']).optional().default('BUY'),
        quantity: z.number().positive().optional().default(0.001),
      }).parse(request.body || {});

      // Get exchange connector
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = getFirebaseAdmin().firestore();
      const configDoc = await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get();

      if (!configDoc.exists) {
        return reply.code(404).send({
          success: false,
          error: 'Exchange configuration not found. Please configure your exchange API credentials first.',
        });
      }

      const config = configDoc.data()!;
      const exchange = (body.exchange || config.exchange) as ExchangeName;

      // Validate exchange matches if specified
      if (body.exchange && body.exchange !== config.exchange) {
        return reply.code(400).send({
          success: false,
          error: `Exchange mismatch. Configured: ${config.exchange}, requested: ${body.exchange}`,
        });
      }

      // Create connector
      const connector = ExchangeConnectorFactory.create(exchange, {
        apiKey: decrypt(config.apiKeyEncrypted),
        secret: decrypt(config.secretEncrypted),
        passphrase: config.passphraseEncrypted ? decrypt(config.passphraseEncrypted) : undefined,
        testnet: config.testnet ?? true,
      });

      // Get symbol info to determine minimum order size
      try {
        // Determine minimum quantity (use provided quantity or minimum)
        const minQuantity = 0.001; // Default minimum
        const orderQuantity = Math.max(body.quantity || minQuantity, minQuantity);

        // Place market order
        const order = await connector.placeOrder({
          symbol: body.symbol!,
          side: body.side!,
          type: 'MARKET',
          quantity: orderQuantity,
        });

        // Update last tested timestamp
        await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').update({
          lastTested: safeDate(new Date()),
        });

        logger.info({ 
          uid: user.uid, 
          exchange, 
          symbol: body.symbol, 
          side: body.side, 
          orderId: order.id || order.orderId 
        }, 'Test trade placed successfully');

        return {
          success: true,
          message: 'Test trade placed successfully',
          orderId: order.id || order.orderId || 'N/A',
          status: order.status || 'FILLED',
          filledPrice: order.filledPrice || order.price || 'N/A',
          filledQuantity: order.filledQuantity || orderQuantity,
          exchange,
          symbol: body.symbol,
          side: body.side,
          exchangeConfirmation: order.exchangeConfirmation || order.raw || {},
        };
      } catch (tradeErr: any) {
        logger.error({ err: tradeErr, uid: user.uid, exchange }, 'Error placing test trade');
        return reply.code(400).send({
          success: false,
          error: tradeErr.message || 'Error placing test trade',
          details: tradeErr.response?.data || tradeErr.data,
        });
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid input',
          details: err.errors,
        });
      }
      logger.error({ err, uid: user.uid }, 'Error in test trade endpoint');
      return reply.code(500).send({
        success: false,
        error: err.message || 'Error placing test trade',
      });
    }
  });



  fastify.get('/exchange/status', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const query = request.query as { exchange?: string };

      if (query.exchange) {
        // Get status for specific exchange
        const credentials = await firestoreAdapter.getExchangeCredentials(user.uid, query.exchange);
        const isConnected = !!credentials;

        let testResult = null;
        if (isConnected && credentials) {
          try {
            const decrypted = {
              apiKey: decrypt(credentials.apiKey),
              secret: decrypt(credentials.secret),
              passphrase: credentials.passphrase ? decrypt(credentials.passphrase) : undefined,
              testnet: credentials.testnet
            };
            const exchangeConnector = ExchangeConnectorFactory.create(query.exchange as ExchangeName, decrypted);
            testResult = await exchangeConnector.testConnection();
          } catch (testErr: any) {
            logger.warn({ error: testErr.message, exchange: query.exchange }, 'Exchange status test failed');
          }
        }

        return {
          exchange: query.exchange,
          connected: isConnected,
          testResult
        };
      } else {
        // Get status for all exchanges
        const exchanges: ExchangeName[] = ['binance', 'bitget', 'weex', 'bingx'];
        const statusPromises = exchanges.map(async (exchange) => {
          const credentials = await firestoreAdapter.getExchangeCredentials(user.uid, exchange);
          const isConnected = !!credentials;

          let testResult = null;
          if (isConnected && credentials) {
            try {
              const decrypted = {
                apiKey: decrypt(credentials.apiKey),
                secret: decrypt(credentials.secret),
                passphrase: credentials.passphrase ? decrypt(credentials.passphrase) : undefined,
                testnet: credentials.testnet
              };
              const exchangeConnector = ExchangeConnectorFactory.create(exchange, decrypted);
              testResult = await exchangeConnector.testConnection();
            } catch (testErr: any) {
              logger.warn({ error: testErr.message, exchange }, 'Exchange status test failed');
            }
          }

          return {
            exchange,
            connected: isConnected,
            testResult
          };
        });

        const statuses = await Promise.all(statusPromises);
        return { exchanges: statuses };
      }
    } catch (err: any) {
      logger.error({ error: err.message, uid: (request as any).user?.uid }, 'Exchange status check failed');
      return reply.code(500).send({ error: err.message || 'Failed to get exchange status' });
    }
  });

  // GET /exchange/connected - Get connected exchange status - DETAILED TIMING INSTRUMENTATION
  fastify.get('/exchange/connected', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const t0 = Date.now();
    const user = (request as any).user;

    try {
      fastify.log.info({ uid: user.uid }, 'exchange.connected:start');

      const exchanges: ExchangeName[] = ['binance', 'bitget', 'weex', 'bingx'];
      const connectedExchanges = [];

      const t1 = Date.now();
      for (const exchange of exchanges) {
        const credentials = await firestoreAdapter.getExchangeCredentials(user.uid, exchange);
        if (credentials) {
          connectedExchanges.push({
            exchange,
            connected: true,
            testnet: credentials.testnet || true
          });
        }
      }
      const dt1 = Date.now() - t1;
      fastify.log.info({ duration: dt1, exchangeCount: exchanges.length }, 'exchange.connected:db-calls');

      const dt = Date.now() - t0;
      fastify.log.info({ duration: dt }, 'exchange.connected:done');

      return {
        connected: connectedExchanges.length > 0,
        exchanges: connectedExchanges
      };
    } catch (err: any) {
      const dt = Date.now() - t0;
      fastify.log.error({ err, duration: dt }, 'exchange.connected:error');
      logger.error({ error: err.message, uid: user.uid }, 'Exchange connected check failed');
      return reply.code(500).send({ error: err.message || 'Failed to check connected exchanges' });
    }
  });

  // POST /exchange/connect - Connect to exchange
  fastify.post('/exchange/connect', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    try {
      const body = request.body as any;
      const { apiKey, secret, exchange } = body;

      logger.info({
        uid: user.uid,
        exchange,
        hasApiKey: !!apiKey,
        hasSecret: !!secret
      }, 'Exchange connect request');

      // Save exchange configuration
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = admin.firestore(getFirebaseAdmin());
      const exchangeConfig: any = {
        exchange,
        apiKeyEncrypted: encrypt(apiKey),
        secretEncrypted: encrypt(secret),
        testnet: true,
        updatedAt: admin.firestore.Timestamp.now(),
      };

      // Add createdAt only if document doesn't exist
      const existingDoc = await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get();
      if (!existingDoc.exists) {
        exchangeConfig.createdAt = admin.firestore.Timestamp.now();
      }

      await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').set(exchangeConfig, { merge: true });

      logger.info({
        uid: user.uid,
        exchange
      }, 'Exchange connected successfully');

      return {
        success: true,
        connected: true,
        exchange
      };
    } catch (err: any) {
      logger.error({ error: err.message, uid: user.uid }, 'Exchange connect failed');
      return reply.code(500).send({ error: err.message || 'Failed to connect to exchange' });
    }
  });

  // POST /exchange/disconnect - Disconnect from exchange
  fastify.post('/exchange/disconnect', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    try {
      const body = request.body as any;
      const { exchange } = body;

      logger.info({
        uid: user.uid,
        exchange
      }, 'Exchange disconnect request');

      // Remove exchange configuration
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = admin.firestore(getFirebaseAdmin());
      await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').delete();

      logger.info({
        uid: user.uid,
        exchange
      }, 'Exchange disconnected successfully');

      return {
        success: true,
        connected: false
      };
    } catch (err: any) {
      logger.error({ error: err.message, uid: user.uid }, 'Exchange disconnect failed');
      return reply.code(500).send({ error: err.message || 'Failed to disconnect from exchange' });
    }
  });
}

