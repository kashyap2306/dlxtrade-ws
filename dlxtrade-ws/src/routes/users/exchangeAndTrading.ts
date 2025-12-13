import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../../services/firestoreAdapter';
import { logger } from '../../utils/logger';
import { getFirebaseAdmin } from '../../utils/firebase';
import * as admin from 'firebase-admin';
import { keyManager } from '../../services/keyManager';

export async function exchangeAndTradingRoutes(fastify: FastifyInstance) {
  // GET /api/users/:uid/exchange-config - Get exchange configuration
  fastify.get('/:uid/exchange-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid: paramUid } = request.params;
      const authUid = (request as any).userId;

      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Users can only view their own config unless they're admin
      // Skip auth check if auth is disabled (for testing)
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (paramUid !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const targetUid = isAdmin ? paramUid : authUid;

      const db = getFirebaseAdmin().firestore();
      const doc = await db.collection('users').doc(targetUid).collection('exchangeConfig').doc('current').get();

      if (!doc.exists) {
        return reply.send({ accounts: [] });
      }

      const data = doc.data() || {};
      return reply.send({
        accounts: [{
          exchange: data.exchange,
          apiKey: data.apiKeyEncrypted ? '[ENCRYPTED]' : '',
          secret: data.secretEncrypted ? '[ENCRYPTED]' : '',
          passphrase: data.passphraseEncrypted ? '[ENCRYPTED]' : '',
          testnet: data.testnet ?? true
        }]
      });
    } catch (err: any) {
      logger.error({ err }, 'Error getting exchange config');
      return reply.code(500).send({ error: 'Failed to get exchange config' });
    }
  });

  // GET /api/users/:uid/exchangeConfig/current - Get current exchange configuration (matches frontend expectation)
  fastify.get('/:uid/exchangeConfig/current', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid: paramUid } = request.params;
      const authUid = (request as any).userId;

      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Users can only view their own config unless they're admin
      // Skip auth check if auth is disabled (for testing)
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (paramUid !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const targetUid = isAdmin ? paramUid : authUid;

      const db = getFirebaseAdmin().firestore();
      const doc = await db.collection('users').doc(targetUid).collection('exchangeConfig').doc('current').get();

      if (!doc.exists) {
        return reply.send({ exchange: null, message: "No exchange config found" });
      }

      const data = doc.data() || {};
      return reply.send({
        exchange: data.exchange || null,
        lastUpdated: data.updatedAt ? data.updatedAt.toDate().toISOString() : null,
        providerName: data.exchange || null,
        apiKey: data.apiKeyEncrypted ? '[ENCRYPTED]' : null,
        // Expose encrypted field presence for guaranteedAccess logic
        apiKeyEncrypted: !!data.apiKeyEncrypted,
        secretKeyEncrypted: !!data.secretKeyEncrypted,
        passphraseEncrypted: !!data.passphraseEncrypted
      });
    } catch (err: any) {
      logger.error({ err }, 'Error getting current exchange config');
      return reply.send({ exchange: null, message: "No exchange config found" });
    }
  });

  // POST /api/users/:uid/exchange-config - Save exchange configuration
  fastify.post('/:uid/exchange-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string }; Body: any }>, reply: FastifyReply) => {
    try {
      const { uid: paramUid } = request.params;
      const authUid = (request as any).userId;

      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Users can only update their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (paramUid !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const targetUid = isAdmin ? paramUid : authUid;

      const db = getFirebaseAdmin().firestore();
      const configRef = db.collection('users').doc(targetUid).collection('exchangeConfig').doc('current');

      // Encrypt sensitive fields, or explicitly clear them when empty/null
      const body = request.body as any;
      const encryptedBody: any = { ...body };

      const shouldClearApiKey = body.apiKey === '' || body.apiKey === null || body.apiKey === undefined;
      const shouldClearSecret = body.secret === '' || body.secret === null || body.secret === undefined;
      const shouldClearPassphrase = body.passphrase === '' || body.passphrase === null || body.passphrase === undefined;

      if (body.apiKey && body.apiKey.trim() !== '') {
        encryptedBody.apiKeyEncrypted = keyManager.encrypt(body.apiKey);
        delete encryptedBody.apiKey; // Remove plain text
      } else if (shouldClearApiKey) {
        encryptedBody.apiKeyEncrypted = admin.firestore.FieldValue.delete();
        delete encryptedBody.apiKey;
      }

      if (body.secret && body.secret.trim() !== '') {
        encryptedBody.secretEncrypted = keyManager.encrypt(body.secret);
        delete encryptedBody.secret; // Remove plain text
      } else if (shouldClearSecret) {
        encryptedBody.secretEncrypted = admin.firestore.FieldValue.delete();
        delete encryptedBody.secret;
      }

      if (body.passphrase && body.passphrase.trim() !== '') {
        encryptedBody.passphraseEncrypted = keyManager.encrypt(body.passphrase);
        delete encryptedBody.passphrase; // Remove plain text
      } else if (shouldClearPassphrase) {
        encryptedBody.passphraseEncrypted = admin.firestore.FieldValue.delete();
        delete encryptedBody.passphrase;
      }

      // Clear exchange field when explicitly emptied
      if (!body.exchange) {
        encryptedBody.exchange = admin.firestore.FieldValue.delete();
      }

      await configRef.set({
        ...encryptedBody,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: authUid
      }, { merge: true });

      return reply.send({ success: true });
    } catch (err: any) {
      logger.error({ err }, 'Error saving exchange config');
      return reply.code(500).send({ error: 'Failed to save exchange config' });
    }
  });

  // GET /api/users/:uid/trading-config - Get trading configuration
  fastify.get('/:uid/trading-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid: paramUid } = request.params;
      const authUid = (request as any).userId;

      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Users can only view their own config unless they're admin
      // Skip auth check if auth is disabled (for testing)
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (paramUid !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const targetUid = isAdmin ? paramUid : authUid;

      const db = getFirebaseAdmin().firestore();
      const doc = await db.collection('trading-config').doc(targetUid).get();

      const data = doc.exists ? doc.data() : null;
      return reply.send({ ok: true, config: data });
    } catch (err: any) {
      logger.error({ err }, 'Failed to load trading-config');
      return reply.code(500).send({ error: 'Failed to load trading config' });
    }
  });

  // POST /api/users/:uid/trading-config - Save trading configuration
  fastify.post('/:uid/trading-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string }; Body: any }>, reply: FastifyReply) => {
    try {
      const { uid: paramUid } = request.params;
      const authUid = (request as any).userId;

      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Users can only update their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (paramUid !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const targetUid = isAdmin ? paramUid : authUid;

      const db = getFirebaseAdmin().firestore();
      await db.collection('trading-config').doc(targetUid).set(request.body, { merge: true });

      request.log.info({ uid: targetUid, body: request.body }, 'Saved trading-config');

      return reply.send({ ok: true, config: request.body });
    } catch (err: any) {
      request.log.error({ err }, 'Failed to save trading-config');
      return reply.code(500).send({ error: 'Failed to save trading config' });
    }
  });
}