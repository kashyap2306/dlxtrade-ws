console.log("[DEBUG] usersRoutes file EXECUTED");

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';
import { ValidationError, NotFoundError } from '../utils/errors';
import { ensureUser } from '../services/userOnboarding';
import { getFirebaseAdmin } from '../utils/firebase';
import * as admin from 'firebase-admin';
import { keyManager } from '../services/keyManager';

const createUserSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  plan: z.string().optional(),
  apiConnected: z.boolean().optional(),
  unlockedAgents: z.array(z.string()).optional(),
  profilePicture: z.string().optional(),
  hftStatus: z.string().optional(),
  engineStatus: z.string().optional(),
  totalPnL: z.number().optional(),
  totalTrades: z.number().optional(),
  settings: z.any().optional(),
});

const updateUserSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  country: z.string().optional(),
  plan: z.string().optional(),
  apiConnected: z.boolean().optional(),
  unlockedAgents: z.array(z.string()).optional(),
  profilePicture: z.string().optional(),
  hftStatus: z.string().optional(),
  engineStatus: z.string().optional(),
  totalPnL: z.number().optional(),
  totalTrades: z.number().optional(),
  settings: z.any().optional(),
});

export async function usersRoutes(fastify: FastifyInstance) {
  console.log("[CHECK] usersRoutes EXECUTED");

  // 🚨 PROVIDER-CONFIG ROUTE MOVED TO TOP - BEFORE ANY OTHER ROUTES
  // POST /api/users/:uid/provider-config - Save provider configuration
  fastify.post('/:uid/provider-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string }; Body: any }>, reply: FastifyReply) => {
    try {
      console.log("=== PROVIDER CONFIG SAVE START ===");

      const { uid } = request.params;
      const authUid = (request as any).user?.uid;
      const urlUid = request.params.uid;

      // Auth check: ensure user is authenticated
      if (!authUid) {
        console.error("AUTH ERROR: User token missing - request.user is null");
        return reply.status(401).send({ error: "Unauthorized: user token missing" });
      }

      const user = (request as any).user;

      // Auth check: user can only update their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (uid !== authUid && !isAdmin) {
        logger.warn({ authUid, urlUid }, 'Access denied: user can only update their own provider config');
        return reply.code(403).send({ success: false, message: 'Forbidden' });
      }

      const body = request.body as any;

      // Validate the provider config structure
      const requestBody = request.body as any;
      if (!requestBody || typeof requestBody !== 'object') {
        logger.error({ body }, 'Invalid request body - not an object');
        return reply.status(400).send({ success: false, message: 'Invalid request body' });
      }

      const providerConfig = requestBody.providerConfig;
      if (!providerConfig || typeof providerConfig !== 'object') {
        logger.error({ providerConfig }, 'Invalid providerConfig - not an object');
        return reply.status(400).send({ success: false, message: 'providerConfig required' });
      }

      const db = getFirebaseAdmin().firestore();
      const userRef = db.collection('users').doc(uid);

      // Process each provider in the config (supports single or multi-provider payloads)
      const flatProviderConfig: Record<string, any> = {};
      let processedCount = 0;
      let encryptedCount = 0;
      const processedProviders: string[] = [];
      let updatedProviderConfig: any = {};

      for (const providerName of Object.keys(providerConfig)) {
        const providerBody = providerConfig[providerName];

        if (!providerName) {
          console.error("SYNC ERROR: Missing providerName");
          continue;
        }

        const { apiKey, secretKey, enabled = true, type, usageStats } = providerBody || {};
        const normalizedProviderName = (providerName || '').toLowerCase().trim();
        const normalizedType =
          normalizedProviderName.includes('newsdata')
            ? 'news'
            : normalizedProviderName.includes('cryptocompare')
              ? (type === 'marketData' ? 'metadata' : (type || 'metadata'))
              : type;
        const enabledValue = enabled ?? true;

        // Validate apiKey is not an error message or invalid string
        if (apiKey && typeof apiKey === 'string') {
          if (apiKey.length > 200) {
            console.error(`❌ VALIDATION FAILED: apiKey for ${providerName} appears to be an error message (length: ${apiKey.length})`);
            continue; // Skip this provider
          }
          if (apiKey.includes('Fix DLXTRADE') || apiKey.includes('backend expects') || apiKey.includes('frontend is sending')) {
            console.error(`❌ VALIDATION FAILED: apiKey for ${providerName} contains error message text`);
            continue; // Skip this provider
          }
        }

        // Encrypt API keys if present and non-empty
        let encryptedApiKey = '';
        let encryptedSecretKey = '';
        let encryptionSuccess = true;

        try {
          if (apiKey && apiKey.trim() !== '') {
            encryptedApiKey = keyManager.encrypt(apiKey);
            encryptedCount++;
          }

          if (secretKey && secretKey.trim() !== '') {
            encryptedSecretKey = keyManager.encrypt(secretKey);
            encryptedCount++;
          }
        } catch (err: any) {
          console.error("ENCRYPT ERROR:", err);
          encryptionSuccess = false;
          // Continue with other providers but log the error
        }

        // Save to integrations collection with encrypted keys
        const integrationsDocRef = userRef.collection('integrations').doc(providerName);
        const integrationsPayload: any = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          type: normalizedType || type || 'api'
        };

        // Only set encrypted keys if encryption succeeded
        if (encryptedApiKey) {
          integrationsPayload.apiKeyEncrypted = encryptedApiKey;
        }
        if (encryptedSecretKey) {
          integrationsPayload.secretKeyEncrypted = encryptedSecretKey;
        }

        // Set enabled only if there's an encrypted key present
        const hasEncryptedKey = !!encryptedApiKey || !!encryptedSecretKey;
        integrationsPayload.enabled = hasEncryptedKey ? true : (enabledValue || false);

        try {
          await integrationsDocRef.set(integrationsPayload, { merge: true });
        } catch (err: any) {
          console.error("FIRESTORE SAVE ERROR:", err);
          // Continue with other providers but log the error
        }

        // Save to settings/providerConfig (existing behavior for backward compatibility)
        const settingsDocRef = userRef.collection('settings').doc('providerConfig');

        const cleanProviderBody = {
          providerName: normalizedProviderName,
          apiKeyEncrypted: encryptedApiKey,
          type: normalizedType,
          enabled: enabledValue
        };

        // Accumulate flat provider config to save once
        flatProviderConfig[providerName] = cleanProviderBody;

        processedProviders.push(providerName);
        processedCount++;
      }

// Build clean flat config
const settingsDocRef = userRef.collection('settings').doc('providerConfig');
const updated = {};
for (const [providerId, providerData] of Object.entries(flatProviderConfig)) {
  updated[providerId] = {
    providerName: providerId,
    apiKeyEncrypted: providerData.encryptedApiKey || "",
    type: providerData.type || "",
    enabled: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

// SAVE CLEAN CONFIG (ONLY THESE KEYS)
await settingsDocRef.set(updated, { merge: true });
console.log("FINAL_FLAT_CONFIG_SAVED", updated);

      console.log(`PROVIDER CONFIG SAVE COMPLETE: processed=${processedCount}, encrypted=${encryptedCount}, providers=${processedProviders.join(',')}`);

      // Log activity for audit trail
      if (processedCount > 0) {
        await firestoreAdapter.logActivity(uid, 'PROVIDER_CONFIG_UPDATED', {
          message: `Updated provider configurations: ${processedProviders.join(', ')}`,
          providers: processedProviders,
          encryptedKeysCount: encryptedCount
        });
      }

      return reply.send({
        success: true,
        message: `Saved and synced ${processedCount} provider(s) to integrations`,
        processed: processedCount,
        encrypted: encryptedCount,
        providers: processedProviders,
        providerConfig: updatedProviderConfig
      });

    } catch (err: any) {
      console.error("PROVIDER CONFIG SAVE ERROR:", err);
      logger.error({ err, uid: request.params.uid }, 'Error saving provider config & syncing to integrations');
      return reply.status(500).send({ error: String(err), stack: err.stack });
    }
  });

  // POST /api/users/complete-signup - initialize blank provider integrations
  fastify.post('/complete-signup', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { idToken?: string } }>, reply: FastifyReply) => {
    try {
      const uid = (request as any).user?.uid;
      if (!uid) {
        return reply.code(401).send({ success: false, error: 'Unauthorized' });
      }

      const db = getFirebaseAdmin().firestore();
      const now = admin.firestore.Timestamp.now();

      const integrationsRef = db.collection('users').doc(uid).collection('integrations');

      const baseDocs = [
        { id: 'cryptocompare', type: 'market' },
        { id: 'newsdata', type: 'news' },
      ];

      for (const doc of baseDocs) {
        await integrationsRef.doc(doc.id).set({
          providerName: doc.id,
          enabled: false,
          type: doc.type,
          apiKey: '',
          updatedAt: now,
        }, { merge: true });
      }

      return { success: true };
    } catch (err: any) {
      logger.error({ err: err.message }, 'complete-signup failed');
      return reply.code(500).send({ success: false, error: err.message || 'Failed to complete signup' });
    }
  });

  // GET /api/users/:uid/features - Get user features
  fastify.get('/:uid/features', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const user = (request as any).user;

      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      return reply.send({
        success: true,
        features: {
          news: true,
          metadata: true,
          marketData: true
        }
      });
    } catch (err) {
      console.error("FEATURE ROUTE ERROR:", err);
      return reply.code(500).send({ error: 'Failed to load features' });
    }
  });

  console.log("[ROUTE READY] GET /api/users/:uid/exchange-config");
  console.log("[ROUTE READY] POST /api/users/:uid/exchange-config");
  console.log("[ROUTE READY] GET /api/users/:uid/trading-config");
  console.log("[ROUTE READY] POST /api/users/:uid/trading-config");

  console.log("[ROUTE READY] GET /api/users");
  console.log("[ROUTE READY] GET /api/users/:uid");
  console.log("[ROUTE READY] POST /api/users/create");
  console.log("[ROUTE READY] POST /api/users/update");
  console.log("[ROUTE READY] GET /api/users/:id/details");
  console.log("[ROUTE READY] GET /api/users/:id/stats");
  console.log("[ROUTE READY] GET /api/users/:id/pnl");
  console.log("[ROUTE READY] GET /api/users/:id/trades");
  console.log("[ROUTE READY] GET /api/users/:id/logs");
  console.log("[ROUTE READY] GET /api/users/:id/sessions");
  console.log("[ROUTE READY] GET /api/users/:uid/performance-stats");
  console.log("[ROUTE READY] GET /api/users/:uid/active-trades");
  console.log("[ROUTE READY] GET /api/users/:uid/usage-stats");
  console.log("[ROUTE READY] POST /api/users/:uid/provider-config");
  console.log("[ROUTE READY] GET /api/users/:uid/features");

  // GET /api/users/:uid/exchange-config - Get exchange configuration
  fastify.get('/:uid/exchange-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only view their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const db = getFirebaseAdmin().firestore();
      const doc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();

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
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only view their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const db = getFirebaseAdmin().firestore();
      const doc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();

      if (!doc.exists) {
        return reply.send({ exchange: null, message: "No exchange config found" });
      }

      const data = doc.data() || {};
      return reply.send({
        exchange: data.exchange || null,
        lastUpdated: data.updatedAt ? data.updatedAt.toDate().toISOString() : null,
        providerName: data.exchange || null,
        apiKey: data.apiKeyEncrypted ? '[ENCRYPTED]' : null
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
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only update their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const db = getFirebaseAdmin().firestore();
      const configRef = db.collection('users').doc(uid).collection('exchangeConfig').doc('current');

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
        updatedBy: user.uid
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
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only view their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const db = getFirebaseAdmin().firestore();
      const doc = await db.collection('trading-config').doc(uid).get();

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
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only update their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const db = getFirebaseAdmin().firestore();
      await db.collection('trading-config').doc(uid).set(request.body, { merge: true });

      request.log.info({ uid, body: request.body }, 'Saved trading-config');

      return reply.send({ ok: true, config: request.body });
    } catch (err: any) {
      request.log.error({ err }, 'Failed to save trading-config');
      return reply.code(500).send({ error: 'Failed to save trading config' });
    }
  });

  // Extract provider config logic into a separate function for testing
  async function getProviderConfig(uid: string) {
    // Get all integrations from the integrations collection
    const allIntegrations = await firestoreAdapter.getAllIntegrations(uid);

    const decryptSafe = (value?: string) => {
      if (!value) {
        console.log(`DECRYPT_DEBUG: No encrypted value provided`);
        return '';
      }
      try {
        console.log(`DECRYPT_DEBUG: Attempting to decrypt value of length ${value.length}`);
        const decrypted = keyManager.decrypt(value) || '';
        console.log(`DECRYPT_DEBUG: Decryption result length: ${decrypted.length}, starts with: ${decrypted.substring(0, 10)}...`);
        return decrypted;
      } catch (err: any) {
        console.log(`DECRYPT_DEBUG: Decryption failed: ${err.message}`);
        logger.warn({ err: err.message }, 'Failed to decrypt provider key, returning empty string');
        return '';
      }
    };

    // Map integrations to categories based on provider type
    const providerCategories = {
      news: { primary: null as any, backups: [] as any[] },
      metadata: { primary: null as any, backups: [] as any[] },
      marketData: { primary: null as any, backups: [] as any[] }
    };

    const providerTypeMap: Record<string, string> = {
      // News providers
      newsdata: 'news',
      cryptopanic: 'news',
      gnews: 'news',
      reddit: 'news',
      twitter: 'news',
      alternativeme: 'news',
      // Metadata providers
      cryptocompare: 'metadata',
      coingecko: 'metadata',
      coinmarketcap: 'metadata',
      coinpaprika: 'metadata',
      nomics: 'metadata',
      messari: 'metadata',
      cryptorank: 'metadata',
      // Market data providers
      binancepublic: 'marketData',
      kucoinpublic: 'marketData',
      bybitpublic: 'marketData',
      okxpublic: 'marketData',
      bitgetpublic: 'marketData',
      'cryptocompare-freemode-1': 'marketData',
      'cryptocompare-freemode-2': 'marketData',
    };

    // Process all integrations and categorize them into backups first
    for (const [providerName, integration] of Object.entries(allIntegrations)) {
      const category = providerTypeMap[providerName] || 'marketData';
      const decryptedApiKey = decryptSafe(integration.apiKey);

      const providerInfo = {
        providerName,
        enabled: !!integration.enabled,
        apiKey: decryptedApiKey,
        apiKeyEncrypted: integration.apiKey || '',
        type: category,
        updatedAt: integration.updatedAt?.toDate?.()?.toISOString?.() || null
      };

      providerCategories[category].backups.push(providerInfo);
    }

    // Enforce mandatory primaries for newsdata (news) and cryptocompare (metadata)
    const newsPrimary = allIntegrations['newsdata'];
    console.log(`MANDATORY_DEBUG: newsdata integration found: ${!!newsPrimary}`);
    if (newsPrimary) {
      console.log(`MANDATORY_DEBUG: newsdata enabled: ${newsPrimary.enabled}, has apiKey: ${!!newsPrimary.apiKey}`);
      const decryptedApiKey = decryptSafe(newsPrimary.apiKey);
      console.log(`MANDATORY_DEBUG: newsdata decrypted key length: ${decryptedApiKey.length}`);
      providerCategories.news.backups = providerCategories.news.backups.filter(b => b.providerName !== 'newsdata');
      providerCategories.news.primary = {
        providerName: 'newsdata',
        enabled: !!newsPrimary.enabled,
        apiKey: decryptedApiKey,
        apiKeyEncrypted: newsPrimary.apiKey || '',
        type: 'news',
        updatedAt: newsPrimary.updatedAt?.toDate?.()?.toISOString?.() || null
      };
    } else {
      console.log(`MANDATORY_DEBUG: newsdata integration NOT found in allIntegrations`);
    }

    const metadataPrimary = allIntegrations['cryptocompare'];
    console.log(`MANDATORY_DEBUG: cryptocompare integration found: ${!!metadataPrimary}`);
    if (metadataPrimary) {
      console.log(`MANDATORY_DEBUG: cryptocompare enabled: ${metadataPrimary.enabled}, has apiKey: ${!!metadataPrimary.apiKey}`);
      const decryptedApiKey = decryptSafe(metadataPrimary.apiKey);
      console.log(`MANDATORY_DEBUG: cryptocompare decrypted key length: ${decryptedApiKey.length}`);
      providerCategories.metadata.backups = providerCategories.metadata.backups.filter(b => b.providerName !== 'cryptocompare');
      providerCategories.metadata.primary = {
        providerName: 'cryptocompare',
        enabled: !!metadataPrimary.enabled,
        apiKey: decryptedApiKey,
        apiKeyEncrypted: metadataPrimary.apiKey || '',
        type: 'metadata',
        updatedAt: metadataPrimary.updatedAt?.toDate?.()?.toISOString?.() || null
      };
    } else {
      console.log(`MANDATORY_DEBUG: cryptocompare integration NOT found in allIntegrations`);
    }

    // Add integration count logging for Auto-Trade debugging
    const totalIntegrations = Object.values(allIntegrations).filter(i => i.enabled).length;
    const providerNames = Object.keys(allIntegrations).filter(name => allIntegrations[name].enabled);

    console.log(`Auto-Trade: Loaded integrations count: ${totalIntegrations}`);
    if (totalIntegrations === 0) {
      console.error(`Auto-Trade: No integrations found for uid=${uid} at users/${uid}/integrations`);
    } else {
      console.log(`Auto-Trade: Found providers: ${providerNames.join(', ')}`);
    }

    return providerCategories;
  }

  // GET /api/users/:uid/provider-config - Get provider configuration
  fastify.get('/:uid/provider-config', {
    // preHandler: [fastify.authenticate], // Temporarily disabled for debugging
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only view their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      // Read from users/{uid}/settings/providerConfig and decrypt keys
      const db = getFirebaseAdmin().firestore();
      const settingsDocRef = db.collection('users').doc(uid).collection('settings').doc('providerConfig');
      const settingsDoc = await settingsDocRef.get();

const stored = settingsDoc.exists ? settingsDoc.data() || {} : {};
console.log("GET_PROVIDER_CONFIG_LOADED", stored);

const decryptedConfig = {};
for (const [providerId, d] of Object.entries(stored)) {
  decryptedConfig[providerId] = {
    providerName: providerId,
    apiKey: d.apiKeyEncrypted ? keyManager.decrypt(d.apiKeyEncrypted) : "",
    type: d.type || "",
    enabled: d.enabled ?? false
  };
}

return reply.send({ providerConfig: decryptedConfig });
    } catch (err: any) {
      logger.error({ err }, 'Error getting provider config');
      return reply.code(500).send({ error: 'Failed to get provider config' });
    }
  });

  // POST /api/users/:uid/request-delete - Request user account deletion
  fastify.post('/:uid/request-delete', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only request deletion for their own account unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const db = getFirebaseAdmin().firestore();

      // Mark user for deletion
      await db.collection('users').doc(uid).update({
        deleteRequested: true,
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Log the deletion request
      await firestoreAdapter.logActivity(uid, 'ACCOUNT_DELETION_REQUESTED', {
        message: 'User requested account deletion',
        requestedAt: new Date().toISOString(),
      });

      return { success: true };
    } catch (err: any) {
      logger.error({ err }, 'Error requesting user deletion');
      return reply.code(500).send({ error: 'Failed to request account deletion' });
    }
  });

  // GET /api/users - Get all users (admin only)
  fastify.get('/users', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      // Check if user is admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (!isAdmin) {
        return reply.code(403).send({ error: 'Admin access required' });
      }

      const users = await firestoreAdapter.getAllUsers();
      return { users };
    } catch (err: any) {
      logger.error({ err }, 'Error getting users');
      return reply.code(500).send({ error: err.message || 'Error fetching users' });
    }
  });

  // GET /api/users/:uid - Get specific user
  fastify.get('/:uid', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const user = (request as any).user;
      
      // Users can only view their own data unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const userData = await firestoreAdapter.getUser(uid);
      if (!userData) {
        throw new NotFoundError('User not found');
      }

      // Check if user has exchange API keys configured (read from exchangeConfig/current)
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = getFirebaseAdmin().firestore();
      const exchangeConfigDoc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();
      const hasExchangeConfig = exchangeConfigDoc.exists && exchangeConfigDoc.data()?.apiKeyEncrypted && exchangeConfigDoc.data()?.secretEncrypted;

      // Convert timestamps
      const result: any = { ...userData };
      if (result.createdAt) {
        result.createdAt = result.createdAt.toDate().toISOString();
      }
      if (result.updatedAt) {
        result.updatedAt = result.updatedAt.toDate().toISOString();
      }

      // Override apiConnected with computed value from exchangeConfig/current
      result.apiConnected = hasExchangeConfig || false;

      return result;
    } catch (err: any) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      logger.error({ err }, 'Error getting user');
      return reply.code(500).send({ error: err.message || 'Error fetching user' });
    }
  });

  // POST /api/users/create - Create user (called on sign-in)
  // PART 1: Creates ALL required Firestore documents
  fastify.post('/users/create', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = createUserSchema.parse(request.body);

      // PART 1: Comprehensive onboarding - creates ALL required documents (idempotent)
      const onboardingResult = await ensureUser(user.uid, {
        name: body.name || user.displayName || '',
        email: body.email || user.email || '',
        phone: body.phone || null,
      });

      if (!onboardingResult.success) {
        logger.error({ uid: user.uid, error: onboardingResult.error }, 'User onboarding failed');
        return reply.code(500).send({ 
          error: onboardingResult.error || 'User onboarding failed' 
        });
      }

      // Update additional fields if provided
      if (body.plan || body.profilePicture || body.unlockedAgents) {
        await firestoreAdapter.createOrUpdateUser(user.uid, {
          plan: body.plan,
          profilePicture: body.profilePicture,
          unlockedAgents: body.unlockedAgents,
        });
      }

      // Log login activity (signup already logged in onboardNewUser)
      const existingUser = await firestoreAdapter.getUser(user.uid);
      if (existingUser && existingUser.createdAt) {
        // Check if this is a returning user (created > 1 minute ago)
        const createdTime = existingUser.createdAt.toDate();
        const now = new Date();
        const minutesSinceCreation = (now.getTime() - createdTime.getTime()) / 1000 / 60;
        
        if (minutesSinceCreation > 1) {
          await firestoreAdapter.logActivity(user.uid, 'USER_LOGIN', {
            message: `User ${body.email || user.email} logged in`,
            email: body.email || user.email,
          });
        }
      }

      return { message: 'User created/updated successfully', uid: user.uid };
    } catch (err: any) {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ error: err.message });
      }
      logger.error({ err }, 'Error creating user');
      return reply.code(500).send({ error: err.message || 'Error creating user' });
    }
  });

  // POST /api/users/update - Update user
  fastify.post('/users/update', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = updateUserSchema.parse(request.body);

      await firestoreAdapter.createOrUpdateUser(user.uid, body);

      // Log activity
      const changedFields = Object.keys(body);
      await firestoreAdapter.logActivity(user.uid, 'PROFILE_UPDATED', { 
        fields: changedFields,
        hasName: !!body.name,
        hasPhone: !!body.phone,
        hasCountry: !!body.country,
      });

      return { success: true, updated: body };
    } catch (err: any) {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ error: err.message });
      }
      logger.error({ err }, 'Error updating user');
      return reply.code(500).send({ error: err.message || 'Error updating user' });
    }
  });

  // GET /api/users/:id/details - Get user details
  fastify.get('/:id/details', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const user = (request as any).user;
      
      // Users can only view their own data unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (id !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const userData = await firestoreAdapter.getUser(id);
      if (!userData) {
        throw new NotFoundError('User not found');
      }

      // Check if user has exchange API keys configured (read from exchangeConfig/current)
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = getFirebaseAdmin().firestore();
      const exchangeConfigDoc = await db.collection('users').doc(id).collection('exchangeConfig').doc('current').get();
      const hasExchangeConfig = exchangeConfigDoc.exists && exchangeConfigDoc.data()?.apiKeyEncrypted && exchangeConfigDoc.data()?.secretEncrypted;

      // Convert timestamps
      const result: any = { ...userData };
      if (result.createdAt) {
        result.createdAt = result.createdAt.toDate().toISOString();
      }
      if (result.updatedAt) {
        result.updatedAt = result.updatedAt.toDate().toISOString();
      }

      // Override apiConnected with computed value from exchangeConfig/current
      result.apiConnected = hasExchangeConfig || false;

      return result;
    } catch (err: any) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      logger.error({ err }, 'Error getting user details');
      return reply.code(500).send({ error: err.message || 'Error fetching user details' });
    }
  });

  // GET /api/users/:id/stats - Get user statistics
  fastify.get('/:id/stats', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const user = (request as any).user;
      
      // Users can only view their own stats unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (id !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const userData = await firestoreAdapter.getUser(id);
      if (!userData) {
        throw new NotFoundError('User not found');
      }

      // Get trades for PnL calculation
      const trades = await firestoreAdapter.getTrades(id, 1000);
      const totalPnL = trades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
      const winningTrades = trades.filter(t => (t.pnl || 0) > 0).length;
      const losingTrades = trades.filter(t => (t.pnl || 0) < 0).length;

      return {
        totalPnL: userData.totalPnL || totalPnL,
        totalTrades: userData.totalTrades || trades.length,
        winningTrades,
        losingTrades,
        winRate: trades.length > 0 ? (winningTrades / trades.length) * 100 : 0,
        avgPnL: trades.length > 0 ? totalPnL / trades.length : 0,
      };
    } catch (err: any) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      logger.error({ err }, 'Error getting user stats');
      return reply.code(500).send({ error: err.message || 'Error fetching user stats' });
    }
  });

  // GET /api/users/:id/pnl - Get user PnL
  fastify.get('/:id/pnl', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const user = (request as any).user;
      
      // Users can only view their own PnL unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (id !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const userData = await firestoreAdapter.getUser(id);
      if (!userData) {
        throw new NotFoundError('User not found');
      }

      // Get trades for PnL calculation
      const trades = await firestoreAdapter.getTrades(id, 1000);
      const totalPnL = trades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);

      return {
        totalPnL: userData.totalPnL || totalPnL,
        dailyPnL: trades
          .filter(t => {
            let tradeDate: Date;
            if (t.createdAt?.toDate) {
              tradeDate = t.createdAt.toDate();
            } else if (t.createdAt) {
              tradeDate = new Date(t.createdAt);
            } else {
              return false;
            }
            const today = new Date();
            return tradeDate.toDateString() === today.toDateString();
          })
          .reduce((sum, trade) => sum + (trade.pnl || 0), 0),
        weeklyPnL: trades
          .filter(t => {
            let tradeDate: Date;
            if (t.createdAt?.toDate) {
              tradeDate = t.createdAt.toDate();
            } else if (t.createdAt) {
              tradeDate = new Date(t.createdAt);
            } else {
              return false;
            }
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            return tradeDate >= weekAgo;
          })
          .reduce((sum, trade) => sum + (trade.pnl || 0), 0),
        monthlyPnL: trades
          .filter(t => {
            let tradeDate: Date;
            if (t.createdAt?.toDate) {
              tradeDate = t.createdAt.toDate();
            } else if (t.createdAt) {
              tradeDate = new Date(t.createdAt);
            } else {
              return false;
            }
            const monthAgo = new Date();
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            return tradeDate >= monthAgo;
          })
          .reduce((sum, trade) => sum + (trade.pnl || 0), 0),
      };
    } catch (err: any) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      logger.error({ err }, 'Error getting user PnL');
      return reply.code(500).send({ error: err.message || 'Error fetching user PnL' });
    }
  });

  // GET /api/users/:id/trades - Get user trades
  fastify.get('/:id/trades', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string }; Querystring: { limit?: number } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const { limit = 100 } = request.query;
      const user = (request as any).user;
      
      // Users can only view their own trades unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (id !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const trades = await firestoreAdapter.getTrades(id, limit);
      
      return {
        trades: trades.map(trade => ({
          ...trade,
          createdAt: trade.createdAt?.toDate?.()?.toISOString() || new Date(trade.createdAt).toISOString(),
          updatedAt: trade.updatedAt?.toDate?.()?.toISOString() || new Date(trade.updatedAt).toISOString(),
        })),
        count: trades.length,
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting user trades');
      return reply.code(500).send({ error: err.message || 'Error fetching user trades' });
    }
  });

  // GET /api/users/:id/logs - Get user activity logs
  fastify.get('/:id/logs', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string }; Querystring: { limit?: number } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const { limit = 100 } = request.query;
      const user = (request as any).user;
      
      // Users can only view their own logs unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (id !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const logs = await firestoreAdapter.getActivityLogs(id, limit);
      
      return {
        logs: logs.map(log => ({
          ...log,
          timestamp: log.timestamp?.toDate?.()?.toISOString() || new Date(log.timestamp).toISOString(),
        })),
        count: logs.length,
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting user logs');
      return reply.code(500).send({ error: err.message || 'Error fetching user logs' });
    }
  });


  // GET /api/users/:id/sessions - Get user sessions
  fastify.get('/:id/sessions', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const user = (request as any).user;

      // Users can only view their own sessions unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (id !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      // Get sessions from Firestore - assuming sessions are stored in a sessions collection
      const db = getFirebaseAdmin().firestore();
      const sessionsSnapshot = await db
        .collection('users')
        .doc(id)
        .collection('sessions')
        .orderBy('lastActive', 'desc')
        .limit(10)
        .get();

      const sessions = sessionsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        lastActive: doc.data().lastActive?.toDate?.()?.toISOString() || null,
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
      }));

      return { sessions };
    } catch (err: any) {
      logger.error({ err }, 'Error getting user sessions');
      return reply.code(500).send({ error: err.message || 'Error fetching user sessions' });
    }
  });

  // GET /api/users/:uid/performance-stats - Get user performance statistics
  fastify.get('/:uid/performance-stats', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only view their own performance stats unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      // Get all trades for the user
      const trades = await firestoreAdapter.getTrades(uid, 10000); // Get up to 10k trades

      // Calculate performance stats
      let totalTrades = trades.length;
      let allTimePnL = 0;
      let dailyPnL = 0;
      let winningTrades = 0;
      let closedTrades = 0;

      // Today's date for daily PnL calculation
      const today = new Date();
      const todayString = today.toDateString();

      for (const trade of trades) {
        // Calculate all-time PnL
        if (trade.pnl !== undefined && trade.pnl !== null) {
          allTimePnL += trade.pnl;

          // Count closed trades (trades with pnl)
          closedTrades++;

          // Count winning trades
          if (trade.pnl > 0) {
            winningTrades++;
          }
        }

        // Calculate daily PnL (today only)
        if (trade.timestamp) {
          const tradeDate = new Date(trade.timestamp);
          if (tradeDate.toDateString() === todayString && trade.pnl !== undefined && trade.pnl !== null) {
            dailyPnL += trade.pnl;
          }
        }
      }

      // Calculate win rate
      const winRate = closedTrades > 0 ? (winningTrades / closedTrades) * 100 : 0;

      return {
        dailyPnL: parseFloat(dailyPnL.toFixed(2)),
        allTimePnL: parseFloat(allTimePnL.toFixed(2)),
        winRate: parseFloat(winRate.toFixed(2)),
        totalTrades,
      };
    } catch (err: any) {
      logger.error({ err, uid: request.params.uid }, 'Error getting user performance stats');
      return reply.code(500).send({ error: err.message || 'Error fetching user performance stats' });
    }
  });

  // GET /api/users/:uid/active-trades - Get user's active trades
  fastify.get('/:uid/active-trades', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only view their own active trades unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      // Get user's active exchange
      const db = getFirebaseAdmin().firestore();
      const exchangeConfigDoc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();
      const exchangeConfig = exchangeConfigDoc.exists ? exchangeConfigDoc.data() : null;
      const activeExchange = exchangeConfig?.exchange;

      if (!activeExchange) {
        return reply.send([]);
      }

      // Query trades collection for open trades on the active exchange
      const tradesRef = db.collection('trades');
      const snapshot = await tradesRef
        .where('uid', '==', uid)
        .where('status', '==', 'open')
        .where('exchange', '==', activeExchange)
        .orderBy('timestamp', 'desc')
        .limit(50)
        .get();

      const activeTrades = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          tradeId: doc.id,
          pair: data.symbol || '',
          side: data.side || 'buy',
          entryPrice: data.entryPrice || 0,
          signalAccuracy: data.signalAccuracy || 0,
          timestamp: data.timestamp?.toDate?.()?.toISOString() || new Date(data.timestamp).toISOString(),
          currentPrice: null, // Optional: could be populated with live price
        };
      });

      return reply.send(activeTrades);
    } catch (err: any) {
      logger.error({ err, uid: request.params.uid }, 'Error getting user active trades');
      return reply.code(500).send({ error: err.message || 'Error fetching user active trades' });
    }
  });

  // GET /api/users/:uid/usage-stats - Get user's usage statistics
  fastify.get('/:uid/usage-stats', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only view their own usage stats unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const db = getFirebaseAdmin().firestore();

      // Get research logs count (Deep Research runs)
      const researchLogsSnapshot = await db
        .collection('users')
        .doc(uid)
        .collection('researchLogs')
        .get();

      // Get auto-trade logs count (Auto-Trade runs)
      const autoTradeLogsSnapshot = await db
        .collection('users')
        .doc(uid)
        .collection('autoTradeLogs')
        .get();

      // Get last research activity timestamp
      let lastResearchTimestamp = null;
      const lastResearchQuery = await db
        .collection('users')
        .doc(uid)
        .collection('researchLogs')
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();

      if (!lastResearchQuery.empty) {
        const lastResearchDoc = lastResearchQuery.docs[0];
        lastResearchTimestamp = lastResearchDoc.data().timestamp?.toDate().toISOString();
      }

      // Check if last activity is more recent from auto-trade logs
      const lastAutoTradeQuery = await db
        .collection('users')
        .doc(uid)
        .collection('autoTradeLogs')
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();

      if (!lastAutoTradeQuery.empty) {
        const lastAutoTradeDoc = lastAutoTradeQuery.docs[0];
        const autoTradeTimestamp = lastAutoTradeDoc.data().timestamp?.toDate().toISOString();
        if (!lastResearchTimestamp || autoTradeTimestamp > lastResearchTimestamp) {
          lastResearchTimestamp = autoTradeTimestamp;
        }
      }

      // For now, assume manual research is research logs that aren't from auto-trade
      // This is a simplification - in a real implementation, you'd have a type field
      const manualResearchRuns = researchLogsSnapshot.size;

      return reply.send({
        totalDeepResearchRuns: researchLogsSnapshot.size,
        totalAutoTradeRuns: autoTradeLogsSnapshot.size,
        totalManualResearchRuns: manualResearchRuns,
        lastResearchTimestamp,
      });
    } catch (err: any) {
      logger.error({ err, uid: request.params.uid }, 'Error getting user usage stats');
      return reply.code(500).send({ error: err.message || 'Error fetching user usage stats' });
    }
  });

  // GET /user/profile - Get user profile
  fastify.get('/user/profile', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;

    try {
      const userData = await firestoreAdapter.getUser(user.uid);
      if (!userData) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Check if user has exchange API keys configured
      const db = admin.firestore(getFirebaseAdmin());
      const exchangeConfigDoc = await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get();
      const hasExchangeConfig = exchangeConfigDoc.exists && exchangeConfigDoc.data()?.apiKeyEncrypted;

      // Convert timestamps
      const result = { ...userData };
      if (result.createdAt) {
        result.createdAt = result.createdAt.toDate().toISOString();
      }
      if (result.updatedAt) {
        result.updatedAt = result.updatedAt.toDate().toISOString();
      }

      // Override apiConnected with computed value
      result.apiConnected = hasExchangeConfig || false;

      return result;
    } catch (err: any) {
      logger.error({ err }, 'Error getting user profile');
      return reply.code(500).send({ error: err.message || 'Error fetching user profile' });
    }
  });

  // POST /user/profile/update - Update user profile
  fastify.post('/user/profile/update', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = updateUserSchema.parse(request.body);

    try {
      await firestoreAdapter.createOrUpdateUser(user.uid, body);

      // Log activity
      const changedFields = Object.keys(body);
      await firestoreAdapter.logActivity(user.uid, 'PROFILE_UPDATED', {
        fields: changedFields,
        hasName: !!body.name,
        hasPhone: !!body.phone,
        hasCountry: !!body.country,
      });

      return { success: true, message: 'Profile updated successfully', uid: user.uid };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: err.errors });
      }
      logger.error({ err }, 'Error updating user profile');
      return reply.code(500).send({ error: err.message || 'Error updating user profile' });
    }
  });

  // POST /api/users/test-route - Test route
  fastify.post('/test-route', {
    // preHandler: [fastify.authenticate], // Temporarily disabled for testing
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    console.log("[TEST ROUTE] Called!");
    return reply.send({ ok: true, message: "Test route works" });
  });

  // Test script for provider config decryption
  async function runProviderConfigTest() {
    try {
      console.log("=== PROVIDER CONFIG DECRYPTION TEST ===");

      // Get a known uid from Firestore (first user document)
      const db = getFirebaseAdmin().firestore();
      const usersSnapshot = await db.collection('users').limit(1).get();

      if (usersSnapshot.empty) {
        console.log("FAIL: No users found in Firestore");
        return false;
      }

      const uid = usersSnapshot.docs[0].id;
      console.log(`Testing with uid: ${uid}`);

      const providerConfig = await getProviderConfig(uid);

      // Check newsdata primary
      const newsdataKey = providerConfig.news?.primary?.apiKey;
      const newsdataKeyLength = newsdataKey ? newsdataKey.length : 0;
      console.log(`providerConfig.newsdata.apiKey length: ${newsdataKeyLength}`);

      // Check cryptocompare primary
      const cryptocompareKey = providerConfig.metadata?.primary?.apiKey;
      const cryptocompareKeyLength = cryptocompareKey ? cryptocompareKey.length : 0;
      console.log(`providerConfig.cryptocompare.apiKey length: ${cryptocompareKeyLength}`);

      // Validate both keys exist, are strings, and have reasonable length (> 5 chars)
      const newsdataValid = newsdataKey && typeof newsdataKey === 'string' && newsdataKey.length > 5;
      const cryptocompareValid = cryptocompareKey && typeof cryptocompareKey === 'string' && cryptocompareKey.length > 5;

      console.log(`BACKEND_TEST: newsdata.apiKey type=${typeof newsdataKey}, length=${newsdataKeyLength}, valid=${newsdataValid}`);
      console.log(`BACKEND_TEST: cryptocompare.apiKey type=${typeof cryptocompareKey}, length=${cryptocompareKeyLength}, valid=${cryptocompareValid}`);

      if (!newsdataValid || !cryptocompareValid) {
        console.log("BACKEND_TEST: FAIL (api keys not properly decrypted)");
        return false;
      }

      console.log("BACKEND_TEST: PASS (api keys decrypted)");
      return true;

    } catch (error: any) {
      console.error("TEST ERROR:", error);
      console.log("FAIL: Test execution failed");
      return false;
    }
  }

  // Test moved to separate script - don't run during plugin registration
  // console.log("Running provider config decryption test...");
  // const testResult = await runProviderConfigTest();
  // if (!testResult) {
  //   console.log("Test failed, attempting to fix and re-run...");
  //   const retryResult = await runProviderConfigTest();
  //   if (!retryResult) {
  //     console.log("FAIL: Test still failing after retry");
  //   }
  // }

  // GET /api/temp-test - Temporary Firestore connectivity test
  fastify.get('/temp-test', {}, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Allow optional auth; fallback to uid passed via query/header for local testing
      const uid =
        (request as any).user?.uid ||
        (request as any).query?.uid ||
        (request as any).headers?.['x-uid'];

      if (!uid) {
        console.log('[TEMP-TEST] Missing uid (auth or query/header uid)');
        return reply.code(401).send({ ok: false, error: 'Unauthorized' });
      }

      // Try to read a simple Firestore document
      const db = getFirebaseAdmin().firestore();
      const docRef = db.collection('users').doc(uid).collection('integrations').doc('newsdata');
      const doc = await docRef.get();

      if (doc.exists) {
        return reply.send({ ok: true });
      } else {
        return reply.send({ ok: false });
      }
    } catch (err: any) {
      console.error('Temp test error:', err);
      return reply.send({ ok: false });
    }
  });
}

