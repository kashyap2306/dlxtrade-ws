"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userEngineManager = void 0;
const binanceAdapter_1 = require("./binanceAdapter");
const accuracyEngine_1 = require("./accuracyEngine");
const hftEngine_1 = require("./hftEngine");
const orderManager_1 = require("./orderManager");
const firestoreAdapter_1 = require("./firestoreAdapter");
const logger_1 = require("../utils/logger");
class UserEngineManager {
    constructor() {
        this.userEngines = new Map();
    }
    async createUserEngine(uid, apiKey, apiSecret, testnet = true) {
        // Stop existing engine if running
        await this.stopUserEngine(uid);
        // Create new adapter
        const adapter = new binanceAdapter_1.BinanceAdapter(apiKey, apiSecret, testnet);
        // Create per-user services
        const orderManager = new orderManager_1.OrderManager();
        orderManager.setAdapter(adapter);
        // Create per-user accuracy engine (for AI/Level trading)
        const accuracyEngine = new accuracyEngine_1.AccuracyEngine();
        accuracyEngine.setAdapter(adapter);
        accuracyEngine.setUserId(uid);
        accuracyEngine.setOrderManager(orderManager);
        // Create per-user HFT engine (completely isolated from AI engine)
        const hftEngine = new hftEngine_1.HFTEngine();
        hftEngine.setAdapter(adapter);
        hftEngine.setOrderManager(orderManager);
        hftEngine.setUserId(uid);
        // Research engine is a singleton but uses uid parameter and adapter parameter for all operations
        // It will fetch user-specific integrations when called with uid
        // The adapter is passed per-call to ensure proper isolation
        const engine = {
            adapter,
            accuracyEngine,
            hftEngine,
            orderManager,
            isRunning: false,
            autoTradeEnabled: false,
        };
        this.userEngines.set(uid, engine);
        logger_1.logger.info({ uid }, 'User engine created');
        return engine;
    }
    getUserEngine(uid) {
        return this.userEngines.get(uid) || null;
    }
    async stopUserEngine(uid) {
        const engine = this.userEngines.get(uid);
        if (!engine)
            return;
        try {
            if (engine.isRunning) {
                await engine.accuracyEngine.stop();
            }
            engine.adapter.disconnect();
            this.userEngines.delete(uid);
            logger_1.logger.info({ uid }, 'User engine stopped and removed');
        }
        catch (err) {
            logger_1.logger.error({ err, uid }, 'Error stopping user engine');
        }
    }
    async startUserEngine(uid, symbol, researchIntervalMs = 5000) {
        const engine = this.userEngines.get(uid);
        if (!engine) {
            throw new Error('User engine not initialized. Call createUserEngine first.');
        }
        if (engine.isRunning) {
            throw new Error('User engine already running');
        }
        await engine.accuracyEngine.start(symbol, researchIntervalMs);
        engine.isRunning = true;
        logger_1.logger.info({ uid, symbol }, 'User engine started');
    }
    async stopUserEngineRunning(uid) {
        const engine = this.userEngines.get(uid);
        if (!engine || !engine.isRunning)
            return;
        await engine.accuracyEngine.stop();
        engine.isRunning = false;
        logger_1.logger.info({ uid }, 'User engine stopped');
    }
    getOrderManager(uid) {
        const engine = this.userEngines.get(uid);
        return engine?.orderManager || null;
    }
    getAccuracyEngine(uid) {
        const engine = this.userEngines.get(uid);
        return engine?.accuracyEngine || null;
    }
    getHFTEngine(uid) {
        const engine = this.userEngines.get(uid);
        return engine?.hftEngine || null;
    }
    async startHFT(uid) {
        // Validate Binance integration exists and is enabled
        const integrations = await firestoreAdapter_1.firestoreAdapter.getEnabledIntegrations(uid);
        if (!integrations.binance || !integrations.binance.apiKey || !integrations.binance.secretKey) {
            throw new Error('Binance integration not configured or not enabled');
        }
        // Get HFT settings
        const hftSettings = await firestoreAdapter_1.firestoreAdapter.getHFTSettings(uid);
        if (!hftSettings || !hftSettings.enabled) {
            throw new Error('HFT not enabled in settings');
        }
        // Get or create engine
        let engine = this.userEngines.get(uid);
        if (!engine) {
            // Create engine with API keys
            await this.createUserEngine(uid, integrations.binance.apiKey, integrations.binance.secretKey, true);
            engine = this.userEngines.get(uid);
        }
        // Validate API key permissions
        const validation = await engine.adapter.validateApiKey();
        if (!validation.valid || !validation.canTrade) {
            throw new Error(`API key validation failed: ${validation.error || 'Cannot trade'}`);
        }
        // Get symbol from HFT settings
        const symbol = hftSettings.symbol || 'BTCUSDT';
        // Start HFT engine (100ms interval for high frequency)
        await engine.hftEngine.start(symbol, 100);
        logger_1.logger.info({ uid, symbol }, 'HFT engine started');
    }
    async stopHFT(uid) {
        const engine = this.userEngines.get(uid);
        if (engine) {
            await engine.hftEngine.stop();
        }
        logger_1.logger.info({ uid }, 'HFT engine stopped');
    }
    getHFTStatus(uid) {
        const engine = this.userEngines.get(uid);
        if (!engine) {
            return { running: false, hasEngine: false };
        }
        return engine.hftEngine.getStatus();
    }
    getUserEngineStatus(uid) {
        const engine = this.userEngines.get(uid);
        return {
            running: engine?.isRunning || false,
            hasEngine: !!engine,
        };
    }
    async startAutoTrade(uid) {
        // Validate Binance integration exists and is enabled
        const integrations = await firestoreAdapter_1.firestoreAdapter.getEnabledIntegrations(uid);
        if (!integrations.binance || !integrations.binance.apiKey || !integrations.binance.secretKey) {
            throw new Error('Binance integration not configured or not enabled');
        }
        // Get settings
        const settings = await firestoreAdapter_1.firestoreAdapter.getSettings(uid);
        if (!settings || !settings.autoTradeEnabled) {
            throw new Error('Auto-trade not enabled in settings');
        }
        // Check if live mode is enabled and global flag
        const liveMode = settings.liveMode || false;
        const enableLiveTrades = process.env.ENABLE_LIVE_TRADES === 'true';
        if (liveMode && !enableLiveTrades) {
            throw new Error('Live trading is disabled globally. Set ENABLE_LIVE_TRADES=true to enable.');
        }
        // Determine testnet mode
        const testnet = !liveMode || process.env.BINANCE_TESTNET === 'true';
        // Get or create engine
        let engine = this.userEngines.get(uid);
        if (!engine) {
            // Create engine with API keys
            await this.createUserEngine(uid, integrations.binance.apiKey, integrations.binance.secretKey, testnet);
            engine = this.userEngines.get(uid);
        }
        // Validate API key permissions
        const validation = await engine.adapter.validateApiKey();
        if (!validation.valid || !validation.canTrade) {
            throw new Error(`API key validation failed: ${validation.error || 'Cannot trade'}`);
        }
        if (validation.canWithdraw && liveMode) {
            logger_1.logger.warn({ uid }, 'API key has withdrawal permission - this is a security risk');
            // In production, you might want to block this or require additional confirmation
        }
        // Get symbol from settings
        const symbol = settings.symbol || 'BTCUSDT';
        // Start the engine
        await this.startUserEngine(uid, symbol, 5000);
        engine.autoTradeEnabled = true;
        logger_1.logger.info({ uid, symbol, testnet, liveMode }, 'Auto-trade started');
    }
    async stopAutoTrade(uid) {
        await this.stopUserEngineRunning(uid);
        const engine = this.userEngines.get(uid);
        if (engine) {
            engine.autoTradeEnabled = false;
        }
        logger_1.logger.info({ uid }, 'Auto-trade stopped');
    }
}
exports.userEngineManager = new UserEngineManager();
