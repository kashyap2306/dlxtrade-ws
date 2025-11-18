import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { ExchangeConnectorFactory, type ExchangeName, type ExchangeCredentials } from '../services/exchangeConnector';
import { encrypt, decrypt } from '../services/keyManager';
import { logger } from '../utils/logger';

const exchangeConfigSchema = z.object({
  exchange: z.enum(['binance', 'bitget', 'weex', 'bingx', 'cryptoquant', 'lunarcrush', 'coinapi']).optional(),
  type: z.enum(['binance', 'bitget', 'weex', 'bingx', 'cryptoquant', 'lunarcrush', 'coinapi']).optional(),
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

      // Encrypt credentials
      const encryptedConfig: any = {
        exchange: configType, // Keep for backward compatibility
        type: configType, // New field
        apiKeyEncrypted: encrypt(body.apiKey),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
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
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = getFirebaseAdmin().firestore();
      await db.collection('users').doc(id).collection('exchangeConfig').doc('current').set(encryptedConfig, { merge: true });

      logger.info({ uid: id, type: configType }, 'Exchange/API config saved');

      return {
        success: true,
        message: 'Configuration saved successfully',
        type: configType,
        exchange: configType, // Keep for backward compatibility
      };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: err.errors });
      }
      logger.error({ err }, 'Error saving exchange config');
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
        return reply.code(404).send({ error: 'Exchange configuration not found' });
      }

      const data = doc.data()!;
      
      // Return masked configuration
      return {
        exchange: data.exchange,
        testnet: data.testnet ?? true,
        hasApiKey: !!data.apiKeyEncrypted,
        hasSecret: !!data.secretEncrypted,
        hasPassphrase: !!data.passphraseEncrypted,
        updatedAt: data.updatedAt?.toISOString?.() || new Date(data.updatedAt).toISOString(),
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting exchange config');
      return reply.code(500).send({ error: err.message || 'Error fetching exchange configuration' });
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
          lastTested: new Date().toISOString(),
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
}

