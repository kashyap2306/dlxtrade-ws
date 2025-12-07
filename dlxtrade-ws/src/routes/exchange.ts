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
  // POST /api/users/:id/exchange-config - Save exchange configuration
  fastify.post('/users/:id/exchange-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: any }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const user = (request as any).user;
      
      // Log request details
      logger.info({ 
        uid: user.uid, 
        targetId: id,
        body: JSON.stringify(request.body),
        hasApiKey: !!(request.body as any).apiKey,
        hasSecret: !!(request.body as any).secret,
        hasPassphrase: !!(request.body as any).passphrase,
        exchange: (request.body as any).exchange,
        type: (request.body as any).type 
      }, 'Exchange config save request received');
      
      // Users can only update their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (id !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const body = exchangeConfigSchema.parse(request.body);
      
      // Determine type: use 'type' field if provided, otherwise use 'exchange' field, default to 'binance'
      const configType = body.type || body.exchange || 'binance';
      
      // Validate required fields for trading exchanges only
      if (['binance', 'bitget', 'weex', 'bingx'].includes(configType)) {
        if (!body.secret) {
          return reply.code(400).send({ error: 'Secret key is required for trading exchanges' });
        }
        const requiredFields = ExchangeConnectorFactory.getRequiredFields(configType as any);
        if (requiredFields.includes('passphrase') && !body.passphrase) {
          return reply.code(400).send({ error: 'Passphrase is required for this exchange' });
        }
      }

      // Get existing document to check if createdAt should be set
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = getFirebaseAdmin().firestore();
      const existingDoc = await db.collection('users').doc(id).collection('exchangeConfig').doc('current').get();
      const now = admin.firestore.Timestamp.now();

      // Encrypt credentials
      const encryptedConfig: any = {
        exchange: configType, // Keep for backward compatibility
        apiKeyEncrypted: encrypt(body.apiKey),
        updatedAt: now,
      };
      
      // Add createdAt only if document doesn't exist
      if (!existingDoc.exists) {
        encryptedConfig.createdAt = now;
      }
      
      // Only add secret/passphrase for trading exchanges
      if (['binance', 'bitget', 'weex', 'bingx'].includes(configType)) {
        if (body.secret) {
          encryptedConfig.secretEncrypted = encrypt(body.secret);
        }
        if (body.passphrase) {
          encryptedConfig.passphraseEncrypted = encrypt(body.passphrase);
        }
        encryptedConfig.testnet = body.testnet ?? true;
      }

      // Save to Firestore in user's exchangeConfig collection
      await db.collection('users').doc(id).collection('exchangeConfig').doc('current').set(encryptedConfig, { merge: true });

      // Verify it was saved
      const savedDoc = await db.collection('users').doc(id).collection('exchangeConfig').doc('current').get();
      logger.info({ 
        uid: id, 
        type: configType,
        saved: savedDoc.exists,
        hasApiKey: !!savedDoc.data()?.apiKeyEncrypted,
        hasSecret: !!savedDoc.data()?.secretEncrypted,
        hasPassphrase: !!savedDoc.data()?.passphraseEncrypted,
        hasCreatedAt: !!savedDoc.data()?.createdAt,
        hasUpdatedAt: !!savedDoc.data()?.updatedAt
      }, 'Exchange config saved and verified');

      return {
        success: true,
        message: 'Configuration saved successfully',
        type: configType,
        exchange: configType, // Keep for backward compatibility
      };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        logger.warn({ err: err.errors, uid: (request as any).user?.uid }, 'Exchange config validation error');
        return reply.code(400).send({ error: 'Invalid input', details: err.errors });
      }
      logger.error({ err: err.message, stack: err.stack, uid: (request as any).user?.uid }, 'Error saving exchange config');
      return reply.code(500).send({ error: err.message || 'Error saving exchange configuration' });
    }
  });

  // GET /api/users/:id/exchange-config - Get exchange configuration (masked)
  fastify.get('/users/:id/exchange-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const user = (request as any).user;
      
      // Users can only view their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (id !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = getFirebaseAdmin().firestore();
      const doc = await db.collection('users').doc(id).collection('exchangeConfig').doc('current').get();

      if (!doc.exists) {
        return reply.send({
          success: false,
          error: "Exchange configuration not found",
          config: null
        });
      }

      const data = doc.data()!;

      // Return masked configuration
      return {
        success: true,
        config: {
          exchange: data.exchange,
          testnet: data.testnet ?? true,
          hasApiKey: !!data.apiKeyEncrypted,
          hasSecret: !!data.secretEncrypted,
          hasPassphrase: !!data.passphraseEncrypted,
          updatedAt: safeDate(data.updatedAt),
          createdAt: safeDate(data.createdAt),
        }
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting exchange config');
      return reply.send({
        success: false,
        error: "Invalid exchange config data",
        config: null
      });
    }
  });

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

  // POST /api/exchange/connect - Connect to exchange
  fastify.post('/exchange/connect', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = z.object({
        exchange: z.enum(['binance', 'bitget', 'weex', 'bingx']),
        apiKey: z.string().min(1),
        secret: z.string().min(1),
        passphrase: z.string().optional(),
        testnet: z.boolean().optional().default(true)
      }).parse(request.body);

      logger.info({ uid: user.uid, exchange: body.exchange }, 'Exchange connect request');

      // Encrypt credentials
      const encryptedCredentials = {
        apiKey: encrypt(body.apiKey),
        secret: encrypt(body.secret),
        passphrase: body.passphrase ? encrypt(body.passphrase) : undefined,
        testnet: body.testnet
      };

      // Save to database
      await firestoreAdapter.saveExchangeCredentials(user.uid, body.exchange, encryptedCredentials);

      // Test connection by creating connector with provided credentials
      const testCredentials = {
        apiKey: body.apiKey,
        secret: body.secret,
        passphrase: body.passphrase,
        testnet: body.testnet
      };
      const exchangeConnector = ExchangeConnectorFactory.create(body.exchange as ExchangeName, testCredentials);
      const testResult = await exchangeConnector.testConnection();

      if (!testResult.success) {
        // Clean up credentials if test failed
        await firestoreAdapter.deleteExchangeCredentials(user.uid, body.exchange);
        return reply.code(400).send({
          error: 'Connection test failed',
          message: testResult.message
        });
      }

      return {
        success: true,
        message: `${body.exchange} connected successfully`,
        testResult
      };
    } catch (err: any) {
      logger.error({ error: err.message, uid: (request as any).user?.uid }, 'Exchange connect failed');
      return reply.code(500).send({ error: err.message || 'Failed to connect to exchange' });
    }
  });

  // POST /api/exchange/disconnect - Disconnect from exchange
  fastify.post('/exchange/disconnect', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = z.object({
        exchange: z.enum(['binance', 'bitget', 'weex', 'bingx'])
      }).parse(request.body);

      logger.info({ uid: user.uid, exchange: body.exchange }, 'Exchange disconnect request');

      await firestoreAdapter.deleteExchangeCredentials(user.uid, body.exchange);

      return {
        success: true,
        message: `${body.exchange} disconnected successfully`
      };
    } catch (err: any) {
      logger.error({ error: err.message, uid: (request as any).user?.uid }, 'Exchange disconnect failed');
      return reply.code(500).send({ error: err.message || 'Failed to disconnect from exchange' });
    }
  });

  // GET /api/exchange/status - Get exchange connection status
  // GET /api/exchange/connected - Get connected exchange with trading settings
  console.log('[ROUTE READY] GET /api/exchange/connected');
  fastify.get('/exchange/connected', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;

      // Get exchange status
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
            const exchangeConnector = ExchangeConnectorFactory.create(exchange as ExchangeName, decrypted);
            testResult = await exchangeConnector.testConnection();
          } catch (testErr: any) {
            logger.warn({ error: testErr.message, exchange }, 'Exchange connection test failed');
          }
        }

        return {
          exchange,
          connected: isConnected,
          testResult
        };
      });

      const exchangeStatuses = await Promise.all(statusPromises);
      const connectedExchange = exchangeStatuses.find(ex => ex.connected);

      // Get trading settings from user settings
      const settings = await firestoreAdapter.getSettings(user.uid);
      const tradingSettings = settings?.tradingSettings || {
        manualCoins: [],
        maxPositionPerTrade: 10,
        positionSizingMap: [
          { min: 0, max: 25, percent: 1 },
          { min: 25, max: 50, percent: 2 },
          { min: 50, max: 75, percent: 3 },
          { min: 75, max: 100, percent: 5 }
        ]
      };

      return {
        exchange: connectedExchange || null,
        manualCoins: tradingSettings.manualCoins || [],
        positionSizingMap: tradingSettings.positionSizingMap || [],
        maxPositionPerTrade: tradingSettings.maxPositionPerTrade || 10
      };
    } catch (err: any) {
      logger.error({ error: err.message }, 'Error getting connected exchange');
      return reply.code(500).send({ error: err.message || 'Error fetching connected exchange' });
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

  // GET /exchange/connected - Get connected exchange status
  fastify.get('/exchange/connected', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    try {
      const exchanges: ExchangeName[] = ['binance', 'bitget', 'weex', 'bingx'];
      const connectedExchanges = [];

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

      return {
        connected: connectedExchanges.length > 0,
        exchanges: connectedExchanges
      };
    } catch (err: any) {
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

