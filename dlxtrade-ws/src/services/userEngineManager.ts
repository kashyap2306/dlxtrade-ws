import { BinanceAdapter } from './binanceAdapter';
import { AccuracyEngine } from './accuracyEngine';
import { HFTEngine } from './hftEngine';
import { researchEngine } from './researchEngine';
import { OrderManager } from './orderManager';
import { firestoreAdapter } from './firestoreAdapter';
import { decrypt } from './keyManager';
import { logger } from '../utils/logger';
import { config } from '../config';

interface UserEngine {
  adapter: BinanceAdapter;
  accuracyEngine: AccuracyEngine;
  hftEngine: HFTEngine;
  orderManager: OrderManager;
  isRunning: boolean;
  autoTradeEnabled: boolean;
}

class UserEngineManager {
  private userEngines: Map<string, UserEngine> = new Map();

  async createUserEngine(uid: string, apiKey: string, apiSecret: string, testnet: boolean = true): Promise<UserEngine> {
    // Stop existing engine if running
    await this.stopUserEngine(uid);

    // Create new adapter
    const adapter = new BinanceAdapter(apiKey, apiSecret, testnet);

    // Create per-user services
    const orderManager = new OrderManager();
    orderManager.setAdapter(adapter);

    // Create per-user accuracy engine (for AI/Level trading)
    const accuracyEngine = new AccuracyEngine();
    accuracyEngine.setAdapter(adapter);
    accuracyEngine.setUserId(uid);
    accuracyEngine.setOrderManager(orderManager);
    
    // Create per-user HFT engine (completely isolated from AI engine)
    const hftEngine = new HFTEngine();
    hftEngine.setAdapter(adapter);
    hftEngine.setOrderManager(orderManager);
    hftEngine.setUserId(uid);
    
    // Research engine is a singleton but uses uid parameter and adapter parameter for all operations
    // It will fetch user-specific integrations when called with uid
    // The adapter is passed per-call to ensure proper isolation

    const engine: UserEngine = {
      adapter,
      accuracyEngine,
      hftEngine,
      orderManager,
      isRunning: false,
      autoTradeEnabled: false,
    };

    this.userEngines.set(uid, engine);
    logger.info({ uid }, 'User engine created');

    return engine;
  }

  getUserEngine(uid: string): UserEngine | null {
    return this.userEngines.get(uid) || null;
  }

  async stopUserEngine(uid: string): Promise<void> {
    const engine = this.userEngines.get(uid);
    if (!engine) return;

    try {
      if (engine.isRunning) {
        await engine.accuracyEngine.stop();
      }
      engine.adapter.disconnect();
      this.userEngines.delete(uid);
      logger.info({ uid }, 'User engine stopped and removed');
    } catch (err) {
      logger.error({ err, uid }, 'Error stopping user engine');
    }
  }

  async startUserEngine(uid: string, symbol: string, researchIntervalMs: number = 5000): Promise<void> {
    const engine = this.userEngines.get(uid);
    if (!engine) {
      throw new Error('User engine not initialized. Call createUserEngine first.');
    }

    if (engine.isRunning) {
      throw new Error('User engine already running');
    }

    await engine.accuracyEngine.start(symbol, researchIntervalMs);
    engine.isRunning = true;
    logger.info({ uid, symbol }, 'User engine started');
  }

  async stopUserEngineRunning(uid: string): Promise<void> {
    const engine = this.userEngines.get(uid);
    if (!engine || !engine.isRunning) return;

    await engine.accuracyEngine.stop();
    engine.isRunning = false;
    logger.info({ uid }, 'User engine stopped');
  }

  getOrderManager(uid: string): OrderManager | null {
    const engine = this.userEngines.get(uid);
    return engine?.orderManager || null;
  }

  getAccuracyEngine(uid: string): AccuracyEngine | null {
    const engine = this.userEngines.get(uid);
    return engine?.accuracyEngine || null;
  }

  getHFTEngine(uid: string): HFTEngine | null {
    const engine = this.userEngines.get(uid);
    return engine?.hftEngine || null;
  }

  async startHFT(uid: string): Promise<void> {
    // Validate Binance integration exists and is enabled
    const integrations = await firestoreAdapter.getEnabledIntegrations(uid);
    if (!integrations.binance || !integrations.binance.apiKey || !integrations.binance.secretKey) {
      throw new Error('Binance integration not configured or not enabled');
    }

    // Get HFT settings
    const hftSettings = await firestoreAdapter.getHFTSettings(uid);
    if (!hftSettings || !hftSettings.enabled) {
      throw new Error('HFT not enabled in settings');
    }

    // Get or create engine
    let engine = this.userEngines.get(uid);
    if (!engine) {
      // Create engine with API keys
      await this.createUserEngine(uid, integrations.binance.apiKey, integrations.binance.secretKey!, true);
      engine = this.userEngines.get(uid)!;
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

    logger.info({ uid, symbol }, 'HFT engine started');
  }

  async stopHFT(uid: string): Promise<void> {
    const engine = this.userEngines.get(uid);
    if (engine) {
      await engine.hftEngine.stop();
    }
    logger.info({ uid }, 'HFT engine stopped');
  }

  getHFTStatus(uid: string): { running: boolean; hasEngine: boolean } {
    const engine = this.userEngines.get(uid);
    if (!engine) {
      return { running: false, hasEngine: false };
    }
    return engine.hftEngine.getStatus();
  }

  getUserEngineStatus(uid: string): { running: boolean; hasEngine: boolean } {
    const engine = this.userEngines.get(uid);
    return {
      running: engine?.isRunning || false,
      hasEngine: !!engine,
    };
  }

  async startAutoTrade(uid: string): Promise<void> {
    // Validate Binance integration exists and is enabled
    const integrations = await firestoreAdapter.getEnabledIntegrations(uid);
    if (!integrations.binance || !integrations.binance.apiKey || !integrations.binance.secretKey) {
      throw new Error('Binance integration not configured or not enabled');
    }

    // Get settings
    const settings = await firestoreAdapter.getSettings(uid);
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
      await this.createUserEngine(uid, integrations.binance.apiKey, integrations.binance.secretKey!, testnet);
      engine = this.userEngines.get(uid)!;
    }

    // Validate API key permissions
    const validation = await engine.adapter.validateApiKey();
    if (!validation.valid || !validation.canTrade) {
      throw new Error(`API key validation failed: ${validation.error || 'Cannot trade'}`);
    }

    if (validation.canWithdraw && liveMode) {
      logger.warn({ uid }, 'API key has withdrawal permission - this is a security risk');
      // In production, you might want to block this or require additional confirmation
    }

    // Get symbol from settings
    const symbol = settings.symbol || 'BTCUSDT';

    // Start the engine
    await this.startUserEngine(uid, symbol, 5000);
    engine.autoTradeEnabled = true;

    logger.info({ uid, symbol, testnet, liveMode }, 'Auto-trade started');
  }

  async stopAutoTrade(uid: string): Promise<void> {
    await this.stopUserEngineRunning(uid);
    const engine = this.userEngines.get(uid);
    if (engine) {
      engine.autoTradeEnabled = false;
    }
    logger.info({ uid }, 'Auto-trade stopped');
  }
}

export const userEngineManager = new UserEngineManager();

