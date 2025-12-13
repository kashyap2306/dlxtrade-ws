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

const tradingSettingsSchema = z.object({
  mode: z.enum(['MANUAL', 'TOP_100', 'TOP_10']).optional(),
  manualCoins: z.array(z.string()).optional(),
  maxPositionPerTrade: z.number().min(0.1).max(100).optional(),
  tradeType: z.enum(['Scalping', 'Swing', 'Position']).optional(),
  accuracyTrigger: z.number().min(0).max(100).optional(),
  maxDailyLoss: z.number().min(0).max(100).optional(),
  maxTradesPerDay: z.number().int().min(1).max(500).optional(),
  positionSizingMap: z.array(positionSizingMapItemSchema).optional(),
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
    threshold: z.number().min(1).max(100),
    telegramEnabled: z.boolean().optional()
  }).optional(),
  whaleAlerts: z.object({
    enabled: z.boolean(),
    sensitivity: z.enum(['low', 'medium', 'high']),
    telegramEnabled: z.boolean().optional()
  }).optional(),
  requireTradeConfirmation: z.boolean().optional(),
  soundEnabled: z.boolean().optional(),
  vibrateEnabled: z.boolean().optional(),
  telegramEnabled: z.boolean().optional(),
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
  fastify.get('/settings/load', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const t0 = Date.now();
    const user = (request as any).user;

    try {
      fastify.log.info({ uid: user.uid }, 'settings.load:start');

      // Time individual DB calls
      const t1 = Date.now();
      const settings = await firestoreAdapter.getSettings(user.uid);
      const dt1 = Date.now() - t1;
      fastify.log.info({ duration: dt1 }, 'settings.load:getSettings');

      const t2 = Date.now();

      // Get user provider settings
      const userProviderSettings = await firestoreAdapter.getUserProviderSettings(user.uid) || {};
      const dt2 = Date.now() - t2;
      fastify.log.info({ duration: dt2 }, 'settings.load:getUserProviderSettings');

      const t3 = Date.now();

    // Ensure providerConfig always has safe defaults
    const providerConfig = {
      marketData: userProviderSettings.marketData?.backups ? Object.keys(userProviderSettings.marketData.backups) : [],
      news: userProviderSettings.news?.backups ? Object.keys(userProviderSettings.news.backups) : [],
      metadata: userProviderSettings.metadata?.backups ? Object.keys(userProviderSettings.metadata.backups) : []
    };

    // Get background research settings for defaults
    const bgResearchDefaults = await firestoreAdapter.getBackgroundResearchSettings(user.uid) || {
      telegramEnabled: false,
      telegramToken: '',
      chatId: '',
      thresholds: { minAccuracy: 80, maxFrequency: 10 },
      scheduleInterval: 5
    };
    const dt3 = Date.now() - t3;
    fastify.log.info({ duration: dt3 }, 'settings.load:getBackgroundResearchSettings-defaults');

    if (!settings) {
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
        providerConfig,
        tradingSettings: {
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
          autoTradeAlerts: false,
          accuracyAlerts: false,
          whaleAlerts: false,
          confirmBeforeTrade: false,
          playSound: false,
          vibrate: false
        },
        backgroundResearch: {
          telegramEnabled: bgResearchDefaults.telegramEnabled || false,
          telegramToken: bgResearchDefaults.telegramBotToken || '',
          chatId: bgResearchDefaults.telegramChatId || '',
          thresholds: bgResearchDefaults.thresholds || { minAccuracy: 80, maxFrequency: 10 },
          scheduleInterval: bgResearchDefaults.researchFrequencyMinutes || 5
        }
      };
    }

    // Get background research settings
    const bgResearchSettings = await firestoreAdapter.getBackgroundResearchSettings(user.uid) || {
      telegramEnabled: false,
      telegramToken: '',
      chatId: '',
      thresholds: { minAccuracy: 80, maxFrequency: 10 },
      scheduleInterval: 5
    };

    // Ensure existing settings also have safe structure
    const safeSettings = {
      ...settings,
      providerConfig: settings.providerConfig ? {
        marketData: settings.providerConfig.marketData || [],
        news: settings.providerConfig.news || [],
        metadata: settings.providerConfig.metadata || []
      } : providerConfig,
      tradingSettings: settings.tradingSettings || {
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
      notifications: (settings as any).notifications || {
        autoTradeAlerts: false,
        accuracyAlerts: false,
        whaleAlerts: false,
        confirmBeforeTrade: false,
        playSound: false,
        vibrate: false
      },
      backgroundResearch: {
        telegramEnabled: bgResearchSettings.telegramEnabled || false,
        telegramToken: bgResearchSettings.telegramBotToken || '',
        chatId: bgResearchSettings.telegramChatId || '',
        thresholds: bgResearchSettings.thresholds || { minAccuracy: 80, maxFrequency: 10 },
        scheduleInterval: bgResearchSettings.researchFrequencyMinutes || 5
      },
      updatedAt: settings.updatedAt?.toDate().toISOString(),
    };

      const dt = Date.now() - t0;
      fastify.log.info({ duration: dt }, 'settings.load:done');
      return safeSettings;
    } catch (err: any) {
      const dt = Date.now() - t0;
      fastify.log.error({ err, duration: dt }, 'settings.load:error');
      return reply.code(500).send({ error: 'settings_load_failed' });
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
      notifications: body.notifications || existingSettings.notifications || {
        autoTradeAlerts: false,
        accuracyAlerts: false,
        whaleAlerts: false,
        confirmBeforeTrade: false,
        playSound: false,
        vibrate: false
      },
      backgroundResearch: body.backgroundResearch || existingSettings.backgroundResearch || {
        telegramEnabled: false,
        telegramToken: '',
        chatId: '',
        thresholds: { minAccuracy: 80, maxFrequency: 10 },
        scheduleInterval: 5
      },
      notificationSettings: body.notificationSettings || existingSettings.notificationSettings || {
        enableAutoTradeAlerts: false,
        enableAccuracyAlerts: false,
        enableWhaleAlerts: false,
        tradeConfirmationRequired: false,
        notificationSounds: false,
        notificationVibration: false
      },
      updatedAt: admin.firestore.Timestamp.now()
    };

    await firestoreAdapter.saveSettings(user.uid, safeBody);

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

      // Get user provider settings from Firestore
      const userProviderSettings = await firestoreAdapter.getUserProviderSettings(user.uid) || {};

      // Merge backend config with user settings
      const mergedProviders = {
        marketData: {
          primary: {
            ...API_PROVIDERS_CONFIG.marketData.primary,
            enabled: userProviderSettings.marketData?.primary?.enabled ?? true, // Primary always enabled by default
            apiKeyPresent: !!userProviderSettings.marketData?.primary?.encryptedApiKey
          },
          backups: API_PROVIDERS_CONFIG.marketData.backups.map(backup => ({
            ...backup,
            enabled: userProviderSettings.marketData?.backups?.[backup.id]?.enabled ?? false,
            apiKeyPresent: !!userProviderSettings.marketData?.backups?.[backup.id]?.encryptedApiKey
          }))
        },
        news: {
          primary: {
            ...API_PROVIDERS_CONFIG.news.primary,
            enabled: userProviderSettings.news?.primary?.enabled ?? true, // Primary always enabled by default
            apiKeyPresent: !!userProviderSettings.news?.primary?.encryptedApiKey
          },
          backups: API_PROVIDERS_CONFIG.news.backups.map(backup => ({
            ...backup,
            enabled: userProviderSettings.news?.backups?.[backup.id]?.enabled ?? false,
            apiKeyPresent: !!userProviderSettings.news?.backups?.[backup.id]?.encryptedApiKey
          }))
        },
        metadata: {
          primary: {
            ...API_PROVIDERS_CONFIG.metadata.primary,
            enabled: userProviderSettings.metadata?.primary?.enabled ?? true, // Primary always enabled by default
            apiKeyPresent: !!userProviderSettings.metadata?.primary?.encryptedApiKey
          },
          backups: API_PROVIDERS_CONFIG.metadata.backups.map(backup => ({
            ...backup,
            enabled: userProviderSettings.metadata?.backups?.[backup.id]?.enabled ?? false,
            apiKeyPresent: !!userProviderSettings.metadata?.backups?.[backup.id]?.encryptedApiKey
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

      // Update settings
      if (isPrimary) {
        if (!userProviderSettings[providerType]) {
          userProviderSettings[providerType] = { primary: {}, backups: {} };
        }
        userProviderSettings[providerType].primary = {
          ...userProviderSettings[providerType].primary,
          encryptedApiKey,
          updatedAt: new Date()
        };
      } else {
        if (!userProviderSettings[providerType]) {
          userProviderSettings[providerType] = { primary: {}, backups: {} };
        }
        if (!userProviderSettings[providerType].backups) {
          userProviderSettings[providerType].backups = {};
        }
        userProviderSettings[providerType].backups[providerId] = {
          ...userProviderSettings[providerType].backups[providerId],
          encryptedApiKey,
          updatedAt: new Date()
        };
      }

      // Save to Firestore
      await firestoreAdapter.saveUserProviderSettings(user.uid, userProviderSettings);

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

      // Encrypt API key if provided
      let encryptedApiKey = undefined;
      if (apiKey) {
        encryptedApiKey = keyManager.encrypt(apiKey);
      }

      // Update settings
      if (isPrimary) {
        userProviderSettings[type].primary = {
          ...userProviderSettings[type].primary,
          enabled,
          encryptedApiKey,
          updatedAt: new Date()
        };
      } else {
        if (!userProviderSettings[type].backups) {
          userProviderSettings[type].backups = {};
        }
        userProviderSettings[type].backups[providerId] = {
          ...userProviderSettings[type].backups[providerId],
          enabled,
          encryptedApiKey,
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

      await firestoreAdapter.saveTradingSettings(user.uid, body);
      return { message: 'Trading settings updated successfully' };
    } catch (err: any) {
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
        { id: 'newsdataio', name: 'NewsData.io', requiresKey: true },
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
      const settings = await firestoreAdapter.getSettings(uid);
      if (!settings || !settings.autoTradeEnabled) {
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
  fastify.get('/settings/notifications', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const settings = await firestoreAdapter.getSettings(user.uid) || {} as any;

      // Check prerequisites for auto-trade alerts
      const prereqMet = await checkAutoTradeAlertsPrerequisites(user.uid);

      const notifications = settings.notifications || {
        autoTradeAlerts: false,
        accuracyAlerts: { enabled: false, threshold: 80 },
        whaleAlerts: { enabled: false, sensitivity: 'medium' },
        requireTradeConfirmation: false,
        soundEnabled: false,
        vibrateEnabled: false,
        telegramEnabled: false
      };

      return {
        ...notifications,
        autoTradeAlertsPrereqMet: prereqMet.met,
        autoTradeAlertsPrereqMissing: prereqMet.missing
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error loading notification settings' });
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
  fastify.post('/settings/notifications', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = notificationsSchema.parse(request.body);

      // Validate telegram settings
      if (body.telegramEnabled) {
        if (!body.telegramChatId?.trim()) {
          return reply.code(400).send({ error: 'Telegram Chat ID is required when Telegram is enabled' });
        }
        // Note: botToken validation will be handled by the frontend
      }

      // Get existing settings to merge
      const existingSettings = await firestoreAdapter.getSettings(user.uid) || {};

      // Update notifications
      const updatedSettings = {
        ...existingSettings,
        notifications: body,
        updatedAt: admin.firestore.Timestamp.now()
      };

      await firestoreAdapter.saveSettings(user.uid, updatedSettings);
      return { message: 'Notification settings updated successfully' };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error saving notification settings' });
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
    const newSettings = request.body;

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

