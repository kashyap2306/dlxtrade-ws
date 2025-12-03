import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { BinanceAdapter } from './binanceAdapter';
import { decrypt } from './keyManager';
import { getFirebaseAdmin } from '../utils/firebase';
import * as admin from 'firebase-admin';

// Trading Settings Interface
export interface TradingSettings {
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
}

// Position Sizing Result
export interface PositionSizingResult {
  positionPercent: number;
  reason: string;
}

export interface AutoTradeConfig {
  autoTradeEnabled: boolean;
  perTradeRiskPct: number; // percent of account equity per trade (default 1)
  maxConcurrentTrades: number; // default 3
  maxDailyLossPct: number; // stop trading if loss exceeds (default 5)
  stopLossPct: number; // default 1.5
  takeProfitPct: number; // default 3
  manualOverride: boolean; // when true, engine pauses for user actions
  mode: 'AUTO' | 'MANUAL';
  maxTradesPerDay?: number; // max trades per day
  cooldownSeconds?: number; // cooldown between trades in seconds
  panicStopEnabled?: boolean; // enable panic stop functionality
  slippageBlocker?: boolean; // enable slippage protection
  lastRun?: Date;
  stats?: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalPnL: number;
    dailyPnL: number;
    dailyTrades: number;
  };
  equitySnapshot?: number;
}

export interface TradeSignal {
  symbol: string;
  signal: 'BUY' | 'SELL';
  entryPrice: number;
  accuracy: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
  requestId: string;
  timestamp: Date;
}

export interface TradeExecution {
  tradeId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  status: 'PENDING' | 'FILLED' | 'CANCELLED' | 'REJECTED';
  orderId?: string;
  fillPrice?: number;
  pnl?: number;
  timestamp: Date;
  mode: 'AUTO' | 'MANUAL';
  takeProfitOrderId?: string;
  stopLossOrderId?: string;
  takeProfitPct?: number;
  stopLossPct?: number;
}

const DEFAULT_CONFIG: AutoTradeConfig = {
  autoTradeEnabled: false,
  perTradeRiskPct: 1, // 1% of equity per trade
  maxConcurrentTrades: 3,
  maxDailyLossPct: 5, // 5% max daily loss
  stopLossPct: 1.5, // 1.5% stop loss
  takeProfitPct: 3, // 3% take profit
  manualOverride: false,
  mode: 'MANUAL', // Start in manual mode for safety
  maxTradesPerDay: 50,
  cooldownSeconds: 30,
  panicStopEnabled: false,
  slippageBlocker: false,
  stats: {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    totalPnL: 0,
    dailyPnL: 0,
    dailyTrades: 0,
  },
};

export class AutoTradeEngine {
  private userEngines: Map<string, {
    config: AutoTradeConfig;
    adapter: BinanceAdapter | null;
    activeTrades: Map<string, TradeExecution>;
    circuitBreaker: boolean;
    lastEquityCheck: Date;
  }> = new Map();

  // Auto-trade background loop tracking
  private autoTradeLoops: Map<string, {
    intervalId: NodeJS.Timeout | null;
    isRunning: boolean;
    lastResearchTime: Date | null;
    researchInProgress: boolean;
  }> = new Map();

  /**
   * Get or create user engine instance
   */
  private async getUserEngine(uid: string): Promise<{
    config: AutoTradeConfig;
    adapter: BinanceAdapter | null;
    activeTrades: Map<string, TradeExecution>;
    circuitBreaker: boolean;
    lastEquityCheck: Date;
  }> {
    if (!this.userEngines.has(uid)) {
      const config = await this.loadConfig(uid);
      this.userEngines.set(uid, {
        config,
        adapter: null,
        activeTrades: new Map(),
        circuitBreaker: false,
        lastEquityCheck: new Date(0),
      });
    }
    return this.userEngines.get(uid)!;
  }

  /**
   * Load user configuration from Firestore
   */
  async loadConfig(uid: string): Promise<AutoTradeConfig> {
    try {
      const db = getFirebaseAdmin().firestore();
      const configDoc = await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').get();
      
      if (configDoc.exists) {
        const data = configDoc.data()!;
        return {
          ...DEFAULT_CONFIG,
          ...data,
          lastRun: data.lastRun?.toDate(),
          stats: data.stats || DEFAULT_CONFIG.stats,
        } as AutoTradeConfig;
      }
      
      // Create default config if doesn't exist
      await this.saveConfig(uid, DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error loading auto-trade config');
      return DEFAULT_CONFIG;
    }
  }

  /**
   * Save user configuration to Firestore
   */
  async saveConfig(uid: string, config: Partial<AutoTradeConfig>): Promise<AutoTradeConfig> {
    try {
      const db = getFirebaseAdmin().firestore();
      const currentConfig = await this.loadConfig(uid);
      const updatedConfig = { ...currentConfig, ...config, lastRun: new Date() };
      
      // Save to Firestore with all fields
      const configDoc = {
        autoTradeEnabled: updatedConfig.autoTradeEnabled,
        perTradeRiskPct: updatedConfig.perTradeRiskPct,
        maxConcurrentTrades: updatedConfig.maxConcurrentTrades,
        maxDailyLossPct: updatedConfig.maxDailyLossPct,
        stopLossPct: updatedConfig.stopLossPct,
        takeProfitPct: updatedConfig.takeProfitPct,
        manualOverride: updatedConfig.manualOverride,
        mode: updatedConfig.mode,
        maxTradesPerDay: updatedConfig.maxTradesPerDay || DEFAULT_CONFIG.maxTradesPerDay,
        cooldownSeconds: updatedConfig.cooldownSeconds || DEFAULT_CONFIG.cooldownSeconds,
        panicStopEnabled: updatedConfig.panicStopEnabled || DEFAULT_CONFIG.panicStopEnabled,
        slippageBlocker: updatedConfig.slippageBlocker || DEFAULT_CONFIG.slippageBlocker,
        stats: updatedConfig.stats || DEFAULT_CONFIG.stats,
        equitySnapshot: updatedConfig.equitySnapshot,
        lastRun: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
      };
      
      await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').set(configDoc, { merge: true });

      logger.info({ uid, config: configDoc }, 'Auto-trade config saved to Firestore');

      // Update in-memory config
      const engine = await this.getUserEngine(uid);
      engine.config = updatedConfig as AutoTradeConfig;
      
      return updatedConfig as AutoTradeConfig;
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack, uid }, 'Error saving auto-trade config');
      throw error;
    }
  }

  /**
   * Initialize adapter for user (load API keys securely using unified resolver)
   * Supports all exchanges: binance, bitget, bingx, weex
   */
  async initializeAdapter(uid: string): Promise<any> {
    try {
      const { resolveExchangeConnector } = await import('./exchangeResolver');
      const resolved = await resolveExchangeConnector(uid);
      
      if (!resolved) {
        logger.warn({ uid }, 'No exchange API credentials found for auto-trade');
        return null;
      }
      
      const { connector, exchange } = resolved;
      
      // Validate connector has required methods
      if (!connector || typeof connector.placeOrder !== 'function') {
        logger.error({ uid, exchange }, 'Exchange connector missing required methods');
        return null;
      }
      
      // For Binance, optionally validate API key permissions
      if (exchange === 'binance' && typeof connector.validateApiKey === 'function') {
        try {
          const validation = await connector.validateApiKey();
          if (!validation.valid || !validation.canTrade) {
            logger.error({ uid, exchange }, 'API key validation failed - insufficient permissions');
            return null;
          }
        } catch (valError: any) {
          logger.warn({ uid, exchange, error: valError.message }, 'API key validation error, continuing anyway');
        }
      }
      
      const engine = await this.getUserEngine(uid);
      engine.adapter = connector;
      
      logger.info({ uid, exchange }, 'Auto-trade adapter initialized successfully');
      return connector;
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack, uid }, 'Error initializing adapter');
      return null;
    }
  }

  /**
   * Calculate position size based on risk management
   */
  calculatePositionSize(
    equity: number,
    entryPrice: number,
    stopLossPct: number,
    perTradeRiskPct: number
  ): number {
    // Risk amount = perTradeRiskPct% of equity
    const riskAmount = equity * (perTradeRiskPct / 100);
    
    // Stop loss distance in price terms
    const stopLossDistance = entryPrice * (stopLossPct / 100);
    
    // Position size = risk amount / stop loss distance
    const positionSize = riskAmount / stopLossDistance;
    
    // Round down to avoid over-leveraging
    return Math.floor(positionSize * 100) / 100;
  }

  /**
   * Check risk guards before placing order
   */
  async checkRiskGuards(uid: string, signal: TradeSignal): Promise<{ allowed: boolean; reason?: string }> {
    const engine = await this.getUserEngine(uid);
    const config = engine.config;

    // MANDATORY RISK GUARDS - Before any other checks

    // 1. Check accuracy trigger
    const settings = await AutoTradeEngine.getTradingSettings(uid);
    if (signal.accuracy < settings.accuracyTrigger) {
      return { allowed: false, reason: `ACCURACY_TRIGGER: ${signal.accuracy}% < ${settings.accuracyTrigger}% threshold` };
    }

    // 2. Check daily loss limit
    const stats = config.stats || DEFAULT_CONFIG.stats!;
    const equity = config.equitySnapshot || 1000;
    const maxDailyLossAmount = equity * (settings.maxDailyLoss / 100);
    if (stats.dailyPnL < 0 && Math.abs(stats.dailyPnL) >= maxDailyLossAmount) {
      engine.circuitBreaker = true;
      await this.logTradeEvent(uid, 'CIRCUIT_BREAKER_TRIGGERED', {
        reason: 'Daily loss limit exceeded',
        dailyPnL: stats.dailyPnL,
        maxDailyLoss: settings.maxDailyLoss,
      });
      return { allowed: false, reason: `DAILY_LOSS_LIMIT: ${Math.abs(stats.dailyPnL)} >= ${maxDailyLossAmount} (${settings.maxDailyLoss}% of ${equity})` };
    }

    // 3. Check max trades per day
    if (stats.dailyTrades >= settings.maxTradesPerDay) {
      return { allowed: false, reason: `MAX_TRADES_PER_DAY: ${stats.dailyTrades} >= ${settings.maxTradesPerDay} limit` };
    }

    // 4. Check position size validity (calculated later, but validate here)
    const positionSizing = AutoTradeEngine.calculatePositionSize(signal.accuracy, settings);
    if (positionSizing.positionPercent <= 0) {
      return { allowed: false, reason: `INVALID_POSITION_SIZE: ${positionSizing.positionPercent}% <= 0` };
    }

    // 5. Cap position size at maxPositionPerTrade
    const finalPositionPercent = Math.min(positionSizing.positionPercent, settings.maxPositionPerTrade);

    // EXISTING GUARDS

    // Check circuit breaker
    if (engine.circuitBreaker) {
      return { allowed: false, reason: 'CIRCUIT_BREAKER_ACTIVE: Daily loss limit exceeded' };
    }

    // Check manual override
    if (config.manualOverride) {
      return { allowed: false, reason: 'MANUAL_OVERRIDE_ACTIVE: Trading paused by user' };
    }

    // Check if auto-trade is enabled
    if (!config.autoTradeEnabled) {
      return { allowed: false, reason: 'AUTO_TRADE_DISABLED: Auto-trading is not enabled' };
    }

    // Check max concurrent trades
    if (engine.activeTrades.size >= config.maxConcurrentTrades) {
      return { allowed: false, reason: `MAX_CONCURRENT_TRADES: ${engine.activeTrades.size} >= ${config.maxConcurrentTrades} limit` };
    }

    // Additional safety checks

    // Check if already have position in this symbol
    for (const trade of engine.activeTrades.values()) {
      if (trade.symbol === signal.symbol && trade.status === 'FILLED') {
        return { allowed: false, reason: `Already have active position in ${signal.symbol}` };
      }
    }

    return { allowed: true };
  }

  /**
   * Execute trade
   */
  async executeTrade(uid: string, signal: TradeSignal): Promise<TradeExecution> {
    const requestId = signal.requestId || `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    logger.info({ uid, symbol: signal.symbol, requestId }, 'Starting trade execution');

    // FAIL-SAFE: Load trading settings FIRST and validate all required fields
    let settings: TradingSettings;
    try {
      settings = await AutoTradeEngine.getTradingSettings(uid);

      // Strict validation: Block if ANY required setting is undefined/null
      if (!settings ||
          settings.symbol === undefined ||
          settings.maxPositionPerTrade === undefined ||
          settings.accuracyTrigger === undefined ||
          settings.maxDailyLoss === undefined ||
          settings.maxTradesPerDay === undefined ||
          !Array.isArray(settings.positionSizingMap) ||
          settings.positionSizingMap.length === 0) {
        await this.logTradeEvent(uid, 'TRADE_REJECTED', {
          signal,
          reason: 'TRADING_SETTINGS_INVALID: One or more required trading settings are missing or invalid',
        });
        throw new Error('Trading settings validation failed - blocking trade for safety');
      }

      // Validate positionSizingMap structure
      const invalidRange = settings.positionSizingMap.find(range =>
        range.min === undefined || range.max === undefined || range.percent === undefined ||
        typeof range.min !== 'number' || typeof range.max !== 'number' || typeof range.percent !== 'number'
      );
      if (invalidRange) {
        await this.logTradeEvent(uid, 'TRADE_REJECTED', {
          signal,
          reason: 'POSITION_SIZING_MAP_INVALID: Malformed position sizing ranges detected',
        });
        throw new Error('Position sizing map validation failed - blocking trade for safety');
      }

    } catch (settingsError: any) {
      logger.error({ uid, error: settingsError.message }, 'CRITICAL: Trading settings load/validation failed');
      // If settings fail to load, stop auto-trade loop for safety
      await this.stopAutoTradeLoop(uid);
      await this.logTradeEvent(uid, 'AUTO_TRADE_STOPPED', {
        reason: 'SETTINGS_LOAD_FAILURE',
        error: settingsError.message,
      });
      throw new Error('Trading settings unavailable - auto-trade stopped for safety');
    }

    // ALWAYS load config fresh from Firestore before execution
    const config = await this.loadConfig(uid);
    const engine = await this.getUserEngine(uid);
    engine.config = config; // Update in-memory config

    // Check risk guards
    const riskCheck = await this.checkRiskGuards(uid, signal);
    if (!riskCheck.allowed) {
      await this.logTradeEvent(uid, 'TRADE_REJECTED', {
        signal,
        reason: riskCheck.reason,
      });
      throw new Error(riskCheck.reason || 'Trade rejected by risk guards');
    }

    // Check accuracy trigger from validated trading settings
    if (signal.accuracy < settings.accuracyTrigger) {
      await this.logTradeEvent(uid, 'TRADE_REJECTED', {
        signal,
        reason: `Accuracy ${signal.accuracy}% below trigger threshold ${settings.accuracyTrigger}%`,
      });
      throw new Error(`Accuracy ${signal.accuracy}% below trigger threshold ${settings.accuracyTrigger}%`);
    }

    // Initialize adapter if needed
    if (!engine.adapter) {
      await this.initializeAdapter(uid);
      if (!engine.adapter) {
        throw new Error('Failed to initialize exchange adapter');
      }
    }

    // Get current equity
    let equity = config.equitySnapshot || 1000; // Default fallback
    try {
      // Check if adapter has getAccount method (optional in interface)
      if (engine.adapter && typeof engine.adapter.getAccount === 'function') {
        const accountInfo = await engine.adapter.getAccount();
        
        // Handle different exchange response formats
        if (accountInfo.balances && Array.isArray(accountInfo.balances)) {
          // Binance format: balances array
          const usdtBalance = accountInfo.balances.find((b: any) => b.asset === 'USDT' || b.asset === 'USDT');
          if (usdtBalance) {
            const free = parseFloat(usdtBalance.free || usdtBalance.available || '0');
            const locked = parseFloat(usdtBalance.locked || usdtBalance.frozen || '0');
            equity = free + locked;
          }
        } else if (accountInfo.totalEquity) {
          // Some exchanges return totalEquity directly
          equity = parseFloat(accountInfo.totalEquity.toString());
        } else if (accountInfo.equity) {
          equity = parseFloat(accountInfo.equity.toString());
        }
        
        // If no valid equity found, use snapshot or default
        if (equity === 0 || isNaN(equity)) {
          equity = config.equitySnapshot || 1000;
        }
        
        // Update equity snapshot
        await this.saveConfig(uid, { equitySnapshot: equity });
        
        logger.info({ uid, equity, source: 'exchange' }, 'Equity fetched from exchange');
      } else {
        logger.debug({ uid }, 'Adapter does not support getAccount, using snapshot');
      }
    } catch (error: any) {
      logger.warn({ error: error.message, uid }, 'Could not fetch equity from exchange, using snapshot');
    }

    // Get trading settings for position sizing
    const tradingSettings = await AutoTradeEngine.getTradingSettings(uid);

    // Calculate position size using new accuracy-based sizing
    const positionSizing = AutoTradeEngine.calculatePositionSize(signal.accuracy, tradingSettings);

    // Convert position percentage to actual quantity
    const positionValue = equity * (positionSizing.positionPercent / 100);
    const quantity = positionValue / signal.entryPrice;

    logger.info({
      uid,
      symbol: signal.symbol,
      accuracy: signal.accuracy,
      positionPercent: positionSizing.positionPercent,
      positionValue,
      quantity,
      reason: positionSizing.reason
    }, 'Position size calculated using trading settings');

    logger.info({ 
      uid, 
      symbol: signal.symbol, 
      equity, 
      entryPrice: signal.entryPrice, 
      stopLossPct: config.stopLossPct, 
      perTradeRiskPct: config.perTradeRiskPct, 
      quantity,
      requestId 
    }, 'Position size calculated');

    if (quantity <= 0) {
      throw new Error('Calculated position size is zero or negative');
    }

    // Create trade execution record
    const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const trade: TradeExecution = {
      tradeId,
      symbol: signal.symbol,
      side: signal.signal,
      quantity,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      status: 'PENDING',
      timestamp: new Date(),
      mode: config.mode,
    };

    // Execute based on mode
    if (config.mode === 'AUTO' && !config.manualOverride) {
      // Live mode - place real order
      try {
        logger.info({ uid, symbol: signal.symbol, requestId }, 'Pre-trade validation: checking orderbook liquidity');
        
        // Pre-trade validation: orderbook liquidity & min notional
        const orderbook = await engine.adapter!.getOrderbook(signal.symbol, 5);
        const bestBid = parseFloat(orderbook.bids[0]?.price || '0');
        const bestAsk = parseFloat(orderbook.asks[0]?.price || '0');
        
        if (bestBid === 0 || bestAsk === 0) {
          throw new Error('Insufficient order book liquidity');
        }

        // Check min notional (e.g., $10 minimum for Binance)
        const notional = quantity * signal.entryPrice;
        if (notional < 10) {
          throw new Error(`Order notional (${notional.toFixed(2)}) below minimum (10)`);
        }

        logger.info({ 
          uid, 
          symbol: signal.symbol, 
          quantity, 
          entryPrice: signal.entryPrice, 
          notional,
          side: signal.signal,
          requestId 
        }, 'Placing live order');

        // Place order
        const orderResult = await engine.adapter!.placeOrder({
          symbol: signal.symbol,
          side: signal.signal,
          type: 'MARKET',
          quantity: quantity,
        });

        trade.status = 'FILLED';
        trade.orderId = orderResult.exchangeOrderId || orderResult.id;
        trade.fillPrice = parseFloat(orderResult.avgPrice?.toString() || orderResult.price?.toString() || signal.entryPrice.toString());

        // Extract base and quote currencies from symbol (e.g., BTCUSDT -> BTC, USDT)
        const baseCurrency = signal.symbol.replace('USDT', '').replace('USD', '');
        const quoteCurrency = signal.symbol.includes('USDT') ? 'USDT' : 'USD';
        const executedPrice = trade.fillPrice!;
        const executedQuantity = orderResult.quantity || quantity;

        // Place TP/SL orders if configured
        let tpOrderId: string | undefined;
        let slOrderId: string | undefined;

        try {
          if (config.takeProfitPct && config.takeProfitPct > 0) {
            const tpPrice = signal.signal === 'BUY'
              ? executedPrice * (1 + config.takeProfitPct / 100)
              : executedPrice * (1 - config.takeProfitPct / 100);

            const tpOrder = await engine.adapter!.placeOrder({
              symbol: `${baseCurrency}${quoteCurrency}`,
              side: signal.signal === 'BUY' ? 'SELL' : 'BUY',
              type: 'LIMIT',
              quantity: executedQuantity,
              price: tpPrice
            });

            tpOrderId = tpOrder.exchangeOrderId || tpOrder.clientOrderId;
            trade.takeProfitOrderId = tpOrderId;
            trade.takeProfitPct = config.takeProfitPct;

            logger.info({
              uid,
              symbol: signal.symbol,
              tpPrice,
              tpOrderId
            }, 'TP order placed');
          }

          if (config.stopLossPct && config.stopLossPct > 0) {
            const slPrice = signal.signal === 'BUY'
              ? executedPrice * (1 - config.stopLossPct / 100)
              : executedPrice * (1 + config.stopLossPct / 100);

            const slOrder = await engine.adapter!.placeOrder({
              symbol: `${baseCurrency}${quoteCurrency}`,
              side: signal.signal === 'BUY' ? 'SELL' : 'BUY',
              type: 'LIMIT',
              quantity: executedQuantity,
              price: slPrice
            });

            slOrderId = slOrder.exchangeOrderId || slOrder.clientOrderId;
            trade.stopLossOrderId = slOrderId;
            trade.stopLossPct = config.stopLossPct;

            logger.info({
              uid,
              symbol: signal.symbol,
              slPrice,
              slOrderId
            }, 'SL order placed');
          }
        } catch (tpslError: any) {
          logger.warn({
            error: tpslError.message,
            uid,
            symbol: signal.symbol
          }, 'TP/SL order placement failed, continuing with main order');
        }

        await this.logTradeEvent(uid, 'TRADE_EXECUTED', {
          trade,
          signal,
          equity,
          quantity,
          orderResult,
          requestId,
          exchangeResponse: orderResult,
          config: {
            mode: config.mode,
            perTradeRiskPct: config.perTradeRiskPct,
            stopLossPct: config.stopLossPct,
            takeProfitPct: config.takeProfitPct,
          },
          takeProfitOrderId: tpOrderId,
          stopLossOrderId: slOrderId,
        });

        logger.info({
          uid,
          tradeId,
          symbol: signal.symbol,
          orderId: trade.orderId,
          fillPrice: trade.fillPrice,
          takeProfitOrderId: tpOrderId,
          stopLossOrderId: slOrderId,
          requestId,
          mode: 'AUTO'
        }, 'Trade executed (LIVE mode)');
      } catch (error: any) {
        trade.status = 'REJECTED';
        await this.logTradeEvent(uid, 'TRADE_FAILED', {
          trade,
          signal,
          error: error.message,
          requestId,
          exchangeError: error.response?.data || error.message,
        });
        logger.error({ 
          uid, 
          tradeId, 
          symbol: signal.symbol, 
          error: error.message, 
          requestId 
        }, 'Trade execution failed');
        throw error;
      }
    } else {
      // Manual mode or override active - don't execute
      trade.status = 'CANCELLED';
      await this.logTradeEvent(uid, 'TRADE_CANCELLED', {
        trade,
        signal,
        reason: config.manualOverride ? 'Manual override active' : 'Manual mode',
        requestId,
      });
      logger.warn({ uid, symbol: signal.symbol, requestId, reason: config.manualOverride ? 'Manual override' : 'Manual mode' }, 'Trade cancelled');
      throw new Error('Trading is in manual mode or override is active');
    }

    // Store active trade
    engine.activeTrades.set(tradeId, trade);

    // Update stats
    await this.updateStats(uid, trade);

    return trade;
  }

  /**
   * Get trading settings for a user with caching
   * This is the main function the auto-trade engine calls to get current settings
   */
  static async getTradingSettings(uid: string): Promise<TradingSettings> {
    try {
      const settings = await firestoreAdapter.getTradingSettings(uid);

      if (!settings) {
        // Return default settings
        return {
          mode: 'MANUAL',
          manualCoins: ['BTCUSDT', 'ETHUSDT'],
          maxPositionPerTrade: 10,
          tradeType: 'Scalping',
          accuracyTrigger: 85,
          maxDailyLoss: 5,
          maxTradesPerDay: 50,
          positionSizingMap: [
            { min: 0, max: 84, percent: 0 },
            { min: 85, max: 89, percent: 3 },
            { min: 90, max: 94, percent: 6 },
            { min: 95, max: 99, percent: 8.5 },
            { min: 100, max: 100, percent: 10 }
          ]
        };
      }

      return settings as TradingSettings;
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error getting trading settings, using defaults');
      // Return defaults on error
      return {
        symbol: 'BTCUSDT',
        maxPositionPerTrade: 10,
        tradeType: 'Scalping',
        accuracyTrigger: 85,
        maxDailyLoss: 5,
        maxTradesPerDay: 50,
        positionSizingMap: [
          { min: 0, max: 84, percent: 0 },
          { min: 85, max: 89, percent: 3 },
          { min: 90, max: 94, percent: 6 },
          { min: 95, max: 99, percent: 8.5 },
          { min: 100, max: 100, percent: 10 }
        ]
      };
    }
  }

  /**
   * Calculate position size based on accuracy and trading settings
   * Returns the position percentage to use for the trade
   */
  static calculatePositionSize(accuracy: number, settings: TradingSettings): PositionSizingResult {
    // Check if accuracy meets the trigger threshold
    if (accuracy < settings.accuracyTrigger) {
      return {
        positionPercent: 0,
        reason: `Accuracy ${accuracy}% below trigger threshold ${settings.accuracyTrigger}%`
      };
    }

    // Find the appropriate position sizing range for this accuracy
    const range = settings.positionSizingMap.find(r => accuracy >= r.min && accuracy <= r.max);

    if (!range) {
      return {
        positionPercent: 0,
        reason: `No position sizing range found for accuracy ${accuracy}%`
      };
    }

    // If the range percent is higher than max position per trade, cap it
    const positionPercent = Math.min(range.percent, settings.maxPositionPerTrade);

    return {
      positionPercent,
      reason: `Accuracy ${accuracy}% maps to ${range.percent}% position, capped at ${settings.maxPositionPerTrade}% max per trade`
    };
  }

  /**
   * Update trade statistics
   */
  async updateStats(uid: string, trade: TradeExecution): Promise<void> {
    const engine = await this.getUserEngine(uid);
    const config = engine.config;
    const stats = config.stats || DEFAULT_CONFIG.stats!;

    // Reset daily stats if new day
    const now = new Date();
    const lastRun = config.lastRun || new Date(0);
    if (now.toDateString() !== lastRun.toDateString()) {
      stats.dailyPnL = 0;
      stats.dailyTrades = 0;
      engine.circuitBreaker = false; // Reset circuit breaker for new day
    }

    stats.totalTrades += 1;
    stats.dailyTrades += 1;

    // Calculate PnL when trade is closed (simplified for now)
    if (trade.pnl !== undefined) {
      stats.totalPnL += trade.pnl;
      stats.dailyPnL += trade.pnl;
      
      if (trade.pnl > 0) {
        stats.winningTrades += 1;
      } else {
        stats.losingTrades += 1;
      }
    }

    await this.saveConfig(uid, { stats, lastRun: now });
  }

  /**
   * Log trade event to Firestore
   */
  async logTradeEvent(uid: string, eventType: string, data: any): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      await db.collection('users').doc(uid).collection('autoTradeLogs').add({
        eventType,
        data,
        timestamp: admin.firestore.Timestamp.now(),
        userId: uid,
      });
    } catch (error: any) {
      logger.error({ error: error.message, uid, eventType }, 'Error logging trade event');
    }
  }

  /**
   * Get engine status
   */
  async getStatus(uid: string): Promise<{
    enabled: boolean;
    mode: string;
    activeTrades: number;
    dailyPnL: number;
    dailyTrades: number;
    circuitBreaker: boolean;
    manualOverride: boolean;
    equity: number;
  }> {
    const engine = await this.getUserEngine(uid);
    const config = engine.config;
    
    // Try to get current equity from exchange if adapter is available
    let equity = config.equitySnapshot || 0;
    if (engine.adapter && typeof engine.adapter.getAccount === 'function') {
      try {
        const accountInfo = await engine.adapter.getAccount();
        
        // Handle different exchange response formats
        if (accountInfo.balances && Array.isArray(accountInfo.balances)) {
          const usdtBalance = accountInfo.balances.find((b: any) => b.asset === 'USDT');
          if (usdtBalance) {
            const free = parseFloat(usdtBalance.free || usdtBalance.available || '0');
            const locked = parseFloat(usdtBalance.locked || usdtBalance.frozen || '0');
            equity = free + locked;
          }
        } else if (accountInfo.totalEquity) {
          equity = parseFloat(accountInfo.totalEquity.toString());
        } else if (accountInfo.equity) {
          equity = parseFloat(accountInfo.equity.toString());
        }
        
        if (equity > 0 && !isNaN(equity)) {
          await this.saveConfig(uid, { equitySnapshot: equity });
        }
      } catch (error: any) {
        logger.warn({ error: error.message, uid }, 'Could not fetch equity for status');
      }
    }
    
    return {
      enabled: config.autoTradeEnabled,
      mode: config.mode,
      activeTrades: engine.activeTrades.size,
      dailyPnL: config.stats?.dailyPnL || 0,
      dailyTrades: config.stats?.dailyTrades || 0,
      circuitBreaker: engine.circuitBreaker,
      manualOverride: config.manualOverride,
      equity,
    };
  }

  /**
   * Reset circuit breaker (admin only)
   */
  async resetCircuitBreaker(uid: string): Promise<void> {
    const engine = await this.getUserEngine(uid);
    engine.circuitBreaker = false;
    await this.logTradeEvent(uid, 'CIRCUIT_BREAKER_RESET', {});
  }

  /**
   * Start auto-trade background research loop for a user
   * Runs deep research every 5 minutes when enabled
   */
  async startAutoTradeLoop(uid: string): Promise<void> {
    try {
      // Check for duplicate loops and kill them
      const existingLoop = this.autoTradeLoops.get(uid);
      if (existingLoop && existingLoop.isRunning) {
        logger.warn({ uid }, '🚨 DUPLICATE_LOOP_DETECTED: Killing existing auto-trade loop before starting new one');
        await this.stopAutoTradeLoop(uid);
      }

      // Initialize loop tracking
      this.autoTradeLoops.set(uid, {
        intervalId: null,
        isRunning: true,
        lastResearchTime: null,
        researchInProgress: false,
      });

      logger.info({
        uid,
        timestamp: new Date().toISOString(),
        engineState: 'STARTING'
      }, '▶️ AUTO_TRADE_STARTED: Background research loop initiated');

      // Start the interval loop (5 minutes = 300,000 ms)
      const intervalId = setInterval(async () => {
        try {
          const loopState = this.autoTradeLoops.get(uid);
          if (!loopState || !loopState.isRunning) {
            return; // Loop was stopped
          }

          // Skip if research is already in progress
          if (loopState.researchInProgress) {
            logger.warn({ uid }, 'Skipping research cycle - previous research still in progress');
            return;
          }

          // Mark research as in progress
          loopState.researchInProgress = true;

          try {
            await this.runAutoTradeResearchCycle(uid);
            loopState.lastResearchTime = new Date();
          } finally {
            loopState.researchInProgress = false;
          }
        } catch (error: any) {
          logger.error({ error: error.message, uid }, 'Error in auto-trade research cycle');
        }
      }, 5 * 60 * 1000); // 5 minutes

      // Update the interval ID
      const loopState = this.autoTradeLoops.get(uid);
      if (loopState) {
        loopState.intervalId = intervalId;
      }

      // Run first research cycle immediately
      setTimeout(async () => {
        try {
          const loopState = this.autoTradeLoops.get(uid);
          if (loopState && loopState.isRunning && !loopState.researchInProgress) {
            loopState.researchInProgress = true;
            try {
              await this.runAutoTradeResearchCycle(uid);
              loopState.lastResearchTime = new Date();
            } finally {
              loopState.researchInProgress = false;
            }
          }
        } catch (error: any) {
          logger.error({ error: error.message, uid }, 'Error in initial auto-trade research cycle');
        }
      }, 1000); // Start after 1 second

    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error starting auto-trade loop');
      throw error;
    }
  }

  /**
   * Stop auto-trade background research loop for a user
   */
  async stopAutoTradeLoop(uid: string): Promise<void> {
    try {
      const loopState = this.autoTradeLoops.get(uid);
      if (loopState) {
        if (loopState.intervalId) {
          clearInterval(loopState.intervalId);
        }
        loopState.isRunning = false;
        loopState.researchInProgress = false;
      }

      this.autoTradeLoops.delete(uid);
      logger.info({
        uid,
        timestamp: new Date().toISOString(),
        engineState: 'STOPPED'
      }, '⏹️ AUTO_TRADE_STOPPED: Background research loop terminated');
    } catch (error: any) {
      logger.error({
        uid,
        error: error.message,
        timestamp: new Date().toISOString(),
        engineState: 'STOP_FAILED'
      }, '❌ AUTO_TRADE_STOP_ERROR: Failed to stop background research loop');
      throw error;
    }
  }

  /**
   * Check if auto-trade loop is running for a user
   */
  async isAutoTradeRunning(uid: string): Promise<boolean> {
    const loopState = this.autoTradeLoops.get(uid);
    return loopState?.isRunning || false;
  }

  /**
   * Get last research time for a user
   */
  async getLastResearchTime(uid: string): Promise<string | null> {
    const loopState = this.autoTradeLoops.get(uid);
    return loopState?.lastResearchTime?.toISOString() || null;
  }

  /**
   * Get current market price for a symbol
   */
  private async getCurrentMarketPrice(symbol: string, uid: string): Promise<number> {
    try {
      // Try to get from exchange if adapter is available
      const engine = await this.getUserEngine(uid);
      if (engine.adapter) {
        const ticker = await engine.adapter.getTicker(symbol);
        return parseFloat(ticker.price.toString());
      }
    } catch (error) {
      logger.warn({ uid, symbol, error: error.message }, 'Could not get price from exchange, using fallback');
    }

    // Fallback price (in production, would get from market data API)
    return 50000; // BTC fallback price
  }

  /**
   * Run a single auto-trade research cycle
   * This is called every 5 minutes by the background loop
   */
  private async runAutoTradeResearchCycle(uid: string): Promise<void> {
    const cycleStartTime = new Date();
    let cycleResult = 'FAILED';
    let accuracy = 0;
    let signal = 'UNKNOWN';
    let mappedPositionPercent = 0;
    let finalPositionPercent = 0;
    let skipReason = '';

    try {
      // Check if auto-trade was toggled off during scheduling
      const loopState = this.autoTradeLoops.get(uid);
      if (!loopState || !loopState.isRunning) {
        logger.info({ uid }, '⚠️ Research cycle cancelled - auto-trade was stopped');
        return;
      }

      logger.info({ uid, cycleStartTime: cycleStartTime.toISOString() }, '🔄 STARTING auto-trade research cycle');

      // Get trading settings with validation
      let settings: TradingSettings;
      try {
        settings = await AutoTradeEngine.getTradingSettings(uid);
      } catch (settingsError: any) {
        logger.error({ uid, error: settingsError.message }, 'CRITICAL: Failed to load trading settings during research cycle');
        await this.stopAutoTradeLoop(uid);
        throw new Error('SETTINGS_LOAD_FAILURE: Trading settings unavailable');
      }

      // Import deep research engine and integrations
      const { runDeepResearchWithCoinSelection } = await import('./deepResearchEngine');
      const { getUserIntegrations } = await import('../routes/integrations');

      // Get user integrations for API keys
      const integrations = await getUserIntegrations(uid);

      // Run deep research with coin selection based on trading settings
      const researchData = await runDeepResearchWithCoinSelection(uid, settings, undefined, integrations);

      if (!researchData.results || researchData.results.length === 0) {
        skipReason = 'NO_RESULTS_GENERATED';
        logger.warn({ uid, mode: settings.mode, skipReason }, '⚠️ Research cycle skipped: No results generated');
        cycleResult = 'SKIPPED';
        return;
      }

      // For MANUAL mode, we might get multiple results, take the first one or find the best
      // For TOP_100/TOP_10 modes, we already get the best result
      const researchResult = researchData.results[0];

      if (!researchResult || !researchResult.signal) {
        skipReason = 'NO_SIGNAL_GENERATED';
        logger.warn({ uid, mode: settings.mode, coinsAnalyzed: researchData.coinsAnalyzed.length, skipReason }, '⚠️ Research cycle skipped: No signal generated');
        cycleResult = 'SKIPPED';
        return;
      }

      signal = researchResult.signal;
      accuracy = researchResult.accuracy;

      logger.info({
        uid,
        mode: settings.mode,
        coinsAnalyzed: researchData.coinsAnalyzed.length,
        symbol: researchResult.metadata.symbol,
        signal,
        accuracy
      }, `📊 Research cycle completed (${settings.mode} mode), evaluating trade opportunity`);

      // Skip HOLD signals - only execute BUY/SELL
      if (signal === 'HOLD') {
        skipReason = 'HOLD_SIGNAL';
        logger.info({ uid, mode: settings.mode, symbol: researchResult.metadata.symbol, accuracy, skipReason }, `⚠️ Research cycle skipped: HOLD signal (${settings.mode} mode)`);
        cycleResult = 'SKIPPED';
        return;
      }

      // Calculate position sizing
      const positionSizing = AutoTradeEngine.calculatePositionSize(accuracy, settings);
      mappedPositionPercent = positionSizing.positionPercent;
      finalPositionPercent = Math.min(mappedPositionPercent, settings.maxPositionPerTrade);

      // Check if position size is valid
      if (finalPositionPercent <= 0) {
        skipReason = 'INVALID_POSITION_SIZE';
        logger.warn({ uid, accuracy, mappedPositionPercent, finalPositionPercent, skipReason }, '⚠️ Research cycle skipped: Invalid position size');
        cycleResult = 'SKIPPED';
        return;
      }

      // Get current market price
      const currentPrice = await this.getCurrentMarketPrice(settings.symbol, uid);

      // Create trade signal with reasonable defaults
      const tradeSignal: TradeSignal = {
        symbol: settings.symbol,
        signal: signal as 'BUY' | 'SELL',
        entryPrice: currentPrice,
        accuracy: accuracy,
        stopLoss: currentPrice * (signal === 'BUY' ? 0.985 : 1.015),
        takeProfit: currentPrice * (signal === 'BUY' ? 1.03 : 0.97),
        reasoning: `Auto-trade research signal: ${signal} with ${accuracy}% accuracy`,
        requestId: `auto_${uid}_${Date.now()}`,
        timestamp: new Date(),
      };

      // Execute trade if all conditions are met
      await this.executeTrade(uid, tradeSignal);

      cycleResult = 'TRADE_EXECUTED';
      logger.info({
        uid,
        cycleStartTime: cycleStartTime.toISOString(),
        accuracy,
        signal,
        mappedPositionPercent,
        finalPositionPercent,
        cycleResult,
        symbol: settings.symbol
      }, '✅ Research cycle completed successfully with trade execution');

    } catch (error: any) {
      cycleResult = 'FAILED';
      skipReason = error.message || 'UNKNOWN_ERROR';

      logger.error({
        uid,
        cycleStartTime: cycleStartTime.toISOString(),
        error: error.message,
        accuracy,
        signal,
        mappedPositionPercent,
        finalPositionPercent,
        cycleResult,
        skipReason
      }, '❌ Research cycle failed');

      // Don't re-throw - let the cycle complete gracefully
      // The scheduler will continue with the next cycle
    }
  }
}

export const autoTradeEngine = new AutoTradeEngine();

