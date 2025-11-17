import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { ExchangeConnectorFactory, type ExchangeName, type ExchangeCredentials } from '../services/exchangeConnector';
import { encrypt, decrypt } from '../services/keyManager';
import { logger } from '../utils/logger';

const exchangeConfigSchema = z.object({
  exchange: z.enum(['binance', 'bitget', 'weex', 'bingx']),
  apiKey: z.string().min(1),
  secret: z.string().min(1),
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
      
      // Validate required fields for the exchange
      const requiredFields = ExchangeConnectorFactory.getRequiredFields(body.exchange);
      if (requiredFields.includes('passphrase') && !body.passphrase) {
        return reply.code(400).send({ error: 'Passphrase is required for this exchange' });
      }

      // Encrypt credentials
      const encryptedConfig = {
        exchange: body.exchange,
        apiKeyEncrypted: encrypt(body.apiKey),
        secretEncrypted: encrypt(body.secret),
        passphraseEncrypted: body.passphrase ? encrypt(body.passphrase) : undefined,
        testnet: body.testnet ?? true,
        updatedAt: new Date(),
      };

      // Save to Firestore in user's exchangeConfig collection
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = getFirebaseAdmin().firestore();
      await db.collection('users').doc(id).collection('exchangeConfig').doc('current').set(encryptedConfig, { merge: true });

      logger.info({ uid: id, exchange: body.exchange }, 'Exchange config saved');

      return {
        success: true,
        message: 'Exchange configuration saved successfully',
        exchange: body.exchange,
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
}

