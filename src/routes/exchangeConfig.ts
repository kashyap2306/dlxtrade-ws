import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';
import { encrypt, decrypt, maskKey } from '../services/keyManager';
import { logger } from '../utils/logger';
import { BinanceAdapter } from '../services/binanceAdapter';
import { firestoreAdapter } from '../services/firestoreAdapter';

const exchangeConfigSchema = z.object({
  exchange: z.enum(['binance', 'bitget', 'bingx']),
  apiKey: z.string().min(1),
  secret: z.string().min(1),
  passphrase: z.string().optional(),
  testnet: z.boolean().optional(),
});

/**
 * Exchange Config Routes
 * Handles saving/loading trading exchange credentials
 * Saves to: users/{uid}/exchangeConfig/current
 */
export async function exchangeConfigRoutes(fastify: FastifyInstance) {
  // GET /api/exchange-config/load - Load exchange config
  fastify.get('/load', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const db = admin.firestore(getFirebaseAdmin());
      
      const configDoc = await db
        .collection('users')
        .doc(user.uid)
        .collection('exchangeConfig')
        .doc('current')
        .get();
      
      if (!configDoc.exists) {
        return {
          exchange: '',
          apiKey: null,
          secret: null,
          passphrase: null,
          testnet: false,
          enabled: false,
        };
      }
      
      const data = configDoc.data() || {};
      
      return {
        exchange: data.exchange || '',
        apiKey: data.apiKeyEncrypted ? maskKey(data.apiKeyEncrypted) : null,
        secret: data.secretEncrypted ? maskKey(data.secretEncrypted) : null,
        passphrase: data.passphraseEncrypted ? maskKey(data.passphraseEncrypted) : null,
        testnet: data.testnet || false,
        enabled: data.enabled || false,
        updatedAt: data.updatedAt?.toDate().toISOString(),
      };
    } catch (err: any) {
      logger.error({ err, uid: (request as any).user?.uid }, 'Error loading exchange config');
      return reply.code(500).send({ error: err.message || 'Error loading exchange config' });
    }
  });

  // POST /api/exchange-config/update - Save/update exchange config
  fastify.post('/update', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const uid = user.uid;

    // Validate UID from auth (server-side only)
    if (!uid || typeof uid !== 'string') {
      logger.error({ uid }, 'Invalid UID in request');
      return reply.code(400).send({ error: 'Invalid user authentication' });
    }

    let body: any;
    try {
      body = exchangeConfigSchema.parse(request.body);
    } catch (err: any) {
      logger.error({ err, uid }, 'Invalid payload in save exchange config');
      return reply.code(400).send({ 
        error: 'Invalid request data', 
        details: err.errors || err.message 
      });
    }

    // Validate API keys if Binance
    if (body.exchange === 'binance') {
      try {
        const testAdapter = new BinanceAdapter(body.apiKey, body.secret, body.testnet || false);
        const validation = await testAdapter.validateApiKey();
        
        if (!validation.valid) {
          return reply.code(400).send({
            error: `Binance API key validation failed: ${validation.error || 'Invalid API key'}`,
          });
        }
        
        if (!validation.canTrade) {
          return reply.code(400).send({
            error: 'API key does not have trading permissions. Please enable Spot & Margin Trading in Binance API settings.',
          });
        }
      } catch (error: any) {
        logger.error({ error: error.message, uid }, 'Binance API key validation error');
        return reply.code(400).send({
          error: `Binance API key validation failed: ${error.message}`,
        });
      }
    }

    try {
      logger.info({ uid, exchange: body.exchange }, 'Saving exchange config');
      
      // Encrypt and save with post-verification
      const result = await firestoreAdapter.saveExchangeConfig(uid, {
        exchange: body.exchange,
        apiKey: body.apiKey,
        secret: body.secret,
        passphrase: body.passphrase,
        testnet: body.testnet,
      });
      
      logger.info({ uid, path: result.path }, 'Write success');
      
      return { 
        ok: true, 
        doc: result 
      };
    } catch (error: any) {
      // Generate error ID for correlation
      const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Log error to admin/errors collection
      try {
        await firestoreAdapter.logError(errorId, {
          uid,
          path: `users/${uid}/exchangeConfig/current`,
          message: 'Failed to save exchange config',
          error: error.message,
          stack: error.stack,
          metadata: { exchange: body.exchange },
        });
      } catch (logError: any) {
        logger.error({ logError: logError.message }, 'Failed to log error to admin/errors');
      }

      logger.error({ error: error.message, uid, errorId }, 'Post-save failed');

      // Check if it's an encryption error
      if (error.message.includes('Encryption failed')) {
        return reply.code(500).send({ 
          error: 'Failed to encrypt credentials', 
          errorId 
        });
      }

      // Retry once if post-save verification failed
      if (error.message.includes('Post-save verification failed')) {
        try {
          logger.info({ uid }, 'Retrying save after verification failure');
          const retryResult = await firestoreAdapter.saveExchangeConfig(uid, {
            exchange: body.exchange,
            apiKey: body.apiKey,
            secret: body.secret,
            passphrase: body.passphrase,
            testnet: body.testnet,
          });
          logger.info({ uid, path: retryResult.path }, 'Retry write success');
          return { 
            ok: true, 
            doc: retryResult 
          };
        } catch (retryError: any) {
          logger.error({ error: retryError.message, uid, errorId }, 'Retry failed');
          return reply.code(500).send({ 
            error: 'Failed to save exchange config after retry', 
            errorId 
          });
        }
      }

      return reply.code(500).send({ 
        error: `Failed to save exchange config: ${error.message}`, 
        errorId 
      });
    }
  });

  // POST /api/exchange-config/delete - Delete exchange config
  fastify.post('/delete', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const db = admin.firestore(getFirebaseAdmin());
      
      const configRef = db
        .collection('users')
        .doc(user.uid)
        .collection('exchangeConfig')
        .doc('current');
      
      await configRef.delete();
      logger.info({ uid: user.uid }, 'Exchange config deleted');
      
      return { message: 'Exchange config deleted successfully' };
    } catch (err: any) {
      logger.error({ err, uid: (request as any).user?.uid }, 'Error deleting exchange config');
      return reply.code(500).send({ error: err.message || 'Error deleting exchange config' });
    }
  });
}

