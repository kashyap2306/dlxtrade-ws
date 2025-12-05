import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { z } from 'zod';
import { accuracyEngine } from '../services/accuracyEngine';
import { API_PROVIDERS_CONFIG, ProviderConfig } from '../config/apiProviders';
import { keyManager } from '../services/keyManager';
import { ProviderTester } from '../services/providerTester';
import * as admin from 'firebase-admin';

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
  accuracyAlerts: z.boolean().optional(),
  whaleAlerts: z.boolean().optional(),
  confirmBeforeTrade: z.boolean().optional(),
  playSound: z.boolean().optional(),
  vibrate: z.boolean().optional(),
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

  // Load user settings
  fastify.get('/settings/load', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const settings = await firestoreAdapter.getSettings(user.uid);

    // Get user provider settings
    const userProviderSettings = await firestoreAdapter.getUserProviderSettings(user.uid) || {};

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

    return safeSettings;
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
      coinSelectionMode: 'manual',
      selectedCoins: [],
      maxPositionPct: 10,
      tradeType: 'scalping',
      accuracyTrigger: 85,
      maxDailyLossPct: 5,
      maxTradesPerDay: 50,
      autoTradeIntervalMinutes: 5,
      positionSizingMap: {
        '0-84': 0,
        '85-89': 3,
        '90-94': 6,
        '95-99': 8.5,
        '100': 10
      }
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
      positionSizingMap: body.positionSizingMap || {
        '0-84': 0,
        '85-89': 3,
        '90-94': 6,
        '95-99': 8.5,
        '100': 10
      }
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
        providerId: z.string(),
        providerType: z.enum(['marketData', 'news', 'metadata']),
        isPrimary: z.boolean(),
        enabled: z.boolean(),
        apiKey: z.string().optional()
      }).parse(request.body);

      const { providerId, providerType, isPrimary, enabled, apiKey } = body;

      // Get current user settings
      const userProviderSettings = await firestoreAdapter.getUserProviderSettings(user.uid) || {};

      // Initialize provider type if not exists
      if (!userProviderSettings[providerType]) {
        userProviderSettings[providerType] = { primary: {}, backups: {} };
      }

      const providerPath = isPrimary ? 'primary' : `backups.${providerId}`;

      // Validate API key requirement
      const providerConfig = isPrimary
        ? API_PROVIDERS_CONFIG[providerType].primary
        : API_PROVIDERS_CONFIG[providerType].backups.find(p => p.id === providerId);

      if (!providerConfig) {
        return reply.code(400).send({ error: 'Invalid provider configuration' });
      }

      if (providerConfig.apiKeyRequired && enabled && !apiKey) {
        return reply.code(400).send({ error: `API key is required for ${providerConfig.providerName}` });
      }

      // Encrypt API key if provided
      let encryptedApiKey = undefined;
      if (apiKey) {
        encryptedApiKey = keyManager.encrypt(apiKey);
      }

      // Update settings
      if (isPrimary) {
        userProviderSettings[providerType].primary = {
          ...userProviderSettings[providerType].primary,
          enabled,
          encryptedApiKey,
          updatedAt: new Date()
        };
      } else {
        if (!userProviderSettings[providerType].backups) {
          userProviderSettings[providerType].backups = {};
        }
        userProviderSettings[providerType].backups[providerId] = {
          ...userProviderSettings[providerType].backups[providerId],
          enabled,
          encryptedApiKey,
          updatedAt: new Date()
        };
      }

      // Save to Firestore
      await firestoreAdapter.saveUserProviderSettings(user.uid, userProviderSettings);

      return {
        success: true,
        message: `${providerConfig.providerName} ${enabled ? 'enabled' : 'disabled'} successfully`
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
          ok: true,
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
        ok: result.success,
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

  // Notifications Settings Routes
  // GET /api/settings/notifications - Get notification settings
  fastify.get('/settings/notifications', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const settings = await firestoreAdapter.getSettings(user.uid) || {} as any;

      return settings.notifications || {
        autoTradeAlerts: false,
        accuracyAlerts: false,
        whaleAlerts: false,
        confirmBeforeTrade: false,
        playSound: false,
        vibrate: false
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error loading notification settings' });
    }
  });

  // POST /api/settings/notifications - Update notification settings
  fastify.post('/settings/notifications', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = notificationsSchema.parse(request.body);

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
}

