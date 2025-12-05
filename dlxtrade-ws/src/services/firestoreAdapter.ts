import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';
import { logger } from '../utils/logger';
import { encrypt, decrypt, maskKey } from './keyManager';

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
  // Provider configuration
  providerConfig?: {
    marketData: string[];
    news: string[];
    metadata: string[];
  };
  // Trading settings
  tradingSettings?: {
    mode: 'MANUAL' | 'TOP_100' | 'TOP_10';
    manualCoins: string[];
    maxPositionPerTrade: number;
    tradeType: 'Scalping' | 'Swing' | 'Position';
    accuracyTrigger: number;
    maxDailyLoss: number;
    maxTradesPerDay: number;
    positionSizingMap: Array<{
      min: number;
      max: number;
      percent: number;
    }>;
  };
  // Notification settings
  notificationSettings?: {
    enableAutoTradeAlerts: boolean;
    enableAccuracyAlerts: boolean;
    enableWhaleAlerts: boolean;
    tradeConfirmationRequired: boolean;
    notificationSounds: boolean;
    notificationVibration: boolean;
    telegramBotToken?: string;
    telegramChatId?: string;
  };
  // Legacy notification settings (keeping for backward compatibility)
  enableAutoTradeAlerts?: boolean;
  enableAccuracyAlerts?: boolean;
  enableWhaleAlerts?: boolean;
  tradeConfirmationRequired?: boolean;
  notificationSounds?: boolean;
  notificationVibration?: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
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

export interface IntegrationDocument {
  enabled: boolean;
  apiKey?: string; // encrypted
  secretKey?: string; // encrypted (only for Binance)
  apiType?: string; // For CoinAPI: 'market' | 'flatfile' | 'exchangerate'
  backupApis?: Array<{
    name: string;
    apiKey: string; // encrypted
    endpoint?: string;
    active: boolean;
    createdAt: admin.firestore.Timestamp;
  }>;
  updatedAt: admin.firestore.Timestamp;
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

export interface TradingSettingsDocument {
  symbol: string;
  maxPositionPerTrade: number;
  tradeType: 'Scalping' | 'Swing' | 'Position';
  accuracyTrigger: number;
  maxDailyLoss: number;
  maxTradesPerDay: number;
  positionSizingMap: Array<{
    min: number;
    max: number;
    percent: number;
  }>;
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
  // Warm start function to pre-load Firestore cache at startup
  async warmStart(): Promise<void> {
    try {
      logger.info('Starting Firestore cache warm-up...');

      // Touch agents collection
      await db().collection('agents').limit(1).get();

      // Touch a sample user document to warm settings and notifications
      // We'll use a dummy query that should be fast
      const sampleQuery = await db().collection('users').limit(1).get();
      if (!sampleQuery.empty) {
        const sampleUid = sampleQuery.docs[0].id;

        // Touch settings subcollection
        await db().collection('users').doc(sampleUid).collection('settings').limit(1).get();

        // Touch notifications subcollection
        await db().collection('notifications').doc(sampleUid).collection('items').limit(1).get();
      }

      logger.info('Firestore cache warm-up completed');
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Firestore cache warm-up failed, continuing...');
    }
  }

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
    // Get logs from both researchLogs collection (scheduled research) and old research collection
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
    apiType?: string; // For CoinAPI type
  }): Promise<void> {
    const docRef = db()
      .collection('users')
      .doc(uid)
      .collection('integrations')
      .doc(apiName);

    // Check if document exists to determine if we should set createdAt
    const existingDoc = await docRef.get();
    const now = admin.firestore.Timestamp.now();

    const docData: IntegrationDocument = {
      enabled: data.enabled,
      updatedAt: now,
    };

    // Add createdAt only if document doesn't exist
    if (!existingDoc.exists) {
      (docData as any).createdAt = now;
    }

    if (data.apiKey) {
      docData.apiKey = encrypt(data.apiKey);
    }
    if (data.secretKey) {
      docData.secretKey = encrypt(data.secretKey);
    }
    if (data.apiType) {
      docData.apiType = data.apiType;
    }

    await docRef.set(docData, { merge: true });
    logger.info({ 
      uid, 
      apiName, 
      enabled: data.enabled,
      hasApiKey: !!data.apiKey,
      hasSecretKey: !!data.secretKey,
      hasCreatedAt: !existingDoc.exists 
    }, 'Integration saved to Firestore');
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
        try {
          const decryptedApiKey = decrypt(integration.apiKey);
          const decryptedSecretKey = integration.secretKey ? decrypt(integration.secretKey) : undefined;

          // Only include integrations with valid (non-empty) decrypted keys
          if (decryptedApiKey && decryptedApiKey.trim() !== '') {
            enabled[apiName] = {
              apiKey: decryptedApiKey,
              ...(decryptedSecretKey && decryptedSecretKey.trim() !== '' ? { secretKey: decryptedSecretKey } : {}),
            };
          } else {
            logger.warn({ uid, apiName }, 'Skipping integration with invalid/empty decrypted API key');
          }
        } catch (error: any) {
          logger.error({ error: error.message, uid, apiName }, 'Failed to decrypt integration keys, skipping');
          // Continue to next integration instead of breaking the entire operation
        }
      }
    }

    return enabled;
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
  async unlockAgent(uid: string, agentName: string): Promise<void> {
    const docRef = db().collection('users').doc(uid).collection('agents').doc(agentName);
    
    await docRef.set({
      unlocked: true,
      unlockedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });

    logger.info({ uid, agentName }, 'Agent unlocked');
  }

  async lockAgent(uid: string, agentName: string): Promise<void> {
    const docRef = db().collection('users').doc(uid).collection('agents').doc(agentName);
    
    await docRef.set({
      unlocked: false,
      unlockedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });

    logger.info({ uid, agentName }, 'Agent locked');
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

  // Optimized method to get user's unlocked agents in single operation
  async getUserUnlockedAgents(uid: string): Promise<string[]> {
    try {
      // Get user data and unlocks in parallel for better performance
      const [userDoc, unlocksSnapshot] = await Promise.all([
        db().collection('users').doc(uid).get(),
        db().collection('agentUnlocks').where('uid', '==', uid).get()
      ]);

      const userData = userDoc.exists ? userDoc.data() : {};
      const unlockedAgents = userData?.unlockedAgents || [];
      const unlockNames = unlocksSnapshot.docs.map(doc => doc.data().agentName);

      // Combine and deduplicate
      return [...new Set([...unlockedAgents, ...unlockNames])];
    } catch (err: any) {
      logger.warn({ err: err.message }, 'getUserUnlockedAgents failed, falling back to individual calls');
      // Fallback to original method
      const userData = await this.getUser(uid);
      const unlockedAgents = userData?.unlockedAgents || [];
      const unlocks = await this.getUserAgentUnlocks(uid);
      const unlockNames = unlocks.map(u => u.agentName);
      return [...new Set([...unlockedAgents, ...unlockNames])];
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

  // ========== BACKGROUND RESEARCH SETTINGS METHODS ==========
  async saveBackgroundResearchSettings(uid: string, settings: {
    backgroundResearchEnabled: boolean;
    telegramBotToken?: string;
    telegramChatId?: string;
    researchFrequencyMinutes: number;
    accuracyTrigger: number;
    lastResearchRun: admin.firestore.Timestamp | null;
  }): Promise<void> {
    const docRef = db().collection('users').doc(uid).collection('settings').doc('backgroundResearch');
    await docRef.set({
      ...settings,
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });
    logger.info({ uid }, 'Background research settings saved to Firestore');
  }

  async getBackgroundResearchSettings(uid: string): Promise<any | null> {
    const doc = await db()
      .collection('users')
      .doc(uid)
      .collection('settings')
      .doc('backgroundResearch')
      .get();
    if (!doc.exists) return null;
    return doc.data();
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

  // Optimized method for notifications subcollection structure used in routes
  async getUserNotificationsFromSubcollection(uid: string, limit: number = 50): Promise<any[]> {
    try {
      // Try new subcollection path first (notifications/{uid}/items)
      const snapshot = await db()
        .collection('notifications')
        .doc(uid)
        .collection('items')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate?.()?.toISOString() || new Date().toISOString(),
      }));
    } catch (err: any) {
      // Fallback to old path (users/{uid}/notifications)
      const snapshot = await db()
        .collection('users')
        .doc(uid)
        .collection('notifications')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate?.()?.toISOString() || new Date().toISOString(),
      }));
    }
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

  // ========== API USAGE TRACKING METHODS ==========
  async getApiUsage(userId: string): Promise<any | null> {
    try {
      const doc = await db().collection('apiUsage').doc(userId).get();
      if (!doc.exists) return null;
      return { userId: doc.id, ...doc.data() };
    } catch (error: any) {
      logger.error({ error: error.message, userId }, 'Failed to get API usage');
      return null;
    }
  }

  async saveApiUsage(userId: string, usage: any): Promise<void> {
    try {
      const usageRef = db().collection('apiUsage').doc(userId);
      await usageRef.set({
        ...usage,
        updatedAt: admin.firestore.Timestamp.now(),
      });
      logger.debug({ userId }, 'API usage saved');
    } catch (error: any) {
      logger.error({ error: error.message, userId }, 'Failed to save API usage');
      throw error;
    }
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

  // ========== AUTO-TRADE SPECIFIC METHODS ==========
  async getActiveTrades(uid: string, limit: number = 50): Promise<any[]> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('autoTradeActiveTrades')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
  }

  async getAutoTradeActivity(uid: string, limit: number = 50): Promise<any[]> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('autoTradeActivity')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
  }

  async getTradeProposals(uid: string): Promise<any[]> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('autoTradeProposals')
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
  }

  async getAutoTradeLogs(uid: string, limit: number = 100): Promise<any[]> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('autoTradeLogs')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
  }

  // ========== TRADING SETTINGS METHODS ==========
  async getTradingSettings(uid: string): Promise<any> {
    try {
      const doc = await db()
        .collection('users')
        .doc(uid)
        .collection('settings')
        .doc('trading')
        .get();

      if (!doc.exists) {
        return null;
      }

      const data = doc.data();
      return {
        ...data,
        updatedAt: data?.updatedAt?.toDate().toISOString(),
      };
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error getting trading settings');
      throw error;
    }
  }

  async saveTradingSettings(uid: string, settings: any): Promise<any> {
    try {
      const settingsDoc = {
        ...settings,
        updatedAt: admin.firestore.Timestamp.now(),
      };

      await db()
        .collection('users')
        .doc(uid)
        .collection('settings')
        .doc('trading')
        .set(settingsDoc, { merge: true });

      logger.info({ uid, settings }, 'Trading settings saved');
      return settings;
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error saving trading settings');
      throw error;
    }
  }

  /**
   * Save prediction snapshot for accuracy tracking
   */
  async savePredictionMetrics(uid: string, snapshotData: any): Promise<void> {
    try {
      const docRef = db().collection('users').doc(uid).collection('predictions').doc();
      await docRef.set({
        ...snapshotData,
        id: docRef.id
      });
      logger.debug({ uid, predictionId: docRef.id }, 'Prediction snapshot saved');
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error saving prediction snapshot');
      throw error;
    }
  }

  /**
   * Get prediction snapshot by requestId
   */
  async getPredictionSnapshot(requestId: string): Promise<any> {
    try {
      // Search across all users (simplified - in production you'd want better indexing)
      const usersRef = db().collection('users');
      const usersSnapshot = await usersRef.listDocuments();

      for (const userRef of usersSnapshot) {
        const predictionRef = userRef.collection('predictions').where('requestId', '==', requestId);
        const predictionSnapshot = await predictionRef.get();

        if (!predictionSnapshot.empty) {
          const doc = predictionSnapshot.docs[0];
          return { ...doc.data(), id: doc.id };
        }
      }

      return null;
    } catch (error: any) {
      logger.error({ error: error.message, requestId }, 'Error getting prediction snapshot');
      throw error;
    }
  }

  /**
   * Update prediction outcome
   */
  async updatePredictionOutcome(requestId: string, outcome: any): Promise<void> {
    try {
      // Find and update the prediction document
      const snapshot = await this.getPredictionSnapshot(requestId);
      if (snapshot) {
        const userRef = db().collection('users').doc(snapshot.userId);
        await userRef.collection('predictions').doc(snapshot.id).update({
          outcome,
          completedAt: new Date()
        });
      }
      logger.debug({ requestId }, 'Prediction outcome updated');
    } catch (error: any) {
      logger.error({ error: error.message, requestId }, 'Error updating prediction outcome');
      throw error;
    }
  }

  /**
   * Update accuracy calibration buckets
   */
  async updateAccuracyCalibration(uid: string, bucketKey: number, win: boolean): Promise<void> {
    try {
      const calibrationRef = db().collection('users').doc(uid).collection('calibration').doc('accuracy');
      const calibrationDoc = await calibrationRef.get();
      const currentData = calibrationDoc.exists ? calibrationDoc.data() || {} : {};

      // Initialize bucket if it doesn't exist
      if (!currentData[bucketKey]) {
        currentData[bucketKey] = { total: 0, wins: 0 };
      }

      // Update bucket stats
      currentData[bucketKey].total += 1;
      if (win) currentData[bucketKey].wins += 1;

      await calibrationRef.set(currentData);
      logger.debug({ uid, bucketKey, win }, 'Accuracy calibration updated');
    } catch (error: any) {
      logger.error({ error: error.message, uid, bucketKey }, 'Error updating accuracy calibration');
      throw error;
    }
  }

  /**
   * Get accuracy history and calibration stats
   */
  async getAccuracyHistory(uid: string, filters: { strategy?: string; symbol?: string; limit?: number }): Promise<any> {
    try {
      let query: any = db().collection('users').doc(uid).collection('predictions');

      if (filters.symbol) {
        query = query.where('symbol', '==', filters.symbol);
      }

      if (filters.strategy) {
        query = query.where('strategy', '==', filters.strategy);
      }

      query = query.orderBy('timestamp', 'desc').limit(filters.limit || 100);

      const snapshot = await query.get();
      const predictions = snapshot.docs.map((doc: any) => ({ ...doc.data(), id: doc.id }));

      // Get calibration data
      const calibrationRef = db().collection('users').doc(uid).collection('calibration').doc('accuracy');
      const calibrationDoc = await calibrationRef.get();
      const calibrationData = calibrationDoc.exists ? calibrationDoc.data() || {} : {};

      // Calculate rolling accuracy
      const totalPredictions = predictions.length;
      const winningPredictions = predictions.filter((p: any) => p.outcome?.win).length;
      const rollingAccuracy = totalPredictions > 0 ? (winningPredictions / totalPredictions) * 100 : 0;

      return {
        rollingAccuracy: Math.round(rollingAccuracy * 100) / 100,
        totalPredictions,
        winningPredictions,
        calibrationBuckets: calibrationData,
        recentPredictions: predictions.slice(0, 20) // Return last 20 for display
      };
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error getting accuracy history');
      throw error;
    }
  }

  /**
   * Get user provider settings
   */
  async getUserProviderSettings(uid: string): Promise<any> {
    try {
      const doc = await db().collection('users').doc(uid).collection('settings').doc('providers').get();
      if (!doc.exists) {
        return null;
      }
      return doc.data();
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error getting user provider settings');
      throw error;
    }
  }

  /**
   * Save user provider settings
   */
  async saveUserProviderSettings(uid: string, settings: any): Promise<void> {
    try {
      await db().collection('users').doc(uid).collection('settings').doc('providers').set({
        ...settings,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (error: any) {
      logger.error({ error: error.message, uid, settings }, 'Error saving user provider settings');
      throw error;
    }
  }
}

export const firestoreAdapter = new FirestoreAdapter();

