import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../../services/firestoreAdapter';
import { logger } from '../../utils/logger';
import { getFirebaseAdmin } from '../../utils/firebase';
import * as admin from 'firebase-admin';
import { keyManager } from '../../services/keyManager';
import { routeEntryLog, routeExitLog, firestoreReadWithTimeout } from '../../utils/routeGuards';

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
          secret: (data.secretKeyEncrypted || data.secretEncrypted) ? '[ENCRYPTED]' : '',
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
  // CRITICAL: This route must respond in < 500ms - uses fail-fast guards
  fastify.get('/:uid/exchangeConfig/current', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    // CRITICAL: This MUST log immediately - if not, request never reached route
    console.log("[ROUTE_HIT] /exchangeConfig/current PID:", process.pid, "at", Date.now());
    const startTime = routeEntryLog('GET /exchangeConfig/current');
    
    try {
      const { uid: paramUid } = request.params;
      const authUid = (request as any).userId;

      // If authentication missing, return deterministic disconnected object
      if (!authUid) {
        console.warn('[GET_EXCHANGE_CONFIG] No authUid, returning disconnected');
        routeExitLog('GET /exchangeConfig/current', startTime);
        return reply.send({ connected: false });
      }

      // Determine admin status safely with timeout
      let isAdmin = false;
      try {
        isAdmin = await firestoreReadWithTimeout(
          () => firestoreAdapter.isAdmin(authUid),
          false,
          'isAdmin-check'
        );
      } catch (err: any) {
        console.error('[GET_EXCHANGE_CONFIG_ERROR] isAdmin check failed:', err);
      }

      // Authorization check – only own config or admin
      if (paramUid !== authUid && !isAdmin) {
        console.warn('[GET_EXCHANGE_CONFIG] Unauthorized access attempt');
        routeExitLog('GET /exchangeConfig/current', startTime);
        return reply.send({ connected: false });
      }

      const targetUid = isAdmin ? paramUid : authUid;

      // Firestore read with timeout protection (2s hard limit)
      console.log('[FIRESTORE_ENTER] exchangeConfig read');
      const doc = await firestoreReadWithTimeout(
        async () => {
          const db = getFirebaseAdmin().firestore();
          return await db.collection('users').doc(targetUid).collection('exchangeConfig').doc('current').get();
        },
        null,
        'exchangeConfig-read'
      );
      console.log('[FIRESTORE_EXIT] exchangeConfig read');

      // If document does not exist or timeout, return disconnected object
      if (!doc || !doc.exists) {
        console.log('[GET_EXCHANGE_CONFIG] No config document, returning disconnected');
        routeExitLog('GET /exchangeConfig/current', startTime);
        return reply.send({ connected: false });
      }

      const data = doc.data() || {};
      const exchange = data.exchange || null;
      const hasApiKey = !!data.apiKeyEncrypted;
      const hasSecret = !!(data.secretKeyEncrypted || data.secretEncrypted);
      const isBitget = exchange?.toLowerCase() === 'bitget';
      const hasPassphrase = isBitget ? !!data.passphraseEncrypted : true;
      const connected = !!exchange && hasApiKey && hasSecret && hasPassphrase;

      const responsePayload = {
        exchange,
        apiKeyEncrypted: hasApiKey,
        secretKeyEncrypted: hasSecret,
        passphraseEncrypted: !!data.passphraseEncrypted,
        connected,
      };

      routeExitLog('GET /exchangeConfig/current', startTime);
      return reply.send(responsePayload);
    } catch (err: any) {
      console.error('[GET_EXCHANGE_CONFIG_ERROR] Unexpected error:', err.message);
      routeExitLog('GET /exchangeConfig/current (error)', startTime);
      return reply.send({ connected: false });
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

      console.log("[EXCHANGE_SAVE_UID] paramUid:", paramUid, "authUid:", authUid, "isAdmin:", isAdmin, "targetUid:", targetUid);

      const db = getFirebaseAdmin().firestore();
      const firebaseApp = getFirebaseAdmin();
      console.log("[EXCHANGE_SAVE_FIREBASE] Firebase app projectId:", firebaseApp.options.projectId);
      console.log("[EXCHANGE_SAVE_FIREBASE] Firestore instance type:", typeof db);
      console.log("[EXCHANGE_SAVE_FIREBASE] FIRESTORE_EMULATOR_HOST:", process.env.FIRESTORE_EMULATOR_HOST || "NOT SET");
      console.log("[EXCHANGE_SAVE_FIREBASE] Using emulator:", !!process.env.FIRESTORE_EMULATOR_HOST);

      // CRITICAL: Check if we're using emulator - this could explain silent failures
      if (process.env.FIRESTORE_EMULATOR_HOST) {
        console.error("[EXCHANGE_SAVE_FIREBASE] ⚠️  WARNING: Using Firestore EMULATOR - data will not persist!");
        console.error("[EXCHANGE_SAVE_FIREBASE] ⚠️  EMULATOR_HOST:", process.env.FIRESTORE_EMULATOR_HOST);
      } else {
        console.log("[EXCHANGE_SAVE_FIREBASE] ✅ Using REAL Firestore - data should persist");
      }

      const configRef = db.collection('users').doc(targetUid).collection('exchangeConfig').doc('current');
      console.log("[EXCHANGE_SAVE_DOC_REF] Document path:", configRef.path);
      console.log("[EXCHANGE_SAVE_DOC_REF] Collection path:", configRef.parent.path);

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
        encryptedBody.secretKeyEncrypted = keyManager.encrypt(body.secret);
        // Clean up legacy field if it exists to avoid confusion
        encryptedBody.secretEncrypted = admin.firestore.FieldValue.delete();
        delete encryptedBody.secret; // Remove plain text
      } else if (shouldClearSecret) {
        encryptedBody.secretKeyEncrypted = admin.firestore.FieldValue.delete();
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

      const finalDataToSave = {
        ...encryptedBody,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: authUid
      };

      console.log("[EXCHANGE_SAVE_DATA] Final data to save:", JSON.stringify(finalDataToSave, null, 2));

      console.log("[EXCHANGE_SAVE] Encrypted keys written", {
        hasApiKey: !!finalDataToSave.apiKeyEncrypted,
        hasSecret: !!finalDataToSave.secretKeyEncrypted,
        hasPassphrase: !!finalDataToSave.passphraseEncrypted
      });

      let exchangeWriteSuccess = false;
      try {
        console.log("[EXCHANGE_SAVE_WRITE] ABOUT TO CALL set()...");
        await configRef.set(finalDataToSave, { merge: true });
        console.log("[EXCHANGE_SAVE_WRITE] SUCCESS: set() completed");
        exchangeWriteSuccess = true;
      } catch (writeErr: any) {
        console.error("[EXCHANGE_SAVE_WRITE] CRITICAL: Firestore write failed:", writeErr?.message);
        console.error("[EXCHANGE_SAVE_WRITE] Error stack:", writeErr?.stack);
        console.error("[EXCHANGE_SAVE_WRITE] Error code:", writeErr?.code);
        throw writeErr; // Re-throw to be caught by outer try-catch
      }

      // IMMEDIATE READ-BACK VERIFICATION
      console.log("[EXCHANGE_SAVE_VERIFY] Performing read-back verification...");
      const exchangeSnap = await configRef.get();

      console.log("[EXCHANGE_SAVE_VERIFY] Read-back snapshot exists:", exchangeSnap.exists);
      console.log("[EXCHANGE_SAVE_VERIFY] Read-back snapshot id:", exchangeSnap.id);
      if (exchangeSnap.exists) {
        console.log("[EXCHANGE_SAVE_VERIFY] Read-back snapshot data:", exchangeSnap.data());
      }

      if (!exchangeSnap.exists) {
        console.error("[EXCHANGE_SAVE_VERIFY] CRITICAL: Exchange config write failed - document does not exist after write");
        return reply.status(500).send({ success: false, message: 'Failed to persist exchange configuration - write verification failed' });
      }

      console.log("[EXCHANGE_SAVE_VERIFY] ✅ Exchange config confirmed in Firestore");

      // CRITICAL: Only return success if write was verified
      if (!exchangeWriteSuccess) {
        console.error("[EXCHANGE_SAVE_RESPONSE] CRITICAL: Exchange write flag is false");
        return reply.status(500).send({ success: false, message: 'Exchange config write failed' });
      }

      // Return saved exchange config data for immediate UI updates
      const savedDoc = await configRef.get();
      const savedData = savedDoc.data() || {};
      return reply.send({
        success: true,
        exchangeConfig: {
          exchange: savedData.exchange,
          apiKey: savedData.apiKeyEncrypted ? '[ENCRYPTED]' : null,
          secret: (savedData.secretKeyEncrypted || savedData.secretEncrypted) ? '[ENCRYPTED]' : null,
          passphrase: savedData.passphraseEncrypted ? '[ENCRYPTED]' : null,
          testnet: savedData.testnet ?? true,
          updatedAt: savedData.updatedAt
        }
      });
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