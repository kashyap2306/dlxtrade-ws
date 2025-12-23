import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { z } from 'zod';
import { accuracyEngine } from '../services/accuracyEngine';
import { API_PROVIDERS_CONFIG, ProviderConfig } from '../config/apiProviders';
import { keyManager, getEncryptionKeyHash } from '../services/keyManager';
import { ProviderTester } from '../services/providerTester';
import * as admin from 'firebase-admin';
import { logger } from '../utils/logger';
import { getFirebaseAdmin } from '../utils/firebase';
import { getUserIntegrationsByUid } from './users/providerConfig';

// Provider config schema
const providerConfigSchema = z.object({
  marketData: z.array(z.string()).optional(),
  news: z.array(z.string()).optional(),
  metadata: z.array(z.string()).optional(),
});

// Trading settings schema
const positionSizingMapItemSchema = z.object({
  min: z.number().min(0).max(100),
  max: z.number().min(0).max(100),
  percent: z.number().min(0).max(100),
});

// Accuracy-based risk configuration schema
const accuracyRiskConfigItemSchema = z.object({
  minAccuracy: z.number().min(75).max(100), // Minimum accuracy must be >= 75%
  maxAccuracy: z.number().min(75).max(100).nullable(), // Max accuracy (null = no upper limit)
  tradeSizePct: z.number().min(0).max(10), // Trade size % (hard cap 10%)
  leverage: z.number().min(1).max(10), // Leverage (hard cap 10x)
}).refine((data) => {
  // Ensure maxAccuracy >= minAccuracy if not null
  if (data.maxAccuracy !== null && data.maxAccuracy < data.minAccuracy) {
    return false;
  }
  return true;
}, {
  message: "maxAccuracy must be >= minAccuracy",
});

const tradingSettingsSchema = z.object({
  mode: z.enum(['MANUAL', 'TOP_100', 'TOP_10']).optional(),
  manualCoins: z.array(z.string()).optional(),
  maxPositionPerTrade: z.number().min(0.1).max(100).optional(),
  tradeType: z.enum(['Scalping', 'Swing', 'Position']).optional(),
  accuracyTrigger: z.number().min(0).max(100).optional(),
  maxDailyLoss: z.number().min(0).max(100).optional(),
  maxTradesPerDay: z.number().int().min(1).max(500).optional(),
  positionSizingMap: z.array(positionSizingMapItemSchema).optional(),
  accuracyRiskConfig: z.array(accuracyRiskConfigItemSchema).optional(),
}).refine((data) => {
  // Validate accuracyRiskConfig if provided
  if (data.accuracyRiskConfig && Array.isArray(data.accuracyRiskConfig)) {
    // Ensure ranges are continuous and non-overlapping
    const sorted = [...data.accuracyRiskConfig].sort((a, b) => a.minAccuracy - b.minAccuracy);
    
    // Check minimum accuracy >= 75%
    if (sorted[0]?.minAccuracy < 75) {
      return false;
    }
    
    // Check continuity (each range should start where previous ends + 1)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const prevMax = prev.maxAccuracy ?? 100;
      if (curr.minAccuracy !== prevMax + 1 && curr.minAccuracy !== prevMax) {
        return false; // Gap or overlap detected
      }
    }
    
    // Last range should have maxAccuracy === null or cover up to 100
    const last = sorted[sorted.length - 1];
    if (last && last.maxAccuracy !== null && last.maxAccuracy < 100) {
      return false; // Must cover up to 100% or have null max
    }
  }
  return true;
}, {
  message: "accuracyRiskConfig ranges must be continuous, non-overlapping, start at 75%, and cover up to 100%",
});

// Notification settings schema
const notificationSettingsSchema = z.object({
  enableAutoTradeAlerts: z.boolean().optional(),
  enableAccuracyAlerts: z.boolean().optional(),
  enableWhaleAlerts: z.boolean().optional(),
  tradeConfirmationRequired: z.boolean().optional(),
  notificationSounds: z.boolean().optional(),
  notificationVibration: z.boolean().optional(),
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),
});

// New notifications schema matching user requirements
const notificationsSchema = z.object({
  autoTradeAlerts: z.boolean().optional(),
  autoTradeAlertsPrereqMet: z.boolean().optional(),
  accuracyAlerts: z.object({
    enabled: z.boolean(),
    threshold: z.number().min(1).max(100).optional(),
    thresholdMin: z.number().min(1).max(100).optional(),
    thresholdMax: z.number().min(1).max(100).optional(),
    telegramEnabled: z.boolean().optional()
  }).optional(),
  whaleAlerts: z.object({
    enabled: z.boolean(),
    sensitivity: z.enum(['low', 'medium', 'high']).optional(),
    telegramEnabled: z.boolean().optional()
  }).optional(),
  tradeConfirmationRequired: z.boolean().optional(),
  soundEnabled: z.boolean().optional(),
  soundPreferences: z.array(z.string()).optional(),
  vibrateEnabled: z.boolean().optional(),
  telegramEnabled: z.boolean().optional(),
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),
});

// Background research schema
const backgroundResearchSchema = z.object({
  telegramEnabled: z.boolean().optional(),
  telegramToken: z.string().optional(),
  chatId: z.string().optional(),
  thresholds: z.object({
    minAccuracy: z.number().optional(),
    maxFrequency: z.number().optional(),
  }).optional(),
  scheduleInterval: z.number().optional(),
});

const settingsSchema = z.object({
  symbol: z.string().optional(),
  quoteSize: z.number().positive().optional(),
  adversePct: z.number().min(0).max(1).optional(),
  cancelMs: z.number().int().positive().optional(),
  maxPos: z.number().positive().optional(),
  minAccuracyThreshold: z.number().min(0).max(1).optional(),
  autoTradeEnabled: z.boolean().optional(),
  strategy: z.enum(['orderbook_imbalance', 'smc_hybrid', 'stat_arb']).optional(), // market_making_hft is handled by HFT engine
  liveMode: z.boolean().optional(),
  max_loss_pct: z.number().min(0).max(100).optional(),
  max_drawdown_pct: z.number().min(0).max(100).optional(),
  per_trade_risk_pct: z.number().min(0).max(100).optional(),
  status: z.enum(['active', 'paused_by_risk', 'paused_manual']).optional(),
  // New structured fields
  providerConfig: providerConfigSchema.optional(),
  tradingSettings: tradingSettingsSchema.optional(),
  notificationSettings: notificationSettingsSchema.optional(),
  notifications: notificationsSchema.optional(),
  backgroundResearch: backgroundResearchSchema.optional(),
  // Legacy notification settings (keeping for backward compatibility)
  enableAutoTradeAlerts: z.boolean().optional(),
  enableAccuracyAlerts: z.boolean().optional(),
  enableWhaleAlerts: z.boolean().optional(),
  tradeConfirmationRequired: z.boolean().optional(),
  notificationSounds: z.boolean().optional(),
  notificationVibration: z.boolean().optional(),
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),
});


export async function settingsRoutes(fastify: FastifyInstance) {
  console.log("[ROUTE READY] GET /api/settings/load");
  console.log("[ROUTE READY] POST /api/settings/update");
  console.log("[ROUTE READY] GET /api/settings/global/load");
  console.log("[ROUTE READY] POST /api/settings/global/update");
  console.log("[ROUTE READY] GET /api/trading/settings");
  console.log("[ROUTE READY] POST /api/trading/settings");
  console.log("[ROUTE READY] POST /api/trading/autotrade/toggle");
  console.log("[ROUTE READY] GET /api/trading/autotrade/status");
  console.log("[ROUTE READY] GET /api/analytics/accuracy/snapshot");
  console.log("[ROUTE READY] GET /api/analytics/accuracy/history");
  console.log("[ROUTE READY] POST /api/analytics/accuracy/outcome");

  const BACKEND_SECRET_HASH = getEncryptionKeyHash();
  logger.info({ BACKEND_SECRET_HASH }, 'BACKEND_SECRET_HASH initialized for settings routes');

  // Load user settings - DETAILED TIMING INSTRUMENTATION
  // GET /api/settings/load - Load user settings (HARDENED: 200ms timeout)
  fastify.get('/settings/load', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    const user = (request as any).user;

    if (!user?.uid) {
      logger.warn({}, 'GET /settings/load - missing uid, returning safe default');
      return reply.send({});
    }

    try {
      // HARDENED: 200ms timeout - return safe default immediately
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Operation timeout')), 2000);
      });

      const settingsOperation = async () => {
        // Only try to get basic settings - skip heavy operations
        const settings = await firestoreAdapter.getSettings(user.uid);
        return settings || {};
      };

      const settings = await Promise.race([settingsOperation(), timeoutPromise]) as any;
      logger.info({ uid: user.uid, duration: Date.now() - startTime }, 'GET /settings/load success');
      return reply.send(settings || {});
    } catch (err: any) {
      logger.warn({ uid: user.uid, error: err.message, duration: Date.now() - startTime }, 'GET /settings/load timeout/error - returning safe default');
      // SAFE DEFAULT: Always return empty object
      return reply.send({});
    }
  });

  // Update user settings
  fastify.post('/settings/update', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = settingsSchema.parse(request.body);

    // Safety check: Block liveMode if ENABLE_LIVE_TRADES is not set
    if (body.liveMode === true) {
      const enableLiveTrades = process.env.ENABLE_LIVE_TRADES === 'true';
      if (!enableLiveTrades) {
        return reply.code(403).send({
          error: 'Live trading is disabled globally. Set ENABLE_LIVE_TRADES=true in environment to enable.'
        });
      }
    }

    // Get existing settings to merge with defaults
    const existingSettings = await firestoreAdapter.getSettings(user.uid) || {} as any;

    // Ensure all settings fields have proper defaults
    const safeBody = {
      ...body,
      providerConfig: body.providerConfig ? {
        marketData: body.providerConfig.marketData || [],
        news: body.providerConfig.news || [],
        metadata: body.providerConfig.metadata || []
      } : (existingSettings.providerConfig || {
        marketData: [],
        news: [],
        metadata: []
      }),
      tradingSettings: body.tradingSettings || existingSettings.tradingSettings || {
        mode: 'MANUAL',
        manualCoins: [],
        maxPositionPerTrade: 10,
        tradeType: 'Scalping',
        accuracyTrigger: 80,
        maxDailyLoss: 5,
        maxTradesPerDay: 50,
        positionSizingMap: [
          { min: 0, max: 25, percent: 1 },
          { min: 25, max: 50, percent: 2 },
          { min: 50, max: 75, percent: 3 },
          { min: 75, max: 100, percent: 5 }
        ]
      },
      notifications: {
        ...(existingSettings.notifications || {}),
        ...(body.notifications || {}),
        // Ensure defaults if keys are missing in both
        autoTradeAlerts: body.notifications?.autoTradeAlerts ?? existingSettings.notifications?.autoTradeAlerts ?? false,
        accuracyAlerts: body.notifications?.accuracyAlerts ?? existingSettings.notifications?.accuracyAlerts ?? {
          enabled: false,
          threshold: 80,
          telegramEnabled: false
        },
        whaleAlerts: body.notifications?.whaleAlerts ?? existingSettings.notifications?.whaleAlerts ?? {
          enabled: false,
          sensitivity: 'medium',
          telegramEnabled: false
        },
        tradeConfirmationRequired: body.notifications?.tradeConfirmationRequired ?? existingSettings.notifications?.tradeConfirmationRequired ?? false,
        soundEnabled: body.notifications?.soundEnabled ?? existingSettings.notifications?.soundEnabled ?? false,
        vibrateEnabled: body.notifications?.vibrateEnabled ?? existingSettings.notifications?.vibrateEnabled ?? false,
        telegramEnabled: body.notifications?.telegramEnabled ?? existingSettings.notifications?.telegramEnabled ?? false,
        telegramChatId: body.notifications?.telegramChatId ?? existingSettings.notifications?.telegramChatId ?? ''
      },
      backgroundResearch: body.backgroundResearch || existingSettings.backgroundResearch || {
        telegramEnabled: false,
        telegramToken: '',
        chatId: '',
        thresholds: { minAccuracy: 80, maxFrequency: 10 },
        scheduleInterval: 5
      },
      updatedAt: admin.firestore.Timestamp.now()
    };

    await firestoreAdapter.saveSettings(user.uid, safeBody as any);

    // Save background research settings separately if provided
    if (body.backgroundResearch) {
      await firestoreAdapter.saveBackgroundResearchSettings(user.uid, {
        backgroundResearchEnabled: body.backgroundResearch.telegramEnabled || false,
        telegramBotToken: body.backgroundResearch.telegramToken || '',
        telegramChatId: body.backgroundResearch.chatId || '',
        researchFrequencyMinutes: body.backgroundResearch.scheduleInterval || 5,
        accuracyTrigger: body.backgroundResearch.thresholds?.minAccuracy || 80,
        lastResearchRun: null,
      });
    }

    return { message: 'Settings updated', settings: safeBody };
  });

  // Load global settings (admin only)
  fastify.get('/settings/global/load', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (!isAdmin) {
        return reply.code(403).send({ error: 'Admin access required' });
      }

      const settings = await firestoreAdapter.getGlobalSettings();
      return { settings: settings || {} };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error loading global settings' });
    }
  });

  // Update global settings (admin only)
  fastify.post('/settings/global/update', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (!isAdmin) {
        return reply.code(403).send({ error: 'Admin access required' });
      }

      const body = request.body as any;
      await firestoreAdapter.updateGlobalSettings(body);

      return { message: 'Global settings updated successfully' };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error updating global settings' });
    }
  });

  // Trading Settings Routes
  // GET /api/trading/settings - Load trading settings
  fastify.get('/trading/settings', {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    const data = await firestoreAdapter.getTradingSettings((req as any).user.uid) || {
      mode: 'MANUAL',
      manualCoins: [],
      maxPositionPerTrade: 10,
      tradeType: 'Scalping',
      accuracyTrigger: 80,
      maxDailyLoss: 5,
      maxTradesPerDay: 50,
      positionSizingMap: [
        { min: 0, max: 25, percent: 1 },
        { min: 25, max: 50, percent: 2 },
        { min: 50, max: 75, percent: 3 },
        { min: 75, max: 100, percent: 5 }
      ]
    };
    return data;
  });

  // POST /api/trading/settings - Update trading settings
  fastify.post('/trading/settings', {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    const body = req.body as any;

    // Ensure positionSizingMap has defaults if not provided
    const safeBody = {
      ...body,
      positionSizingMap: body.positionSizingMap || [
        { min: 0, max: 25, percent: 1 },
        { min: 25, max: 50, percent: 2 },
        { min: 50, max: 75, percent: 3 },
        { min: 75, max: 100, percent: 5 }
      ]
    };

    const saved = await firestoreAdapter.saveTradingSettings((req as any).user.uid, safeBody);
    return saved;
  });

  // POST /api/trading/autotrade/toggle - Toggle auto-trade ON/OFF
  fastify.post('/trading/autotrade/toggle', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = z.object({ enabled: z.boolean() }).parse(request.body);

      const { autoTradeEngine } = await import('../services/autoTradeEngine');

      if (body.enabled) {
        await autoTradeEngine.startAutoTradeLoop(user.uid);
        await firestoreAdapter.logActivity(user.uid, 'AUTO_TRADE_STARTED', {
          message: 'Auto-trade background research loop started',
          timestamp: new Date().toISOString(),
        });
        return { enabled: true, message: 'Auto-trade started successfully' };
      } else {
        await autoTradeEngine.stopAutoTradeLoop(user.uid);
        await firestoreAdapter.logActivity(user.uid, 'AUTO_TRADE_STOPPED', {
          message: 'Auto-trade background research loop stopped',
          timestamp: new Date().toISOString(),
        });
        return { enabled: false, message: 'Auto-trade stopped successfully' };
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error toggling auto-trade' });
    }
  });

  // GET /api/trading/autotrade/status - Get auto-trade status
  fastify.get('/trading/autotrade/status', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { autoTradeEngine } = await import('../services/autoTradeEngine');

      const isRunning = await autoTradeEngine.isAutoTradeRunning(user.uid);
      const lastResearchAt = await autoTradeEngine.getLastResearchTime(user.uid);
      const nextScheduledAt = isRunning ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null;

      return {
        enabled: isRunning,
        lastResearchAt,
        nextScheduledAt,
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error getting auto-trade status' });
    }
  });

  // Analytics Routes for Accuracy Engine
  // GET /api/analytics/accuracy/snapshot - Get accuracy snapshot by requestId
  fastify.get('/analytics/accuracy/snapshot', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { requestId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { requestId } = request.query;

      if (!requestId) {
        return reply.code(400).send({ error: 'requestId is required' });
      }

      const snapshot = await firestoreAdapter.getPredictionSnapshot(requestId);

      if (!snapshot) {
        return reply.code(404).send({ error: 'Snapshot not found' });
      }

      // Check if user owns this snapshot
      if (snapshot.userId !== user.uid) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      return {
        snapshot,
        requestId,
        retrievedAt: new Date().toISOString()
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error retrieving accuracy snapshot' });
    }
  });

  // GET /api/analytics/accuracy/history - Get rolling accuracy stats
  fastify.get('/analytics/accuracy/history', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { strategy?: string; symbol?: string; limit?: number } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { strategy, symbol, limit = 100 } = request.query;

      const stats = await firestoreAdapter.getAccuracyHistory(user.uid, {
        strategy,
        symbol,
        limit: Math.min(limit, 500) // Cap at 500
      });

      return {
        stats,
        filters: { strategy, symbol, limit },
        retrievedAt: new Date().toISOString()
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error retrieving accuracy history' });
    }
  });

  // POST /api/analytics/accuracy/outcome - Record prediction outcome
  fastify.post('/analytics/accuracy/outcome', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { requestId: string; win: boolean; pnl: number; durationSeconds?: number } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { requestId, win, pnl, durationSeconds } = request.body;

      if (!requestId || typeof win !== 'boolean' || typeof pnl !== 'number') {
        return reply.code(400).send({ error: 'requestId, win (boolean), and pnl (number) are required' });
      }

      await accuracyEngine.recordPredictionOutcome(requestId, {
        win,
        pnl,
        durationSeconds
      });

      return {
        success: true,
        message: 'Prediction outcome recorded successfully',
        requestId,
        recordedAt: new Date().toISOString()
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error recording prediction outcome' });
    }
  });

  // Provider Settings Routes
  // GET /api/settings/providers - Get provider settings for user
  fastify.get('/settings/providers', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;

      // Get user provider settings from Firestore (Canonical Source: integrations)
      const userIntegrations = await getUserIntegrationsByUid(user.uid);

      // Helper to map integration data to settings format
      const mapIntegration = (integration: any) => ({
        enabled: integration?.enabled ?? false,
        apiKeyPresent: !!integration?.apiKey, // apiKey is returned decrypted if available
        encryptedApiKey: integration?.apiKeyEncrypted, // Pass through for UI checks if needed
        lastUsed: integration?.usageStats?.lastUsed,
        usageStats: integration?.usageStats
      });

      // Merge backend config with user settings
      const mergedProviders = {
        marketData: {
          primary: {
            ...API_PROVIDERS_CONFIG.marketData.primary,
            ...mapIntegration(userIntegrations.marketData?.[API_PROVIDERS_CONFIG.marketData.primary.id.toLowerCase()]),
            enabled: userIntegrations.marketData?.[API_PROVIDERS_CONFIG.marketData.primary.id.toLowerCase()]?.enabled ?? true,
          },
          backups: API_PROVIDERS_CONFIG.marketData.backups.map(backup => ({
            ...backup,
            ...mapIntegration(userIntegrations.marketData?.[backup.id.toLowerCase()]),
            enabled: userIntegrations.marketData?.[backup.id.toLowerCase()]?.enabled ?? false,
          }))
        },
        news: {
          primary: {
            ...API_PROVIDERS_CONFIG.news.primary,
            ...mapIntegration(userIntegrations.news?.[API_PROVIDERS_CONFIG.news.primary.id.toLowerCase()]),
            enabled: userIntegrations.news?.[API_PROVIDERS_CONFIG.news.primary.id.toLowerCase()]?.enabled ?? true,
          },
          backups: API_PROVIDERS_CONFIG.news.backups.map(backup => ({
            ...backup,
            ...mapIntegration(userIntegrations.news?.[backup.id.toLowerCase()]),
            enabled: userIntegrations.news?.[backup.id.toLowerCase()]?.enabled ?? false,
          }))
        },
        metadata: {
          primary: {
            ...API_PROVIDERS_CONFIG.metadata.primary,
            ...mapIntegration(userIntegrations.metadata?.[API_PROVIDERS_CONFIG.metadata.primary.id.toLowerCase()]),
            enabled: userIntegrations.metadata?.[API_PROVIDERS_CONFIG.metadata.primary.id.toLowerCase()]?.enabled ?? true,
          },
          backups: API_PROVIDERS_CONFIG.metadata.backups.map(backup => ({
            ...backup,
            ...mapIntegration(userIntegrations.metadata?.[backup.id.toLowerCase()]),
            enabled: userIntegrations.metadata?.[backup.id.toLowerCase()]?.enabled ?? false,
          }))
        }
      };

      return {
        success: true,
        providers: mergedProviders
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error loading provider settings' });
    }
  });

  // POST /api/settings/providers/save - Save provider settings
  fastify.post('/settings/providers/save', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = z.object({
        providerId: z.string().min(1),
        providerType: z.enum(['marketData', 'news', 'metadata']),
        isPrimary: z.boolean(),
        enabled: z.boolean(),
        apiKey: z.string().optional()
      }).parse(request.body);

      const providerId = body.providerId.trim().toLowerCase();
      const providerType = body.providerType;

      const BACKEND_SECRET_HASH = getEncryptionKeyHash();
      const SAVE_SECRET_HASH = BACKEND_SECRET_HASH;
      logger.info({ uid: user.uid, providerId, BACKEND_SECRET_HASH, SAVE_SECRET_HASH }, 'Provider save secret hash check');

      const normalizedType = (() => {
        const MARKET_PROVIDERS = new Set([
          'cryptocompare',
          'coingecko',
          'coinpaprika',
          'marketaux',
          'kaiko',
          'livecoinwatch',
          'coinstats'
        ]);
        const NEWS_PROVIDERS = new Set([
          'newsdata',
          'cryptopanic',
          'reddit',
          'webzio',
          'gnews',
          'newscatcher',
          'coinstatsnews',
          'altcoinbuzz_rss',
          'cointelegraph_rss'
        ]);

        if (MARKET_PROVIDERS.has(providerId)) return 'marketData';
        if (NEWS_PROVIDERS.has(providerId)) return 'news';
        return 'metadata';
      })();

      // Validate API key requirement
      const providerConfig = body.isPrimary
        ? API_PROVIDERS_CONFIG[providerType].primary
        : API_PROVIDERS_CONFIG[providerType].backups.find(p => p.id === providerId);

      if (!providerConfig) {
        return reply.code(400).send({ error: 'Invalid provider configuration' });
      }

      if (providerConfig.apiKeyRequired && body.enabled && !body.apiKey) {
        return reply.code(400).send({ error: `API key is required for ${providerConfig.providerName}` });
      }

      const saveSecretHash = getEncryptionKeyHash();
      logger.debug({
        uid: user.uid,
        providerId,
        BACKEND_SECRET_HASH,
        SAVE_SECRET_HASH: saveSecretHash
      }, 'Saving provider with enforced backend encryption key');

      if (saveSecretHash !== BACKEND_SECRET_HASH) {
        logger.warn({ uid: user.uid, providerId, BACKEND_SECRET_HASH, SAVE_SECRET_HASH: saveSecretHash }, 'Mismatch between backend and save encryption hashes; enforcing backend secret');
      }

      // Encrypt API key if provided (no overwrite when missing)
      const encryptedApiKey = body.apiKey ? keyManager.encrypt(body.apiKey) : undefined;

      // Persist to integrations (source of truth)
      const updatedAt = admin.firestore.Timestamp.now();
      const integrationDoc: any = {
        providerName: providerId,
        type: normalizedType,
        enabled: body.enabled,
        updatedAt
      };
      if (encryptedApiKey) {
        // Write to apiKeyEncrypted so diagnostics/provider-config can read it
        integrationDoc.apiKeyEncrypted = encryptedApiKey;
        integrationDoc.needsReencrypt = false;
        integrationDoc.decryptable = true;
      }

      await getFirebaseAdmin()
        .firestore()
        .collection('users')
        .doc(user.uid)
        .collection('integrations')
        .doc(providerId)
        .set(integrationDoc, { merge: true });

      console.log("[SETTINGS_PROVIDER_SAVE] Firestore path written:", `users/${user.uid}/integrations/${providerId}`, {
        fields: Object.keys(integrationDoc),
        type: normalizedType,
        enabled: body.enabled,
        hasEncryptedKey: !!encryptedApiKey
      });

      logger.info({
        uid: user.uid,
        providerId,
        encryptedKeyLength: encryptedApiKey ? encryptedApiKey.length : 0,
        updatedAt: updatedAt.toDate().toISOString(),
        type: normalizedType,
        BACKEND_SECRET_HASH,
        SAVE_SECRET_HASH
      }, 'Provider saved to integrations with encrypted key');

      return {
        success: true,
        message: `${providerConfig.providerName} ${body.enabled ? 'enabled' : 'disabled'} successfully`
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error saving provider settings' });
    }
  });

  // POST /api/settings/providers/change - Change API key for a provider
  fastify.post('/settings/providers/change', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = z.object({
        providerId: z.string(),
        providerType: z.enum(['marketData', 'news', 'metadata']),
        isPrimary: z.boolean(),
        newApiKey: z.string().min(1, 'API key cannot be empty')
      }).parse(request.body);

      const { providerId, providerType, isPrimary, newApiKey } = body;

      // Get current user settings
      const userProviderSettings = await firestoreAdapter.getUserProviderSettings(user.uid) || {};

      // Validate provider exists
      const providerConfig = isPrimary
        ? API_PROVIDERS_CONFIG[providerType].primary
        : API_PROVIDERS_CONFIG[providerType].backups.find(p => p.id === providerId);

      if (!providerConfig) {
        return reply.code(400).send({ error: 'Invalid provider configuration' });
      }

      if (!providerConfig.apiKeyRequired) {
        return reply.code(400).send({ error: `${providerConfig.providerName} does not require an API key` });
      }

      // Encrypt new API key
      const encryptedApiKey = keyManager.encrypt(newApiKey);

      // Update settings in 'integrations' (Canonical Source)
      // We calculate the normalized type if needed, but usually providerId is unique enough if we lowercase it.
      // But verify bucket logic just in case:

      const normalizedId = providerId.toLowerCase().trim();

      // Update the integration doc directly
      const updatePayload: any = {
        apiKeyEncrypted: encryptedApiKey, // Use the new key
        enabled: true, // Key presence forces enable
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      // Since we don't know the exact doc type (could be coerced), we trust the input `providerType` 
      // OR we just write to `integrations/{normalizedId}` and let `getProviderConfig` sort it out.

      await getFirebaseAdmin()
        .firestore()
        .collection('users')
        .doc(user.uid)
        .collection('integrations')
        .doc(normalizedId)
        .set(updatePayload, { merge: true });

      // No longer need to save to legacy settings/providers
      // await firestoreAdapter.saveUserProviderSettings(user.uid, userProviderSettings);

      return {
        success: true,
        message: `API key for ${providerConfig.providerName} updated successfully`
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error changing API key' });
    }
  });

  // POST /api/settings/providers/test - Test provider connection
  fastify.post('/settings/providers/test', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = z.object({
        providerName: z.string(),
        type: z.enum(['marketData', 'news', 'metadata']),
        apiKey: z.string().optional()
      }).parse(request.body);

      const { providerName, type, apiKey } = body;

      // Get user provider settings to find the API key if not provided
      if (!apiKey) {
        const userProviderSettings = await firestoreAdapter.getUserProviderSettings(user.uid) || {};
        const providerTypeSettings = userProviderSettings[type];

        if (providerTypeSettings) {
          // Find the provider in primary or backups
          const primaryId = API_PROVIDERS_CONFIG[type].primary.id;
          const providerId = Object.keys(API_PROVIDERS_CONFIG).some(key =>
            API_PROVIDERS_CONFIG[key as keyof typeof API_PROVIDERS_CONFIG].primary.providerName === providerName ||
            Object.values(API_PROVIDERS_CONFIG[key as keyof typeof API_PROVIDERS_CONFIG].backups)
              .some(backup => backup.providerName === providerName)
          ) ? API_PROVIDERS_CONFIG[type].backups.find(b => b.providerName === providerName)?.id || primaryId : null;

          if (providerId) {
            // Check primary first
            if (providerTypeSettings.primary?.encryptedApiKey && API_PROVIDERS_CONFIG[type].primary.providerName === providerName) {
              const decryptedKey = keyManager.decrypt(providerTypeSettings.primary.encryptedApiKey);
              body.apiKey = decryptedKey;
            }
            // Check backups
            else if (providerTypeSettings.backups?.[providerId]?.encryptedApiKey) {
              const decryptedKey = keyManager.decrypt(providerTypeSettings.backups[providerId].encryptedApiKey);
              body.apiKey = decryptedKey;
            }
          }
        }
      }

      // Test the provider
      const result = await ProviderTester.testProvider(providerName, type, body.apiKey);

      return {
        success: result.success,
        latencyMs: result.latencyMs,
        message: result.message,
        providerName,
        type
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error testing provider connection' });
    }
  });

  // POST /api/settings/provider/save - Save provider settings (singular - matches frontend)
  fastify.post('/settings/provider/save', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = z.object({
        providerName: z.string(),
        type: z.enum(['marketData', 'news', 'metadata']),
        enabled: z.boolean(),
        apiKey: z.string().optional()
      }).parse(request.body);

      const { providerName, type, enabled, apiKey } = body;

      console.log(`[PROVIDER SAVE] ${user.uid}: ${providerName} (${type}) - enabled: ${enabled}, hasApiKey: ${!!apiKey}`);

      // Get current user settings
      const userProviderSettings = await firestoreAdapter.getUserProviderSettings(user.uid) || {};

      // Initialize provider type if not exists
      if (!userProviderSettings[type]) {
        userProviderSettings[type] = { primary: {}, backups: {} };
      }

      // Find if this is primary or backup provider
      const isPrimary = API_PROVIDERS_CONFIG[type].primary.providerName === providerName;
      const backupConfig = API_PROVIDERS_CONFIG[type].backups.find(b => b.providerName === providerName);
      const providerId = isPrimary ? API_PROVIDERS_CONFIG[type].primary.id : backupConfig?.id;

      if (!providerId) {
        console.error(`[PROVIDER SAVE ERROR] Unknown provider: ${providerName}`);
        return reply.code(400).send({ error: `Unknown provider: ${providerName}` });
      }

      // Validate API key requirement
      const providerConfig = isPrimary
        ? API_PROVIDERS_CONFIG[type].primary
        : backupConfig;

      if (!providerConfig) {
        return reply.code(400).send({ error: 'Invalid provider configuration' });
      }

      if (providerConfig.apiKeyRequired && enabled && !apiKey) {
        console.error(`[PROVIDER SAVE ERROR] API key required for ${providerName}`);
        return reply.code(400).send({ error: `API key is required for ${providerName}` });
      }

      // Encrypt API key if provided (reuse existing if omitted)
      let encryptedApiKey = undefined;
      if (apiKey) {
        encryptedApiKey = keyManager.encrypt(apiKey);
      }

      // Update settings
      const existingPrimary = userProviderSettings[type].primary || {};
      const existingBackup = userProviderSettings[type].backups?.[providerId] || {};
      const preservedEncrypted = isPrimary ? existingPrimary.encryptedApiKey : existingBackup.encryptedApiKey;
      const finalEncrypted = encryptedApiKey ?? preservedEncrypted;
      const finalEnabled = finalEncrypted ? true : enabled; // If key exists, keep enabled permanently until key removal

      if (isPrimary) {
        userProviderSettings[type].primary = {
          ...existingPrimary,
          enabled: finalEnabled,
          encryptedApiKey: finalEncrypted,
          updatedAt: new Date()
        };
      } else {
        if (!userProviderSettings[type].backups) {
          userProviderSettings[type].backups = {};
        }
        userProviderSettings[type].backups[providerId] = {
          ...existingBackup,
          enabled: finalEnabled,
          encryptedApiKey: finalEncrypted,
          updatedAt: new Date()
        };
      }

      // Save to Firestore with error handling
      try {
        await firestoreAdapter.saveUserProviderSettings(user.uid, userProviderSettings);
        console.log(`[PROVIDER SAVE SUCCESS] ${providerName} saved successfully`);

        return {
          success: true,
          message: `${providerName} ${enabled ? 'enabled' : 'disabled'} successfully`
        };
      } catch (dbError: any) {
        console.error(`[PROVIDER SAVE DB ERROR] ${providerName}:`, dbError);
        return reply.code(500).send({
          ok: false,
          error: 'Save operation did not complete successfully',
          detail: dbError.message
        });
      }
    } catch (err: any) {
      console.error(`[PROVIDER SAVE ERROR]`, err);
      return reply.code(500).send({
        ok: false,
        error: err.message || 'Error saving provider settings'
      });
    }
  });

  // POST /api/settings/provider/test - Test provider connection (singular - matches frontend)
  fastify.post('/settings/provider/test', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = z.object({
        providerName: z.string(),
        type: z.enum(['marketData', 'news', 'metadata']),
        apiKey: z.string().optional()
      }).parse(request.body);

      const { providerName, type, apiKey } = body;

      console.log(`[PROVIDER TEST] ${user.uid}: Testing ${providerName} (${type})`);

      // Get user provider settings to find the API key if not provided
      let finalApiKey = apiKey;
      if (!finalApiKey) {
        const userProviderSettings = await firestoreAdapter.getUserProviderSettings(user.uid) || {};
        const providerTypeSettings = userProviderSettings[type];

        if (providerTypeSettings) {
          // Check if this is primary or backup
          const isPrimary = API_PROVIDERS_CONFIG[type].primary.providerName === providerName;
          const backupConfig = API_PROVIDERS_CONFIG[type].backups.find(b => b.providerName === providerName);
          const providerId = isPrimary ? API_PROVIDERS_CONFIG[type].primary.id : backupConfig?.id;

          if (providerId) {
            // Check primary first
            if (isPrimary && providerTypeSettings.primary?.encryptedApiKey) {
              finalApiKey = keyManager.decrypt(providerTypeSettings.primary.encryptedApiKey);
            }
            // Check backups
            else if (!isPrimary && providerTypeSettings.backups?.[providerId]?.encryptedApiKey) {
              finalApiKey = keyManager.decrypt(providerTypeSettings.backups[providerId].encryptedApiKey);
            }
          }
        }
      }

      // Test the provider
      const result = await ProviderTester.testProvider(providerName, type, finalApiKey);

      console.log(`[PROVIDER TEST RESULT] ${providerName}: ${result.success ? 'SUCCESS' : 'FAILED'} - ${result.message}`);

      return {
        success: result.success,
        message: result.message,
        details: result.details || {}
      };
    } catch (err: any) {
      console.error(`[PROVIDER TEST ERROR] ${err.message}`);
      return reply.code(500).send({
        ok: false,
        error: 'Test operation failed',
        message: err.message
      });
    }
  });

  // Trading Settings Routes
  // GET /api/settings/trading - Get trading settings
  fastify.get('/settings/trading', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const tradingSettings = await firestoreAdapter.getTradingSettings(user.uid) || {
        mode: 'MANUAL',
        manualCoins: [],
        maxPositionPerTrade: 10,
        tradeType: 'Scalping',
        accuracyTrigger: 80,
        maxDailyLoss: 5,
        maxTradesPerDay: 50,
        positionSizingMap: [
          { min: 0, max: 25, percent: 1 },
          { min: 25, max: 50, percent: 2 },
          { min: 50, max: 75, percent: 3 },
          { min: 75, max: 100, percent: 5 }
        ]
      };
      return tradingSettings;
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error loading trading settings' });
    }
  });

  // POST /api/settings/trading - Update trading settings
  fastify.post('/settings/trading', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = tradingSettingsSchema.parse(request.body);

      // CRITICAL: Validate accuracyRiskConfig if provided
      if (body.accuracyRiskConfig && Array.isArray(body.accuracyRiskConfig)) {
        // Additional runtime validation
        const sorted = [...body.accuracyRiskConfig].sort((a: any, b: any) => a.minAccuracy - b.minAccuracy);
        
        // Check minimum accuracy >= 75%
        if (sorted[0]?.minAccuracy < 75) {
          return reply.code(400).send({ error: 'Minimum accuracy must be >= 75%' });
        }
        
        // Check continuity and non-overlapping
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1];
          const curr = sorted[i];
          const prevMax = prev.maxAccuracy ?? 100;
          if (curr.minAccuracy !== prevMax + 1 && curr.minAccuracy !== prevMax) {
            return reply.code(400).send({ error: 'Accuracy ranges must be continuous and non-overlapping' });
          }
        }
        
        // Last range should cover up to 100%
        const last = sorted[sorted.length - 1];
        if (last && last.maxAccuracy !== null && last.maxAccuracy < 100) {
          return reply.code(400).send({ error: 'Last range must cover up to 100% (set maxAccuracy to null)' });
        }

        // Validate hard caps
        for (const item of body.accuracyRiskConfig) {
          if (item.tradeSizePct > 10) {
            return reply.code(400).send({ error: 'Trade size cannot exceed 10%' });
          }
          if (item.leverage > 10) {
            return reply.code(400).send({ error: 'Leverage cannot exceed 10x' });
          }
        }
      }

      await firestoreAdapter.saveTradingSettings(user.uid, body);
      return { message: 'Trading settings updated successfully' };
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.code(400).send({ error: err.errors?.[0]?.message || 'Validation failed' });
      }
      return reply.code(500).send({ error: err.message || 'Error saving trading settings' });
    }
  });

  // Research Settings Routes
  // GET /api/settings/selectedCoins - Get selected coins for research
  fastify.get('/settings/selectedCoins', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const settings = await firestoreAdapter.getSettings(user.uid) || {};
      const researchSettings = await firestoreAdapter.getBackgroundResearchSettings(user.uid) || {};

      return {
        mode: researchSettings.coinSelectionMode || 'manual',
        selectedCoins: researchSettings.selectedCoins || [],
        accuracyTrigger: researchSettings.accuracyTrigger || 80
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error loading research settings' });
    }
  });

  // POST /api/settings/selectedCoins - Update selected coins for research
  fastify.post('/settings/selectedCoins', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = z.object({
        mode: z.enum(['Manual', 'Top100', 'Top10']),
        selectedCoins: z.array(z.string()),
        accuracyTrigger: z.number().min(0).max(100).optional()
      }).parse(request.body);

      // Get existing background research settings
      const existingSettings = await firestoreAdapter.getBackgroundResearchSettings(user.uid) || {};

      // Update with new values
      const updatedSettings = {
        ...existingSettings,
        coinSelectionMode: body.mode,
        selectedCoins: body.selectedCoins,
        accuracyTrigger: body.accuracyTrigger || existingSettings.accuracyTrigger || 80,
        updatedAt: new Date()
      };

      await firestoreAdapter.saveBackgroundResearchSettings(user.uid, updatedSettings);
      return { message: 'Research settings updated successfully' };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error saving research settings' });
    }
  });

  // Helper function to check auto-trade alerts prerequisites
  async function checkAutoTradeAlertsPrerequisites(uid: string): Promise<{ met: boolean, missing: string[] }> {
    const missing: string[] = [];

    try {
      // Check 1: All three primary providers have been saved/configured
      const userProviderSettings = await firestoreAdapter.getUserProviderSettings(uid) || {};

      const primaryProviders = [
        { id: 'coingecko', name: 'CoinGecko', requiresKey: false },
        { id: 'newsdata', name: 'NewsData.io', requiresKey: true },
        { id: 'cryptocompare', name: 'CryptoCompare', requiresKey: true }
      ];

      for (const provider of primaryProviders) {
        const providerData = userProviderSettings.marketData?.primary?.providerName === provider.name ||
          userProviderSettings.news?.primary?.providerName === provider.name ||
          userProviderSettings.metadata?.primary?.providerName === provider.name;

        if (!providerData) {
          missing.push(`${provider.name} not configured as primary provider`);
          continue;
        }

        // Check if API key is provided for providers that require it
        if (provider.requiresKey) {
          const hasKey = (userProviderSettings.marketData?.primary?.encryptedApiKey && userProviderSettings.marketData.primary.providerName === provider.name) ||
            (userProviderSettings.news?.primary?.encryptedApiKey && userProviderSettings.news.primary.providerName === provider.name) ||
            (userProviderSettings.metadata?.primary?.encryptedApiKey && userProviderSettings.metadata.primary.providerName === provider.name);

          if (!hasKey) {
            missing.push(`${provider.name} missing API key`);
          }
        }
      }

      // Check 2: Auto-Trade mode is enabled
      // CRITICAL: Check autoTradeConfig, NOT settings.autoTradeEnabled (legacy)
      const db = getFirebaseAdmin().firestore();
      const configDoc = await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').get();
      const configData = configDoc.exists ? configDoc.data() : null;
      if (!configData || !configData.autoTradeEnabled) {
        missing.push('Auto-Trade not enabled');
      }

      // Check 3: An exchange is connected
      const exchanges = ['binance', 'bitget', 'weex', 'bingx'];
      let hasExchangeConnected = false;

      for (const exchange of exchanges) {
        const credentials = await firestoreAdapter.getExchangeCredentials(uid, exchange);
        if (credentials) {
          hasExchangeConnected = true;
          break;
        }
      }

      if (!hasExchangeConnected) {
        missing.push('No exchange connected');
      }

      return {
        met: missing.length === 0,
        missing
      };
    } catch (error: any) {
      console.error('Error checking auto-trade prerequisites:', error);
      return {
        met: false,
        missing: ['Error checking prerequisites']
      };
    }
  }

  // Notifications Settings Routes
  // GET /api/settings/notifications - Get notification settings
  // CRITICAL: Must respond < 200ms - NO blocking operations
  fastify.get('/settings/notifications', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();

    // HARD TIMEOUT GUARD: Auto-respond 504 after 2s
    const timeoutId = setTimeout(() => {
      if (!reply.sent) {
        logger.warn({ uid: (request as any).user?.uid }, 'GET /settings/notifications timeout - returning defaults');
        reply.code(504).send({
          autoTradeAlerts: false,
          accuracyAlerts: { enabled: false, threshold: 80 },
          whaleAlerts: { enabled: false, sensitivity: 'medium' },
          tradeConfirmationRequired: false,
          soundEnabled: false,
          vibrateEnabled: false,
          telegramEnabled: false,
          autoTradeAlertsPrereqMet: false,
          autoTradeAlertsPrereqMissing: ['Timeout loading settings']
        });
      }
    }, 2000);

    try {
      const user = (request as any).user;
      if (!user?.uid) {
        clearTimeout(timeoutId);
        return reply.code(401).send({ error: 'Authentication required' });
      }

      logger.info({ uid: user.uid }, 'GET /settings/notifications called - Loading from users/{uid}/settings/current');

      // FAST: Single Firestore read with 500ms timeout
      const settingsOperation = async () => {
        return await firestoreAdapter.getSettings(user.uid);
      };

      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 500);
      });

      const settings = await Promise.race([settingsOperation(), timeoutPromise]) as any;

      clearTimeout(timeoutId);

      if (!settings) {
        logger.warn({ uid: user.uid }, 'GET /settings/notifications - Settings document not found');
      }

      // CRITICAL: Return defaults explicitly if document doesn't exist or timeout
      const notifications = settings?.notifications || {
        autoTradeAlerts: false,
        accuracyAlerts: { enabled: false, threshold: 80 },
        whaleAlerts: { enabled: false, sensitivity: 'medium' },
        tradeConfirmationRequired: false,
        soundEnabled: false,
        vibrateEnabled: false,
        telegramEnabled: false
      };

      const duration = Date.now() - startTime;
      logger.info({ uid: user.uid, duration, notifications }, 'GET /settings/notifications success - Data loaded');

      // Return immediately - prerequisite check moved to separate endpoint
      return {
        ...notifications,
        autoTradeAlertsPrereqMet: false, // Will be checked separately via /prereq endpoint
        autoTradeAlertsPrereqMissing: []
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      logger.error({ uid: (request as any).user?.uid, error: err.message }, 'GET /settings/notifications error');

      // Return safe defaults on error
      return {
        autoTradeAlerts: false,
        accuracyAlerts: { enabled: false, threshold: 80 },
        whaleAlerts: { enabled: false, sensitivity: 'medium' },
        tradeConfirmationRequired: false,
        soundEnabled: false,
        vibrateEnabled: false,
        telegramEnabled: false,
        autoTradeAlertsPrereqMet: false,
        autoTradeAlertsPrereqMissing: ['Error loading settings']
      };
    }
  });

  // GET /api/settings/notifications/prereq - Check prerequisites for auto-trade alerts
  fastify.get('/settings/notifications/prereq', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const prereq = await checkAutoTradeAlertsPrerequisites(user.uid);

      return {
        autoTradeReady: prereq.met,
        missing: prereq.missing
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error checking prerequisites' });
    }
  });

  // POST /api/settings/notifications - Update notification settings
  // CRITICAL: Fast, non-blocking save - no prerequisite checks
  fastify.post('/settings/notifications', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    const user = (request as any).user;
    let payload: any = request.body || {};

    // HARD TIMEOUT GUARD: Auto-respond 504 after 2s
    const timeoutId = setTimeout(() => {
      if (!reply.sent) {
        logger.warn({ uid: user?.uid }, 'POST /settings/notifications timeout');
        reply.code(504).send({
          success: false,
          error: 'Operation timeout'
        });
      }
    }, 2000);

    try {
      const user = (request as any).user;
      const payload = request.body as any;

      logger.info({ uid: user.uid, payload }, 'POST /settings/notifications - Attempting save to users/{uid}/settings/current');

      // FAST: Single Firestore read with 500ms timeout
      const settingsOperation = async () => {
        return await firestoreAdapter.getSettings(user.uid);
      };

      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 500);
      });

      const existingSettings: any = await Promise.race([settingsOperation(), timeoutPromise]) || {};
      const currentNotifications = existingSettings.notifications || {
        autoTradeAlerts: false,
        autoTradeAlertsPrereqMet: false,
        accuracyAlerts: { enabled: false, threshold: 80, thresholdMin: 70, thresholdMax: 90, telegramEnabled: false },
        whaleAlerts: { enabled: false, sensitivity: 'medium', telegramEnabled: false },
        tradeConfirmationRequired: false,
        soundEnabled: false,
        vibrateEnabled: false,
        telegramEnabled: false,
        telegramBotToken: '',
        telegramChatId: ''
      };

      // CRITICAL: Build CLEAN notifications object explicitly - NO spreading, NO undefined values
      const cleanNotifications: any = {
        autoTradeAlerts: Boolean(payload.autoTradeAlerts ?? currentNotifications.autoTradeAlerts ?? false),
        tradeConfirmationRequired: Boolean(payload.tradeConfirmationRequired ?? currentNotifications.tradeConfirmationRequired ?? false),
        soundEnabled: Boolean(payload.soundEnabled ?? payload.playSound ?? currentNotifications.soundEnabled ?? false),
        vibrateEnabled: Boolean(payload.vibrateEnabled ?? payload.vibrate ?? currentNotifications.vibrateEnabled ?? false),
        telegramEnabled: Boolean(payload.telegramEnabled ?? currentNotifications.telegramEnabled ?? false)
      };

      // Handle accuracyAlerts - deep merge without undefined
      const inputAccuracyAlerts = payload.accuracyAlerts;
      const currentAccuracyAlerts = currentNotifications.accuracyAlerts || { enabled: false, threshold: 80 };
      cleanNotifications.accuracyAlerts = {
        enabled: Boolean(inputAccuracyAlerts?.enabled ?? (typeof inputAccuracyAlerts === 'boolean' ? inputAccuracyAlerts : currentAccuracyAlerts.enabled) ?? false),
        threshold: Number(inputAccuracyAlerts?.threshold ?? currentAccuracyAlerts.threshold ?? 80)
      };

      // Handle whaleAlerts - deep merge without undefined
      const inputWhaleAlerts = payload.whaleAlerts;
      const currentWhaleAlerts = currentNotifications.whaleAlerts || { enabled: false, sensitivity: 'medium' };
      cleanNotifications.whaleAlerts = {
        enabled: Boolean(inputWhaleAlerts?.enabled ?? (typeof inputWhaleAlerts === 'boolean' ? inputWhaleAlerts : currentWhaleAlerts.enabled) ?? false),
        sensitivity: String(inputWhaleAlerts?.sensitivity ?? currentWhaleAlerts.sensitivity ?? 'medium')
      };

      // Handle encryption for telegram bot token - ONLY if provided and valid
      if (payload.telegramBotToken && typeof payload.telegramBotToken === 'string' && payload.telegramBotToken.trim().length > 0) {
        try {
          const encryptedBotToken = keyManager.encrypt(payload.telegramBotToken);
          // ONLY include telegramBotToken if encryption succeeded and result is valid
          if (encryptedBotToken && typeof encryptedBotToken === 'string') {
            cleanNotifications.telegramBotToken = encryptedBotToken;
          }
        } catch (encryptError: any) {
          clearTimeout(timeoutId);
          logger.error({ error: encryptError.message }, 'Failed to encrypt Telegram bot token');
          return reply.send({ success: false, error: 'Failed to encrypt Telegram credentials' });
        }
      }

      // Handle telegramChatId - ONLY if provided and valid
      if (payload.telegramChatId && typeof payload.telegramChatId === 'string' && payload.telegramChatId.trim().length > 0) {
        cleanNotifications.telegramChatId = payload.telegramChatId.trim();
      }

      // CRITICAL: Validate prerequisites BEFORE writing (but don't block the save)
      // Note: We removed blocking prerequisite checks to allow faster saves
      // Prerequisites are checked separately via /prereq endpoint

      // Telegram validation - only if telegram is enabled
      if (cleanNotifications.telegramEnabled) {
        if (!cleanNotifications.telegramChatId) {
          clearTimeout(timeoutId);
          return reply.send({ success: false, error: 'Telegram Chat ID is required when Telegram is enabled' });
        }
      }

      // CRITICAL: Apply deep sanitization to remove any remaining undefined values
      const sanitizedNotifications = firestoreAdapter['sanitizeForFirestore'](cleanNotifications);

      const finalSettings = {
        ...existingSettings,
        notifications: sanitizedNotifications,
        updatedAt: admin.firestore.Timestamp.now()
      };

      // CRITICAL: Save to Firestore - saveSettings will throw on failure, we let it bubble up
      logger.info({ uid: user.uid, sanitizedNotifications }, 'POST /settings/notifications - Writing to Firestore...');
      await firestoreAdapter.saveSettings(user.uid, finalSettings);

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      logger.info({ uid: user.uid, duration, notifications: sanitizedNotifications }, 'POST /settings/notifications success - Firestore write complete');

      return {
        success: true,
        message: 'Notification settings updated successfully',
        notifications: sanitizedNotifications
      };

    } catch (err: any) {
      clearTimeout(timeoutId);
      logger.error({ uid: user.uid, error: err.message, stack: err.stack }, 'Error saving notification settings');
      // CRITICAL: Return 500 on ANY error including Firestore write failures
      return reply.code(500).send({
        success: false,
        error: err.message || 'Failed to save notification settings to database'
      });
    }
  });

  // POST /api/notifications/dismiss - Mark notification as dismissed
  fastify.post('/notifications/dismiss', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = z.object({
        notificationId: z.string()
      }).parse(request.body);

      // For now, we'll store dismissed notifications in user settings
      // In a production system, you might want a separate notifications collection
      const settings = await firestoreAdapter.getSettings(user.uid) || {} as any;
      const dismissedNotifications = settings.dismissedNotifications || [];
      dismissedNotifications.push({
        id: body.notificationId,
        dismissedAt: admin.firestore.Timestamp.now()
      });

      await firestoreAdapter.saveSettings(user.uid, {
        ...settings,
        dismissedNotifications
      });

      return { message: 'Notification dismissed successfully' };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error dismissing notification' });
    }
  });

  // POST /settings/save - Save settings (alias for update)
  fastify.post('/settings/save', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const settings = request.body;

    try {
      await firestoreAdapter.saveSettings(user.uid, settings);
      return { success: true, message: 'Settings saved successfully' };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error saving settings' });
    }
  });

  // GET /settings/general - Get general trading settings
  fastify.get('/settings/general', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;

    try {
      const settings = await firestoreAdapter.getSettings(user.uid);
      if (!settings) {
        // Return defaults
        return {
          symbol: 'BTCUSDT',
          quoteSize: 0.001,
          adversePct: 0.0002,
          cancelMs: 40,
          maxPos: 0.01,
          minAccuracyThreshold: 0.85,
          autoTradeEnabled: false,
          strategy: 'orderbook_imbalance',
          liveMode: false,
          max_loss_pct: 5,
          max_drawdown_pct: 10,
          per_trade_risk_pct: 1,
          status: 'active',
        };
      }

      return {
        ...settings,
        updatedAt: settings.updatedAt?.toDate().toISOString(),
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error loading general settings' });
    }
  });

  // POST /settings/general - Save general trading settings
  fastify.post('/settings/general', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const newSettings = request.body as any;

    try {
      // Get existing settings to merge
      const existingSettings = await firestoreAdapter.getSettings(user.uid) || {};

      // Merge new settings with existing ones
      const updatedSettings = {
        ...existingSettings,
        ...(newSettings as object),
        updatedAt: admin.firestore.Timestamp.now()
      };

      await firestoreAdapter.saveSettings(user.uid, updatedSettings);

      // CRITICAL: Also save trading-specific settings to trading settings collection
      // This ensures Auto-Trade engine can access them via getTradingSettings()
      if (newSettings.maxPositionPercent !== undefined ||
        newSettings.maxDailyLossPercent !== undefined ||
        newSettings.maxTradesPerDay !== undefined ||
        newSettings.preferredTradeType !== undefined) {

        const tradingSettings = {
          maxPositionPct: newSettings.maxPositionPercent ?? (existingSettings as any).tradingSettings?.maxPositionPct ?? 10,
          maxDailyLossPct: newSettings.maxDailyLossPercent ?? (existingSettings as any).tradingSettings?.maxDailyLossPct ?? 5,
          maxTradesPerDay: newSettings.maxTradesPerDay ?? (existingSettings as any).tradingSettings?.maxTradesPerDay ?? 50,
          tradeType: (newSettings.preferredTradeType || (existingSettings as any).tradingSettings?.tradeType || 'scalping').toLowerCase(),
        };

        // Save to trading settings collection
        await firestoreAdapter.saveTradingSettings(user.uid, tradingSettings);

      }


      fastify.log.info({ uid: user.uid }, 'General settings saved successfully');

      return {
        success: true,
        message: 'General settings saved successfully',
        settings: updatedSettings
      };
    } catch (err: any) {
      fastify.log.error({ uid: user.uid, error: err.message }, 'Error saving general settings');
      return reply.code(500).send({ error: err.message || 'Error saving general settings' });
    }
  });


}

