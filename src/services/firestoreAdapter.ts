import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';
import { logger } from '../utils/logger';
import { encrypt, decrypt, maskKey } from './keyManager';
import { ExchangeConnectorFactory, type ExchangeConnector, type ExchangeName } from './exchangeConnector';
import { BinancePublicAdapter } from './binancePublicAdapter';

const db = () => admin.firestore(getFirebaseAdmin());

export interface ApiKeyDocument {
  id?: string;
  exchange: string;
  name: string;
  apiKeyEncrypted: string;
  apiSecretEncrypted: string;
  testnet: boolean;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

export interface SettingsDocument {
  id?: string;
  symbol: string;
  quoteSize: number;
  adversePct: number;
  cancelMs: number;
  maxPos: number;
  minAccuracyThreshold: number;
  autoTradeEnabled: boolean;
  strategy?: string; // 'orderbook_imbalance' | 'smc_hybrid' | 'stat_arb' (market_making_hft is handled by HFT engine)
  liveMode?: boolean; // Default false - requires explicit confirmation
  max_loss_pct?: number; // Max daily loss as percentage of balance
  max_drawdown_pct?: number; // Max drawdown as percentage
  per_trade_risk_pct?: number; // Risk per trade as percentage
  status?: string; // 'active' | 'paused_by_risk' | 'paused_manual'
  updatedAt: admin.firestore.Timestamp;
}

export interface ResearchLogDocument {
  id?: string;
  symbol: string;
  timestamp: admin.firestore.Timestamp;
  signal: 'BUY' | 'SELL' | 'HOLD';
  accuracy: number;
  orderbookImbalance: number;
  recommendedAction: string;
  microSignals: any;
  createdAt: admin.firestore.Timestamp;
}

export interface ExecutionLogDocument {
  id?: string;
  symbol: string;
  timestamp: admin.firestore.Timestamp;
  action: 'EXECUTED' | 'SKIPPED';
  reason?: string;
  accuracy?: number;
  accuracyUsed?: number; // The accuracy value used for decision
  orderId?: string;
  orderIds?: string[]; // Multiple order IDs for market making
  executionLatency?: number;
  slippage?: number;
  pnl?: number;
  strategy?: string;
  signal?: 'BUY' | 'SELL' | 'HOLD';
  status?: string; // Order status
  createdAt: admin.firestore.Timestamp;
}

export type IntegrationStatus = 'SAVED' | 'UNVERIFIED' | 'VERIFIED' | 'ERROR' | 'DISABLED';

export interface IntegrationDocument {
  enabled: boolean;
  apiKey?: string; // encrypted
  secretKey?: string; // encrypted (only for Binance)
  passphrase?: string; // encrypted
  apiType?: string; // For CoinAPI: 'market' | 'flatfile' | 'exchangerate'
  testnet?: boolean;
  exchangeName?: string;
  userId?: string;
  status?: IntegrationStatus;
  meta?: Record<string, any>;
  validationDetails?: Record<string, any>;
  lastValidatedAt?: admin.firestore.Timestamp;
  createdAt?: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

export interface ActiveExchangeContext {
  name: ExchangeName | 'fallback';
  apiKey?: string;
  secret?: string;
  passphrase?: string;
  testnet?: boolean;
  adapter: ExchangeConnector;
}

export interface HFTSettingsDocument {
  id?: string;
  symbol: string;
  quoteSize: number;
  adversePct: number;
  cancelMs: number;
  maxPos: number;
  minSpreadPct: number;
  maxTradesPerDay: number;
  enabled: boolean;
  updatedAt: admin.firestore.Timestamp;
}

export interface HFTExecutionLogDocument {
  id?: string;
  symbol: string;
  timestamp: admin.firestore.Timestamp;
  action: string; // 'BID_PLACED' | 'ASK_PLACED' | 'FILLED' | 'CANCELED'
  orderId?: string;
  orderIds?: string[];
  price?: number;
  quantity?: number;
  side?: 'BUY' | 'SELL';
  reason?: string;
  strategy: string;
  status?: string;
  createdAt: admin.firestore.Timestamp;
}

export class FirestoreAdapter {
  // API Keys
  async saveApiKey(uid: string, keyData: {
    exchange: string;
    name: string;
    apiKey: string;
    apiSecret: string;
    testnet: boolean;
  }): Promise<string> {
    const docRef = db().collection('users').doc(uid).collection('apikeys').doc();
    
    const doc: ApiKeyDocument = {
      exchange: keyData.exchange,
      name: keyData.name,
      apiKeyEncrypted: encrypt(keyData.apiKey),
      apiSecretEncrypted: encrypt(keyData.apiSecret),
      testnet: keyData.testnet,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    };

    await docRef.set(doc);
    logger.info({ uid, keyId: docRef.id }, 'API key saved to Firestore');
    return docRef.id;
  }

  async getApiKeys(uid: string): Promise<ApiKeyDocument[]> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('apikeys')
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as ApiKeyDocument));
  }

  async getApiKey(uid: string, keyId: string): Promise<ApiKeyDocument | null> {
    const doc = await db()
      .collection('users')
      .doc(uid)
      .collection('apikeys')
      .doc(keyId)
      .get();

    if (!doc.exists) return null;

    return {
      id: doc.id,
      ...doc.data(),
    } as ApiKeyDocument;
  }

  async updateApiKey(uid: string, keyId: string, updates: Partial<{
    name: string;
    apiKey: string;
    apiSecret: string;
    testnet: boolean;
  }>): Promise<void> {
    const updateData: any = {
      updatedAt: admin.firestore.Timestamp.now(),
    };

    if (updates.name) updateData.name = updates.name;
    if (updates.apiKey) updateData.apiKeyEncrypted = encrypt(updates.apiKey);
    if (updates.apiSecret) updateData.apiSecretEncrypted = encrypt(updates.apiSecret);
    if (updates.testnet !== undefined) updateData.testnet = updates.testnet;

    await db()
      .collection('users')
      .doc(uid)
      .collection('apikeys')
      .doc(keyId)
      .update(updateData);

    logger.info({ uid, keyId }, 'API key updated in Firestore');
  }

  async deleteApiKey(uid: string, keyId: string): Promise<void> {
    await db()
      .collection('users')
      .doc(uid)
      .collection('apikeys')
      .doc(keyId)
      .delete();

    logger.info({ uid, keyId }, 'API key deleted from Firestore');
  }

  async getLatestApiKey(uid: string, exchange: string): Promise<ApiKeyDocument | null> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('apikeys')
      .where('exchange', '==', exchange)
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    return {
      id: doc.id,
      ...doc.data(),
    } as ApiKeyDocument;
  }

  // Settings
  async saveSettings(uid: string, settings: Partial<SettingsDocument>): Promise<void> {
    const docRef = db().collection('users').doc(uid).collection('settings').doc('current');
    
    await docRef.set({
      ...settings,
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });

    logger.info({ uid }, 'Settings saved to Firestore');
  }

  async getSettings(uid: string): Promise<SettingsDocument | null> {
    const doc = await db()
      .collection('users')
      .doc(uid)
      .collection('settings')
      .doc('current')
      .get();

    if (!doc.exists) return null;

    return doc.data() as SettingsDocument;
  }

  // Research Logs
  async saveResearchLog(uid: string, research: Omit<ResearchLogDocument, 'id' | 'createdAt'>): Promise<string> {
    const docRef = db().collection('users').doc(uid).collection('researchLogs').doc();
    
    const doc: ResearchLogDocument = {
      ...research,
      createdAt: admin.firestore.Timestamp.now(),
    };

    await docRef.set(doc);
    logger.debug({ uid, symbol: research.symbol, accuracy: research.accuracy }, 'Research log saved');
    return docRef.id;
  }

  async getResearchLogs(uid: string, limit: number = 100): Promise<ResearchLogDocument[]> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('researchLogs')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as ResearchLogDocument));
  }

  // Execution Logs
  async saveExecutionLog(uid: string, execution: Omit<ExecutionLogDocument, 'id' | 'createdAt'>): Promise<string> {
    const docRef = db().collection('users').doc(uid).collection('executionLogs').doc();
    
    const doc: ExecutionLogDocument = {
      ...execution,
      createdAt: admin.firestore.Timestamp.now(),
    };

    await docRef.set(doc);
    logger.info({ uid, action: execution.action, symbol: execution.symbol }, 'Execution log saved');
    return docRef.id;
  }

  async getExecutionLogs(uid: string, limit: number = 100): Promise<ExecutionLogDocument[]> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('executionLogs')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as ExecutionLogDocument));
  }

  // Integrations
  async getIntegration(uid: string, apiName: string): Promise<IntegrationDocument | null> {
    const doc = await db()
      .collection('users')
      .doc(uid)
      .collection('integrations')
      .doc(apiName)
      .get();

    if (!doc.exists) return null;

    return doc.data() as IntegrationDocument;
  }

  async getAllIntegrations(uid: string): Promise<Record<string, IntegrationDocument>> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('integrations')
      .get();

    const integrations: Record<string, IntegrationDocument> = {};
    snapshot.docs.forEach((doc) => {
      integrations[doc.id] = doc.data() as IntegrationDocument;
    });

    return integrations;
  }

  async saveIntegration(uid: string, apiName: string, data: {
    enabled: boolean;
    apiKey?: string; // plain text, will be encrypted
    secretKey?: string; // plain text, will be encrypted (only for Binance)
    passphrase?: string; // plain text, will be encrypted (for Bitget, Weex, etc.)
    apiType?: string; // For CoinAPI type
    status?: IntegrationStatus;
    exchangeName?: string;
    meta?: Record<string, any>;
    userId?: string;
    lastValidatedAt?: admin.firestore.Timestamp;
    validationDetails?: Record<string, any>;
  }): Promise<{ path: string; data: any }> {
    const docRef = db()
      .collection('users')
      .doc(uid)
      .collection('integrations')
      .doc(apiName);

    // Check if document exists for idempotency
    const existingDoc = await docRef.get();
    const existingData = existingDoc.exists ? existingDoc.data() as IntegrationDocument : null;
    const now = admin.firestore.Timestamp.now();

    const docData: any = {
      enabled: data.enabled,
      updatedAt: now,
      userId: data.userId || uid,
      exchangeName: data.exchangeName || existingData?.exchangeName || apiName,
      status: data.status || existingData?.status || (data.enabled ? 'SAVED' : 'DISABLED'),
    };

    // Set createdAt only if document doesn't exist (required field)
    if (!existingDoc.exists) {
      docData.createdAt = now;
    } else if (data.enabled === false && existingDoc.exists && !existingDoc.data().createdAt) {
      // Patch: ensure createdAt exists on disables for legacy docs
      docData.createdAt = now;
    }

    if (data.meta) {
      docData.meta = data.meta;
    }

    if (data.validationDetails) {
      docData.validationDetails = data.validationDetails;
    }

    if (data.lastValidatedAt) {
      docData.lastValidatedAt = data.lastValidatedAt;
    }

    // Encrypt API keys safely
    try {
      if (data.apiKey) {
        docData.apiKey = encrypt(data.apiKey);
      }
      if (data.secretKey) {
        docData.secretKey = encrypt(data.secretKey);
      }
      if (data.passphrase) {
        docData.passphrase = encrypt(data.passphrase);
      }
    } catch (error: any) {
      logger.error({ error: error.message, uid, apiName }, 'Encryption failed during saveIntegration');
      throw new Error(`Encryption failed: ${error.message}`);
    }

    // Set apiType for CoinAPI integrations (required field)
    if (data.apiType) {
      docData.apiType = data.apiType;
    } else if (apiName.startsWith('coinapi_')) {
      // Extract apiType from docName if not provided (e.g., 'coinapi_market' -> 'market')
      docData.apiType = apiName.replace('coinapi_', '');
    }

    await docRef.set(docData, { merge: true });
    logger.info({ uid, apiName, enabled: data.enabled }, 'Saving integration');

    // Post-save verification: read back the document and verify all required fields
    const verification = await docRef.get();
    if (!verification.exists) {
      logger.error({ uid, apiName }, 'Post-save read failed - document missing');
      throw new Error('Post-save verification failed: document not found');
    }

    const savedData = verification.data() || {};
    
    // Verify all required fields are present
    const requiredFields = ['enabled', 'createdAt', 'updatedAt'];
    const missingFields = requiredFields.filter(field => savedData[field] === undefined);
    
    // For CoinAPI, apiType is also required
    if (apiName.startsWith('coinapi_') && !savedData.apiType) {
      missingFields.push('apiType');
    }
    
    if (missingFields.length > 0) {
      logger.error({ uid, apiName, missingFields }, '❌ Integration missing required fields after save');
      throw new Error(`Post-save verification failed: missing required fields: ${missingFields.join(', ')}`);
    }

    logger.info({ 
      uid, 
      path: `users/${uid}/integrations/${apiName}`,
      hasEnabled: savedData.enabled !== undefined,
      hasApiKey: savedData.apiKey !== undefined,
      hasSecretKey: savedData.secretKey !== undefined,
      hasApiType: savedData.apiType !== undefined,
      hasCreatedAt: !!savedData.createdAt,
      hasUpdatedAt: !!savedData.updatedAt,
    }, '✅ Integration verified with all required fields');

    return {
      path: `users/${uid}/integrations/${apiName}`,
      data: {
        enabled: savedData.enabled || false,
        hasKey: !!savedData.apiKey,
        hasSecret: !!savedData.secretKey,
        apiType: savedData.apiType || null,
        status: savedData.status || (savedData.enabled ? 'SAVED' : 'DISABLED'),
        updatedAt: savedData.updatedAt,
        createdAt: savedData.createdAt,
        exchangeName: savedData.exchangeName || apiName,
      },
    };
  }

  async deleteIntegration(uid: string, apiName: string): Promise<void> {
    await db()
      .collection('users')
      .doc(uid)
      .collection('integrations')
      .doc(apiName)
      .delete();

    logger.info({ uid, apiName }, 'Integration deleted from Firestore');
  }

  async getEnabledIntegrations(uid: string): Promise<Record<string, { apiKey: string; secretKey?: string }>> {
    const allIntegrations = await this.getAllIntegrations(uid);
    const enabled: Record<string, { apiKey: string; secretKey?: string }> = {};

    for (const [apiName, integration] of Object.entries(allIntegrations)) {
      if (integration.enabled && integration.apiKey) {
        const decryptedApiKey = decrypt(integration.apiKey);
        
        // Skip if decryption failed
        if (!decryptedApiKey) {
          logger.warn({ uid, apiName }, 'Failed to decrypt API key - skipping integration');
          continue;
        }
        
        enabled[apiName] = {
          apiKey: decryptedApiKey,
          ...(integration.secretKey ? { secretKey: decrypt(integration.secretKey) || '' } : {}),
        };
      }
    }

    return enabled;
  }

  /**
   * Returns { exchange, credentials } for the highest-priority enabled exchange for a user.
   * If none, returns { exchange: 'fallback' }
   */
  async getActiveExchangeForUser(uid: string): Promise<ActiveExchangeContext> {
    const integrations = await this.getAllIntegrations(uid);
    const priorities: ExchangeName[] = ['bitget', 'bingx', 'binance', 'weex', 'kucoin'];

    for (const exchangeName of priorities) {
      const config = integrations[exchangeName];
      if (!config || !config.enabled) continue;

      try {
        const apiKey = config.apiKey ? decrypt(config.apiKey) : '';
        const secretKey = config.secretKey ? decrypt(config.secretKey) : '';
        const passphrase = config.passphrase ? decrypt(config.passphrase) : undefined;

        if (!apiKey || !secretKey) {
          logger.warn({ uid, exchangeName }, 'Active exchange missing decrypted credentials');
          continue;
        }

        const adapter = ExchangeConnectorFactory.create(exchangeName, {
          apiKey,
          secret: secretKey,
          passphrase,
          testnet: config.testnet ?? false,
        });

        return { 
          name: exchangeName, 
          apiKey, 
          secret: secretKey, 
          passphrase, 
          testnet: config.testnet ?? false,
          adapter 
        };
      } catch (err: any) {
        logger.error({ uid, exchangeName, error: err.message }, 'Failed to instantiate exchange adapter');
        continue;
      }
    }

    return { name: 'fallback', adapter: new BinancePublicAdapter() };
  }

  // HFT Settings
  async saveHFTSettings(uid: string, settings: Partial<HFTSettingsDocument>): Promise<void> {
    const docRef = db().collection('users').doc(uid).collection('hftSettings').doc('current');
    
    await docRef.set({
      ...settings,
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });

    logger.info({ uid }, 'HFT settings saved to Firestore');
  }

  async getHFTSettings(uid: string): Promise<HFTSettingsDocument | null> {
    const doc = await db()
      .collection('users')
      .doc(uid)
      .collection('hftSettings')
      .doc('current')
      .get();

    if (!doc.exists) return null;

    return doc.data() as HFTSettingsDocument;
  }

  // HFT Execution Logs
  async saveHFTExecutionLog(uid: string, execution: Omit<HFTExecutionLogDocument, 'id' | 'createdAt'>): Promise<string> {
    const docRef = db().collection('users').doc(uid).collection('hftExecutionLogs').doc();
    
    const doc: HFTExecutionLogDocument = {
      ...execution,
      createdAt: admin.firestore.Timestamp.now(),
    };

    await docRef.set(doc);
    logger.info({ uid, action: execution.action, symbol: execution.symbol }, 'HFT execution log saved');
    return docRef.id;
  }

  async getHFTExecutionLogs(uid: string, limit: number = 100): Promise<HFTExecutionLogDocument[]> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('hftExecutionLogs')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as HFTExecutionLogDocument));
  }

  // Agent Management
  async unlockAgent(uid: string, agentName: string, agentId?: string, metadata?: any): Promise<void> {
    const docRef = db().collection('users').doc(uid).collection('agents').doc(agentName);
    
    await docRef.set({
      unlocked: true,
      agentId: agentId || agentName,
      agentName,
      unlockedAt: admin.firestore.Timestamp.now(),
      status: 'active',
      settings: {},
      ...metadata,
    }, { merge: true });

    // Also update user's unlockedAgents array
    const userData = await this.getUser(uid);
    const currentUnlocked = userData?.unlockedAgents || [];
    if (!currentUnlocked.includes(agentName)) {
      await this.createOrUpdateUser(uid, {
        unlockedAgents: [...currentUnlocked, agentName],
      });
    }

    logger.info({ uid, agentName, agentId }, 'Agent unlocked');
  }

  async lockAgent(uid: string, agentName: string): Promise<void> {
    const docRef = db().collection('users').doc(uid).collection('agents').doc(agentName);
    
    await docRef.set({
      unlocked: false,
      status: 'inactive',
      lockedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });

    // Remove from user's unlockedAgents array
    const userData = await this.getUser(uid);
    const currentUnlocked = userData?.unlockedAgents || [];
    const updatedUnlocked = currentUnlocked.filter((name: string) => name !== agentName);
    await this.createOrUpdateUser(uid, {
      unlockedAgents: updatedUnlocked,
    });

    logger.info({ uid, agentName }, 'Agent locked');
  }

  async getUserUnlockedAgents(uid: string): Promise<Array<{ agentId: string; agentName: string; unlockedAt: admin.firestore.Timestamp; status: string; settings: any }>> {
    try {
      const snapshot = await db()
        .collection('users')
        .doc(uid)
        .collection('agents')
        .where('unlocked', '==', true)
        .get();
      
      return snapshot.docs.map((doc) => ({
        agentId: doc.data().agentId || doc.id,
        agentName: doc.data().agentName || doc.id,
        unlockedAt: doc.data().unlockedAt,
        status: doc.data().status || 'active',
        settings: doc.data().settings || {},
      }));
    } catch (err: any) {
      logger.warn({ err: err.message }, 'getUserUnlockedAgents error');
      return [];
    }
  }

  async updateAgentSettings(uid: string, agentName: string, settings: any): Promise<void> {
    const docRef = db().collection('users').doc(uid).collection('agents').doc(agentName);
    await docRef.set({
      settings,
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });
    logger.info({ uid, agentName }, 'Agent settings updated');
  }

  async getAgentStatus(uid: string, agentName: string): Promise<{ unlocked: boolean; unlockedAt?: admin.firestore.Timestamp } | null> {
    const doc = await db()
      .collection('users')
      .doc(uid)
      .collection('agents')
      .doc(agentName)
      .get();

    if (!doc.exists) return null;

    const data = doc.data();
    return {
      unlocked: data?.unlocked || false,
      unlockedAt: data?.unlockedAt,
    };
  }

  async getAllUserAgents(uid: string): Promise<Record<string, { unlocked: boolean; unlockedAt?: admin.firestore.Timestamp }>> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('agents')
      .get();

    const agents: Record<string, { unlocked: boolean; unlockedAt?: admin.firestore.Timestamp }> = {};
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      agents[doc.id] = {
        unlocked: data?.unlocked || false,
        unlockedAt: data?.unlockedAt,
      };
    });

    return agents;
  }

  // User Profile Management
  async getUserProfile(uid: string): Promise<{ role?: string; email?: string; [key: string]: any } | null> {
    const doc = await db().collection('users').doc(uid).get();
    if (!doc.exists) return null;
    
    const data = doc.data();
    return data?.profile || {};
  }

  async getAllUsers(): Promise<Array<{ uid: string; email?: string; role?: string; createdAt?: admin.firestore.Timestamp }>> {
    const snapshot = await db().collection('users').get();
    
    return snapshot.docs.map((doc) => {
      const data = doc.data();
      const profile = data?.profile || {};
      return {
        uid: doc.id,
        email: profile.email || data?.email,
        role: profile.role,
        createdAt: data?.createdAt || profile.createdAt,
      };
    });
  }

  // ========== USERS COLLECTION METHODS ==========
  async createOrUpdateUser(uid: string, userData: {
    name?: string;
    email?: string;
    phone?: string;
    plan?: string;
    apiConnected?: boolean;
    isApiConnected?: boolean;
    autoTradeEnabled?: boolean;
    connectedExchanges?: string[];
    unlockedAgents?: string[];
    profilePicture?: string;
    hftStatus?: string;
    engineStatus?: string;
    totalPnL?: number;
    totalTrades?: number;
    settings?: any;
  }): Promise<void> {
    const userRef = db().collection('users').doc(uid);
    const existing = await userRef.get();
    
    const updateData: any = {
      ...userData,
      updatedAt: admin.firestore.Timestamp.now(),
    };

    if (!existing.exists) {
      updateData.uid = uid;
      updateData.createdAt = admin.firestore.Timestamp.now();
    }

    await userRef.set(updateData, { merge: true });
    logger.info({ uid }, 'User created/updated in users collection');
  }

  async getUser(uid: string): Promise<any | null> {
    const doc = await db().collection('users').doc(uid).get();
    if (!doc.exists) return null;
    return { uid: doc.id, ...doc.data() };
  }

  // ========== AGENTS COLLECTION METHODS ==========
  async getAllAgents(): Promise<Array<{ id: string; name: string; price: number; features: string[]; [key: string]: any }>> {
    const snapshot = await db().collection('agents').get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any));
  }

  async getAgent(agentId: string): Promise<any | null> {
    const doc = await db().collection('agents').doc(agentId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }

  // ========== AGENT UNLOCKS COLLECTION METHODS ==========
  async createAgentUnlock(uid: string, agentName: string, metadata?: any): Promise<void> {
    const unlockRef = db().collection('agentUnlocks').doc();
    await unlockRef.set({
      uid,
      agentName,
      unlockedAt: admin.firestore.Timestamp.now(),
      ...metadata,
    });
    logger.info({ uid, agentName }, 'Agent unlock recorded');
  }

  async getUserAgentUnlocks(uid: string): Promise<any[]> {
    try {
      const snapshot = await db()
        .collection('agentUnlocks')
        .where('uid', '==', uid)
        .orderBy('unlockedAt', 'desc')
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    } catch (err: any) {
      logger.warn({ err: err.message }, 'getUserAgentUnlocks fell back due to index; returning unordered');
      const snapshot = await db()
        .collection('agentUnlocks')
        .where('uid', '==', uid)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }
  }

  // ========== API KEYS COLLECTION METHODS (top-level) ==========
  async saveApiKeyToCollection(uid: string, keyData: {
    publicKey: string;
    secretKey: string; // will be encrypted
    exchange?: string;
  }): Promise<string> {
    const docRef = db().collection('apiKeys').doc();
    const { encrypt } = await import('./keyManager');
    
    await docRef.set({
      uid,
      publicKey: keyData.publicKey,
      secretKeyEncrypted: encrypt(keyData.secretKey),
      exchange: keyData.exchange || 'binance',
      createdAt: admin.firestore.Timestamp.now(),
    });
    
    logger.info({ uid, keyId: docRef.id }, 'API key saved to apiKeys collection');
    return docRef.id;
  }

  async getUserApiKeys(uid: string): Promise<any[]> {
    const snapshot = await db()
      .collection('apiKeys')
      .where('uid', '==', uid)
      .orderBy('createdAt', 'desc')
      .get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  // ========== EXCHANGE CONFIG METHODS ==========
  async saveExchangeConfig(uid: string, data: {
    exchange: string;
    apiKey: string;
    secret: string;
    passphrase?: string;
    testnet?: boolean;
  }): Promise<{ path: string; data: any }> {
    const docRef = db()
      .collection('users')
      .doc(uid)
      .collection('exchangeConfig')
      .doc('current');

    // Check if document exists for idempotency
    const existingDoc = await docRef.get();
    const now = admin.firestore.Timestamp.now();

    // Encrypt credentials safely
    let apiKeyEncrypted: string;
    let secretEncrypted: string;
    let passphraseEncrypted: string = '';

    try {
      apiKeyEncrypted = encrypt(data.apiKey);
      secretEncrypted = encrypt(data.secret);
      if (data.passphrase) {
        passphraseEncrypted = encrypt(data.passphrase);
      }
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Encryption failed during saveExchangeConfig');
      throw new Error(`Encryption failed: ${error.message}`);
    }

    const configData: any = {
      exchange: data.exchange,
      apiKeyEncrypted,
      secretEncrypted,
      passphraseEncrypted,
      testnet: data.testnet || false,
      enabled: true,
      updatedAt: now,
    };

    // Set createdAt only if document doesn't exist
    if (!existingDoc.exists) {
      configData.createdAt = now;
    }

    await docRef.set(configData, { merge: true });
    logger.info({ uid, exchange: data.exchange }, 'Saving exchange config');

    // Post-save verification: read back the document and verify all required fields
    const verification = await docRef.get();
    if (!verification.exists) {
      logger.error({ uid }, 'Post-save read failed - document missing');
      throw new Error('Post-save verification failed: document not found');
    }

    const savedData = verification.data() || {};
    
    // Verify all required fields are present
    const requiredFields = ['exchange', 'apiKeyEncrypted', 'secretEncrypted', 'passphraseEncrypted', 'testnet', 'enabled', 'createdAt', 'updatedAt'];
    const missingFields = requiredFields.filter(field => savedData[field] === undefined);
    
    if (missingFields.length > 0) {
      logger.error({ uid, missingFields }, '❌ Exchange config missing required fields after save');
      throw new Error(`Post-save verification failed: missing required fields: ${missingFields.join(', ')}`);
    }

    logger.info({ 
      uid, 
      path: `users/${uid}/exchangeConfig/current`,
      hasExchange: savedData.exchange !== undefined,
      hasApiKeyEncrypted: savedData.apiKeyEncrypted !== undefined,
      hasSecretEncrypted: savedData.secretEncrypted !== undefined,
      hasPassphraseEncrypted: savedData.passphraseEncrypted !== undefined,
      hasTestnet: savedData.testnet !== undefined,
      hasEnabled: savedData.enabled !== undefined,
      hasCreatedAt: !!savedData.createdAt,
      hasUpdatedAt: !!savedData.updatedAt,
    }, '✅ Exchange config verified with all required fields');

    // Update user document's apiConnected status
    try {
      await db().collection('users').doc(uid).set({
        apiConnected: true,
        apiStatus: 'connected',
        connectedExchanges: admin.firestore.FieldValue.arrayUnion(data.exchange),
        updatedAt: now,
      }, { merge: true });
      logger.info({ uid, exchange: data.exchange }, 'Updated user apiConnected status');
    } catch (userUpdateErr: any) {
      logger.warn({ err: userUpdateErr, uid }, 'Failed to update user apiConnected status (non-critical)');
    }

    return {
      path: `users/${uid}/exchangeConfig/current`,
      data: {
        exchange: savedData.exchange || '',
        hasKey: !!savedData.apiKeyEncrypted,
        hasSecret: !!savedData.secretEncrypted,
        hasPassphrase: !!savedData.passphraseEncrypted,
        testnet: savedData.testnet || false,
        enabled: savedData.enabled || false,
        updatedAt: savedData.updatedAt,
        createdAt: savedData.createdAt,
      },
    };
  }

  // ========== ERROR LOGGING METHODS ==========
  async logError(errorId: string, error: {
    uid?: string;
    path?: string;
    message: string;
    error: string;
    stack?: string;
    metadata?: any;
  }): Promise<void> {
    const errorRef = db().collection('admin').doc('errors').collection('errors').doc(errorId);
    await errorRef.set({
      ...error,
      timestamp: admin.firestore.Timestamp.now(),
      errorId,
    });
    logger.error({ errorId, ...error }, 'Error logged to admin/errors');
  }

  // ========== ACTIVITY LOGS COLLECTION METHODS ==========
  async logActivity(uid: string, type: string, metadata?: any): Promise<void> {
    const logRef = db().collection('activityLogs').doc();
    await logRef.set({
      uid,
      type,
      message: metadata?.message || `Activity: ${type}`,
      metadata: metadata || {},
      timestamp: admin.firestore.Timestamp.now(),
    });
    logger.debug({ uid, type }, 'Activity logged');
  }

  async getActivityLogs(uid?: string, limit: number = 100): Promise<any[]> {
    let query: admin.firestore.Query = db().collection('activityLogs');
    
    if (uid) {
      query = query.where('uid', '==', uid);
    }
    
    const snapshot = await query
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate().toISOString(),
    }));
  }

  // ========== ENGINE STATUS COLLECTION METHODS ==========
  async saveEngineStatus(uid: string, status: {
    active: boolean;
    engineType?: 'auto' | 'hft';
    symbol?: string;
    config?: any;
  }): Promise<void> {
    const statusRef = db().collection('engineStatus').doc(uid);
    await statusRef.set({
      uid,
      ...status,
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });
    logger.debug({ uid, active: status.active }, 'Engine status saved');
  }

  async getEngineStatus(uid: string): Promise<any | null> {
    const doc = await db().collection('engineStatus').doc(uid).get();
    if (!doc.exists) return null;
    return { uid: doc.id, ...doc.data() };
  }

  async getAllEngineStatuses(): Promise<any[]> {
    const snapshot = await db().collection('engineStatus').get();
    return snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
  }

  // ========== HFT LOGS COLLECTION METHODS ==========
  async saveHFTLog(uid: string, logData: {
    symbol: string;
    action: string;
    orderId?: string;
    price?: number;
    quantity?: number;
    side?: 'BUY' | 'SELL';
    pnl?: number;
    metadata?: any;
  }): Promise<void> {
    const logRef = db().collection('hftLogs').doc();
    await logRef.set({
      uid,
      ...logData,
      timestamp: admin.firestore.Timestamp.now(),
    });
    logger.debug({ uid, action: logData.action }, 'HFT log saved');
  }

  async getHFTLogs(uid?: string, limit: number = 100): Promise<any[]> {
    let query: admin.firestore.Query = db().collection('hftLogs');
    
    if (uid) {
      query = query.where('uid', '==', uid);
    }
    
    const snapshot = await query
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate().toISOString(),
    }));
  }

  // ========== TRADES COLLECTION METHODS ==========
  async saveTrade(uid: string, tradeData: {
    symbol: string;
    side: 'BUY' | 'SELL' | 'buy' | 'sell';
    qty: number;
    entryPrice: number;
    exitPrice?: number;
    pnl?: number;
    timestamp?: admin.firestore.Timestamp;
    engineType: 'AI' | 'HFT' | 'Manual' | 'auto';
    orderId?: string;
    metadata?: any;
  }): Promise<string> {
    const tradeRef = db().collection('trades').doc();
    const side = tradeData.side.toLowerCase() as 'buy' | 'sell';
    await tradeRef.set({
      uid,
      symbol: tradeData.symbol,
      side,
      qty: tradeData.qty,
      entryPrice: tradeData.entryPrice,
      exitPrice: tradeData.exitPrice,
      pnl: tradeData.pnl,
      timestamp: tradeData.timestamp || admin.firestore.Timestamp.now(),
      engineType: tradeData.engineType,
      ...(tradeData.orderId && { orderId: tradeData.orderId }),
      ...(tradeData.metadata && { metadata: tradeData.metadata }),
    });
    logger.info({ uid, symbol: tradeData.symbol, side }, 'Trade saved');
    return tradeRef.id;
  }

  async getTrades(uid?: string, limit: number = 100): Promise<any[]> {
    try {
      let query: admin.firestore.Query = db().collection('trades');
      if (uid) {
        query = query.where('uid', '==', uid);
      }
      const snapshot = await query
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate().toISOString(),
      }));
    } catch (err: any) {
      logger.warn({ err: err.message }, 'getTrades fell back due to index; returning unordered limited set');
      let query: admin.firestore.Query = db().collection('trades');
      if (uid) {
        query = query.where('uid', '==', uid);
      }
      const snapshot = await query.limit(limit).get();
      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate().toISOString(),
      }));
    }
  }

  // ========== NOTIFICATIONS COLLECTION METHODS ==========
  async createNotification(uid: string, notification: {
    title: string;
    message: string;
    type?: string;
    metadata?: any;
  }): Promise<string> {
    const notifRef = db().collection('notifications').doc();
    await notifRef.set({
      uid,
      ...notification,
      read: false,
      timestamp: admin.firestore.Timestamp.now(),
    });
    logger.debug({ uid, title: notification.title }, 'Notification created');
    return notifRef.id;
  }

  async getUserNotifications(uid: string, limit: number = 50): Promise<any[]> {
    const snapshot = await db()
      .collection('notifications')
      .where('uid', '==', uid)
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate().toISOString(),
    }));
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    await db().collection('notifications').doc(notificationId).update({
      read: true,
      readAt: admin.firestore.Timestamp.now(),
    });
  }

  async getUnreadNotificationCount(uid: string): Promise<number> {
    const snapshot = await db()
      .collection('notifications')
      .where('uid', '==', uid)
      .where('read', '==', false)
      .get();
    return snapshot.size;
  }

  // ========== ADMIN COLLECTION METHODS ==========
  async createAdmin(uid: string, adminData: {
    email: string;
    permissions?: string[];
    role?: string;
  }): Promise<void> {
    const adminRef = db().collection('admin').doc(uid);
    await adminRef.set({
      uid,
      ...adminData,
      createdAt: admin.firestore.Timestamp.now(),
    });
    logger.info({ uid, email: adminData.email }, 'Admin created');
  }

  async getAdmin(uid: string): Promise<any | null> {
    const doc = await db().collection('admin').doc(uid).get();
    if (!doc.exists) return null;
    return { uid: doc.id, ...doc.data() };
  }

  async isAdmin(uid: string): Promise<boolean> {
    const userDoc = await db().collection('users').doc(uid).get();
    if (!userDoc.exists) return false;
    const data: any = userDoc.data() || {};
    return data.role === 'admin' || data.isAdmin === true;
  }

  async getAllAdmins(): Promise<any[]> {
    const snapshot = await db().collection('admin').get();
    return snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
  }

  // ========== SETTINGS COLLECTION METHODS (global) ==========
  async getGlobalSettings(): Promise<any | null> {
    const doc = await db().collection('settings').doc('global').get();
    if (!doc.exists) return null;
    return doc.data();
  }

  async updateGlobalSettings(settings: {
    maintenanceMode?: boolean;
    exchangeExecution?: boolean;
    hftMode?: boolean;
    riskThresholds?: any;
    uiThemeDefaults?: any;
    [key: string]: any;
  }): Promise<void> {
    const settingsRef = db().collection('settings').doc('global');
    await settingsRef.set({
      ...settings,
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });
    logger.info('Global settings updated');
  }

  // ========== LOGS COLLECTION METHODS (system logs) ==========
  async saveSystemLog(logData: {
    type: string;
    message: string;
    level?: 'info' | 'warn' | 'error';
    metadata?: any;
  }): Promise<void> {
    const logRef = db().collection('logs').doc();
    await logRef.set({
      ...logData,
      timestamp: admin.firestore.Timestamp.now(),
    });
    logger.debug({ type: logData.type }, 'System log saved');
  }

  async getSystemLogs(limit: number = 100): Promise<any[]> {
    const snapshot = await db()
      .collection('logs')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate().toISOString(),
    }));
  }

  // ========== UI PREFERENCES COLLECTION METHODS ==========
  async getUserUIPreferences(uid: string): Promise<any | null> {
    const doc = await db().collection('uiPreferences').doc(uid).get();
    if (!doc.exists) return null;
    return { uid: doc.id, ...doc.data() };
  }

  async updateUIPreferences(uid: string, preferences: {
    dismissedAgents?: string[];
    hideDashboardCard?: string[];
    theme?: 'light' | 'dark';
    sidebarPinned?: boolean;
    [key: string]: any;
  }): Promise<void> {
    const prefsRef = db().collection('uiPreferences').doc(uid);
    await prefsRef.set({
      uid,
      ...preferences,
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });
    logger.debug({ uid }, 'UI preferences updated');
  }

  // ========== GLOBAL STATS COLLECTION METHODS ==========
  async getGlobalStats(): Promise<any | null> {
    // PART A: Use 'main' as doc ID
    const doc = await db().collection('globalStats').doc('main').get();
    if (!doc.exists) return null;
    return doc.data();
  }

  async updateGlobalStats(stats: {
    totalUsers?: number;
    totalTrades?: number;
    totalAgentsUnlocked?: number;
    runningEngines?: number;
    runningHFT?: number;
    totalPnl?: number;
    [key: string]: any;
  }): Promise<void> {
    // PART A: Use 'main' as doc ID
    const statsRef = db().collection('globalStats').doc('main');
    await statsRef.set({
      ...stats,
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });
    logger.debug('Global stats updated');
  }
}

export const firestoreAdapter = new FirestoreAdapter();

