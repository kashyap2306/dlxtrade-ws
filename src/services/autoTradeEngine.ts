import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { BinanceAdapter } from './binanceAdapter';
import { decrypt } from './keyManager';
import { getFirebaseAdmin } from '../utils/firebase';
import * as admin from 'firebase-admin';

export interface AutoTradeConfig {
  autoTradeEnabled: boolean;
  perTradeRiskPct: number; // percent of account equity per trade (default 1)
  maxConcurrentTrades: number; // default 3
  maxDailyLossPct: number; // stop trading if loss exceeds (default 5)
  stopLossPct: number; // default 1.5
  takeProfitPct: number; // default 3
  trailingStop: boolean;
  trailingPct: number;
  manualOverride: boolean; // when true, engine pauses for user actions
  mode: 'AUTO' | 'MANUAL' | 'SIMULATION';
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
  mode: 'AUTO' | 'MANUAL' | 'SIMULATION';
}

const DEFAULT_CONFIG: AutoTradeConfig = {
  autoTradeEnabled: false,
  perTradeRiskPct: 1, // 1% of equity per trade
  maxConcurrentTrades: 3,
  maxDailyLossPct: 5, // 5% max daily loss
  stopLossPct: 1.5, // 1.5% stop loss
  takeProfitPct: 3, // 3% take profit
  trailingStop: false,
  trailingPct: 0.5,
  manualOverride: false,
  mode: 'SIMULATION', // Start in simulation mode for safety
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
        trailingStop: updatedConfig.trailingStop,
        trailingPct: updatedConfig.trailingPct,
        manualOverride: updatedConfig.manualOverride,
        mode: updatedConfig.mode,
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

    // Check circuit breaker
    if (engine.circuitBreaker) {
      return { allowed: false, reason: 'Circuit breaker active - daily loss limit exceeded' };
    }

    // Check manual override
    if (config.manualOverride) {
      return { allowed: false, reason: 'Manual override active - trading paused' };
    }

    // Check if auto-trade is enabled
    if (!config.autoTradeEnabled) {
      return { allowed: false, reason: 'Auto-trade is disabled' };
    }

    // Check max concurrent trades
    if (engine.activeTrades.size >= config.maxConcurrentTrades) {
      return { allowed: false, reason: `Max concurrent trades (${config.maxConcurrentTrades}) reached` };
    }

    // Check daily loss limit
    const stats = config.stats || DEFAULT_CONFIG.stats!;
    if (stats.dailyPnL < 0 && Math.abs(stats.dailyPnL) >= (config.equitySnapshot || 1000) * (config.maxDailyLossPct / 100)) {
      engine.circuitBreaker = true;
      await this.logTradeEvent(uid, 'CIRCUIT_BREAKER_TRIGGERED', {
        reason: 'Daily loss limit exceeded',
        dailyPnL: stats.dailyPnL,
        maxDailyLossPct: config.maxDailyLossPct,
      });
      return { allowed: false, reason: 'Daily loss limit exceeded - circuit breaker activated' };
    }

    // Check if already have position in this symbol
    for (const trade of engine.activeTrades.values()) {
      if (trade.symbol === signal.symbol && trade.status === 'FILLED') {
        return { allowed: false, reason: `Already have active position in ${signal.symbol}` };
      }
    }

    return { allowed: true };
  }

  /**
   * Execute trade (simulation or live)
   */
  async executeTrade(uid: string, signal: TradeSignal): Promise<TradeExecution> {
    const requestId = signal.requestId || `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    logger.info({ uid, symbol: signal.symbol, requestId }, 'Starting trade execution');
    
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

    // Calculate position size using saved config
    const quantity = this.calculatePositionSize(
      equity,
      signal.entryPrice,
      config.stopLossPct,
      config.perTradeRiskPct
    );

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
    if (config.mode === 'SIMULATION') {
      // Simulation mode - log but don't place real order
      trade.status = 'FILLED';
      trade.fillPrice = signal.entryPrice;
      trade.orderId = `SIM_${tradeId}`;
      
      await this.logTradeEvent(uid, 'TRADE_SIMULATED', {
        trade,
        signal,
        equity,
        quantity,
        requestId,
        config: {
          mode: config.mode,
          perTradeRiskPct: config.perTradeRiskPct,
          stopLossPct: config.stopLossPct,
          takeProfitPct: config.takeProfitPct,
        },
      });
      
      logger.info({ uid, tradeId, symbol: signal.symbol, requestId, mode: 'SIMULATION' }, 'Trade simulated (SIMULATION mode)');
    } else if (config.mode === 'AUTO' && !config.manualOverride) {
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
        });

        logger.info({ 
          uid, 
          tradeId, 
          symbol: signal.symbol, 
          orderId: trade.orderId, 
          fillPrice: trade.fillPrice,
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
}

export const autoTradeEngine = new AutoTradeEngine();

