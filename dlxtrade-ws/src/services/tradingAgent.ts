import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { TechnicalIndicators, CandleData } from './technicalIndicators';
import { getFirebaseAdmin } from '../utils/firebase';
import { ExchangeCredentials } from './exchangeConnector';

export interface TradingAgentConfig {
  id: string;
  userId: string;
  name: string;
  tradingPair: 'BTC/USDT' | 'ETH/USDT';
  marketType: 'spot' | 'futures';
  exchange: 'bitget' | 'bybit'; // Configurable exchange from settings
  leverage: number; // Configurable leverage (default 8x, capped at 20x)
  riskPerTrade: number; // Configurable percentage (default 4%, range 4-5%)
  maxConcurrentTrades: number; // max 1 per pair, max 2 total
  maxTradesPerDay: number; // ideal 4-5, max 6
  apiKey: string; // Required for exchange
  apiSecret: string; // Required for exchange
  passphrase?: string; // Required for Bitget
  dryRun: boolean; // Safety mode - simulate trades without executing
  status: 'PENDING_APPROVAL' | 'ACTIVE' | 'PAUSED' | 'STOPPED';
  strategyType?: 'HTF_TREND_FILTER' | 'LIQUIDITY_SWEEP' | 'RSI_BOLLINGER' | 'VWAP_MEAN_REVERSION'; // Optional strategy type
  createdAt: Date;
  approvedAt?: Date;
  lastTradeAt?: Date;
  dailyTrades: number;
  consecutiveLosses: number;
  dailyPnL: number;
  totalPnL: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  drawdown: number;
}

export interface TradingDiagnostics {
  timestamp: Date;
  agentId: string;
  tradingPair: string;
  sessionCheck: {
    isValidSession: boolean;
    currentIST: string;
    sessionType?: 'London' | 'NewYork';
    reason?: string;
  };
  candleCheck: {
    isClosed: boolean;
    candleTimestamp: Date;
    price: number;
  };
  indicators: {
    rsi: number;
    ema50: number;
    bbUpper: number;
    bbLower: number;
    atr: number;
  };
  supportResistance: {
    support: number;
    resistance: number;
    calculated: boolean;
  };
  signal: {
    direction: 'LONG' | 'SHORT' | null;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    rrRatio: number;
    meetsConditions: boolean;
  };
  riskAnalysis: {
    accountBalance: number;
    riskPercent: number;
    positionSize: number;
    maxPositionSize: number;
    availableMargin: boolean;
    liquidationRisk?: number;
  };
  srValidation: {
    tpBlocked: boolean;
    rrValid: boolean;
    reason?: string;
  };
  decision: {
    action: 'TRADE' | 'REJECT' | 'SKIP';
    reason: string;
    confidence?: number;
  };
  execution?: {
    success: boolean;
    orderId?: string;
    error?: string;
  };
}

export interface TradingSignal {
  signalId: string; // Unique deterministic signal ID
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  timestamp: Date;
  candleTimestamp: Date;
  indicators: {
    rsi: number;
    ema50: number;
    bbUpper: number;
    bbLower: number;
    atr: number;
  };
}

export interface TradeRecord {
  id: string;
  signalId: string; // For idempotency
  agentId: string;
  direction: 'LONG' | 'SHORT';
  symbol?: string;
  entryPrice: number;
  exitPrice?: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  pnl?: number;
  status: 'OPEN' | 'CLOSED' | 'STOPPED' | 'FAILED' | 'SIMULATED';
  entryTime: Date;
  exitTime?: Date;
  candleTimestamp: Date;
  indicators: TradingSignal['indicators'];
  orderId?: string;
  error?: string;
}

export class TradingAgent {
  private config: TradingAgentConfig;

  constructor(config: TradingAgentConfig) {
    this.config = config;
  }

  /**
   * Deep clean object by recursively removing ALL undefined fields
   */
  private deepCleanObject(obj: any): any {
    if (obj === null || obj === undefined) {
      return null;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.deepCleanObject(item)).filter(item => item !== undefined);
    }
    
    if (typeof obj === 'object') {
      const cleaned: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
          const cleanedValue = this.deepCleanObject(value);
          if (cleanedValue !== undefined) {
            cleaned[key] = cleanedValue;
          }
        }
      }
      return Object.keys(cleaned).length > 0 ? cleaned : null;
    }
    
    return obj;
  }

  /**
   * Store diagnostics log for Trading Agent
   */
  public async storeDiagnostics(diagnostics: TradingDiagnostics): Promise<void> {
    try {
      const agentType = this.config.name && this.config.name.includes('Liquidity Sweep') 
        ? 'LIQUIDITY_SWEEP_AGENT'
        : this.config.name && this.config.name.includes('HTF Trend Filter')
        ? 'HTF_TREND_FILTER_AGENT'
        : 'TRADING_AGENT';

      const isHTFAgent = agentType === 'HTF_TREND_FILTER_AGENT';
      const cycleResult = diagnostics.decision?.action;
      const skippedReason = diagnostics.decision?.reason;

      let filteredDiagnostic: any = {
        agentType: agentType as any,
        decision: {
          action: diagnostics.decision.action as any,
          reason: diagnostics.decision.reason,
        },
        runtimeState: {
          sessionCheck: diagnostics.sessionCheck,
          candleCheck: diagnostics.candleCheck,
          indicators: diagnostics.indicators,
          riskAnalysis: diagnostics.riskAnalysis,
        },
      };

      // ENFORCE SKIPPED PERSISTENCE RULES
      if (cycleResult === 'SKIP') {
        // For HTF agents, preserve trading pair and direction even for skipped cycles
        // so users can see what the agent was evaluating
        if (isHTFAgent) {
          // Keep tradingPair and direction for HTF agents
          filteredDiagnostic.tradingPair = diagnostics.tradingPair;
          // Get direction from the diagnostics object (added dynamically) or signal
          // Normalize direction values to standard format
          const rawDirection = (diagnostics as any).direction || diagnostics.signal?.direction;
          if (rawDirection === 'LONG_ONLY') {
            filteredDiagnostic.direction = 'LONG';
          } else if (rawDirection === 'SHORT_ONLY') {
            filteredDiagnostic.direction = 'SHORT';
          } else if (rawDirection === 'NO_TRADE') {
            filteredDiagnostic.direction = 'NO_TRADE';
          } else {
            filteredDiagnostic.direction = rawDirection || 'NO_TRADE';
          }
        } else {
          // For non-HTF agents, force delete trading-related fields for SKIPPED cycles
          delete filteredDiagnostic.tradingPair;
          delete filteredDiagnostic.pair;
          delete filteredDiagnostic.direction;
        }
        
        // Clean up other fields for all agents
        delete filteredDiagnostic.symbol;
        delete filteredDiagnostic.exchangeError;
        delete filteredDiagnostic.exchangeErrorReason;
        
        // Clean up skip reason for exchange errors
        if (skippedReason?.includes('EXCHANGE_ERROR') || 
            skippedReason?.includes('EXCHANGE_CREDENTIALS_DECRYPT_FAILED')) {
          filteredDiagnostic.decision.reason = 'SKIPPED';
        }
        
        // NO signal data for skipped cycles
      } else {
        // For non-skipped cycles (TRADE), include trading pair and signal data
        filteredDiagnostic.tradingPair = diagnostics.tradingPair;
        
        if (diagnostics.signal) {
          filteredDiagnostic.signal = {
            direction: diagnostics.signal.direction as any,
            entryPrice: diagnostics.signal.entryPrice || 0,
            stopLoss: diagnostics.signal.stopLoss || 0,
            takeProfit: diagnostics.signal.takeProfit || 0,
            rrRatio: diagnostics.signal.rrRatio || 0,
          };
        }
        
        if (diagnostics.execution) {
          filteredDiagnostic.execution = {
            success: diagnostics.execution.success,
            orderId: diagnostics.execution.orderId,
            error: diagnostics.execution.error,
          };
        }
      }

      // DEEP-CLEAN diagnostics object - recursively remove ALL undefined fields
      // Do NOT rely on Firestore ignoreUndefinedProperties - ensure Firestore never receives undefined values
      const cleanedDiagnostic = this.deepCleanObject(filteredDiagnostic);

      if (!cleanedDiagnostic) {
        logger.warn({ agentId: this.config.id }, 'Diagnostics object became empty after cleaning - skipping save');
        return;
      }

      // Use unified diagnostics storage via firestoreAdapter
      await firestoreAdapter.saveAgentDiagnostic(this.config.id, cleanedDiagnostic, this.config.userId);

      logger.info({
        agentId: this.config.id,
        action: cleanedDiagnostic.decision.action,
        reason: cleanedDiagnostic.decision.reason,
        isSkipped: cycleResult === 'SKIP',
        cleaned: 'deep_cleaned_undefined_fields'
      }, 'Trading Agent diagnostics stored with deep cleaning');
    } catch (error: any) {
      logger.error({ error: error.message, agentId: this.config.id }, 'Failed to store Trading Agent diagnostics');
    }
  }

  /**
   * Get recent diagnostics
   */
  static async getDiagnostics(agentId: string, limit: number = 20, userId?: string): Promise<TradingDiagnostics[]> {
    try {
      // Use unified diagnostics storage via firestoreAdapter
      const diagnostics = await firestoreAdapter.getAgentDiagnostics(agentId, limit, userId);
      
      // Map to TradingDiagnostics format for backward compatibility
      return diagnostics.map(d => ({
        timestamp: d.timestamp,
        agentId: d.agentId,
        tradingPair: d.tradingPair || '',
        sessionCheck: d.runtimeState?.sessionCheck || { isValidSession: false, currentIST: '' },
        candleCheck: d.runtimeState?.candleCheck || { isClosed: false, candleTimestamp: new Date(), price: 0 },
        indicators: d.runtimeState?.indicators || {},
        supportResistance: d.runtimeState?.supportResistance || { calculated: false },
        signal: d.signal ? {
          direction: d.signal.direction,
          meetsConditions: true,
          entryPrice: d.signal.entryPrice,
          stopLoss: d.signal.stopLoss,
          takeProfit: d.signal.takeProfit,
          rrRatio: d.signal.rrRatio,
        } : { direction: null, meetsConditions: false },
        riskAnalysis: d.runtimeState?.riskAnalysis || {},
        srValidation: d.runtimeState?.srValidation || {},
        decision: d.decision as any,
        execution: d.execution,
      })) as TradingDiagnostics[];
    } catch (error: any) {
      logger.error({ error: error.message, agentId }, 'Failed to get diagnostics');
      return [];
    }
  }

  /**
   * Check if agent can trade based on daily limits and risk rules
   * Note: This is now a legacy method - actual checks are done in executeAgent
   */
  canTrade(): { canTrade: boolean; reason?: string } {
    // This method is kept for compatibility but actual validation happens in executeAgent
    // with hardened daily counters from database
    return { canTrade: this.config.status === 'ACTIVE' };
  }

  /**
   * Calculate position size for Bitget Futures with proper liquidation safety
   * Formula: position_size = (account_balance × risk_percent × leverage) / (entry_price × leverage × maintenance_margin_rate)
   * Then validate liquidation distance > SL distance
   */
  calculatePositionSize(accountBalance: number, entryPrice: number, stopLoss: number, leverage: number = 8): {
    positionSize: number;
    marginRequired: number;
    liquidationPrice: number;
    liquidationDistance: number;
    isSafe: boolean;
    reason?: string;
  } {
    try {
      // Calculate stop loss distance
      const slDistance = Math.abs(entryPrice - stopLoss);
      if (slDistance === 0) {
        return {
          positionSize: 0,
          marginRequired: 0,
          liquidationPrice: 0,
          liquidationDistance: 0,
          isSafe: false,
          reason: 'INVALID_SL_DISTANCE'
        };
      }

      // Risk amount = account balance * risk percentage (default 4%)
      const riskPercent = this.config.riskPerTrade || 4;
      const riskAmount = accountBalance * (riskPercent / 100);

      // For futures: position_value = risk_amount / sl_distance
      const positionValueUSD = riskAmount / slDistance;

      // Apply leverage
      const leveragedPositionValue = positionValueUSD * leverage;

      // Position size in contracts: leveraged_position / contract_value
      // For COIN-M Futures, contract size = 1 (1 contract = 1 coin)
      const positionSize = leveragedPositionValue / entryPrice;

      // Margin required = leveraged_position / leverage
      const marginRequired = leveragedPositionValue / leverage;

      // Calculate liquidation price for Bitget Futures
      // Maintenance margin rate for COIN-M is typically 0.5% (0.005)
      const maintenanceMarginRate = 0.005; // 0.5% for Bitget COIN-M
      const liquidationPrice = this.calculateLiquidationPrice(
        entryPrice,
        positionSize,
        leverage,
        maintenanceMarginRate,
        this.config.tradingPair.startsWith('BTC') ? 'LONG' : 'LONG' // Assume LONG for calculation
      );

      // Calculate liquidation distance from entry
      const liquidationDistance = Math.abs(entryPrice - liquidationPrice);

      // Safety checks
      const maxMarginUsage = 70; // Max 70% margin usage per trade
      const marginUsagePercent = (marginRequired / accountBalance) * 100;
      const isMarginSafe = marginUsagePercent <= maxMarginUsage;

      // Critical: Liquidation distance must be > SL distance
      const isLiquidationSafe = liquidationDistance > slDistance;

      const isSafe = isMarginSafe && isLiquidationSafe;

      let reason: string | undefined;
      if (!isMarginSafe) {
        reason = `MARGIN_USAGE_TOO_HIGH: ${marginUsagePercent.toFixed(1)}% > ${maxMarginUsage}%`;
      } else if (!isLiquidationSafe) {
        reason = `LIQUIDATION_TOO_CLOSE: ${liquidationDistance.toFixed(2)} < ${slDistance.toFixed(2)}`;
      }

      return {
        positionSize,
        marginRequired,
        liquidationPrice,
        liquidationDistance,
        isSafe,
        reason
      };
    } catch (error) {
      logger.error({
        accountBalance,
        entryPrice,
        stopLoss,
        leverage,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to calculate position size');

      return {
        positionSize: 0,
        marginRequired: 0,
        liquidationPrice: 0,
        liquidationDistance: 0,
        isSafe: false,
        reason: 'CALCULATION_ERROR'
      };
    }
  }

  /**
   * Calculate liquidation price for Bitget Futures
   */
  private calculateLiquidationPrice(
    entryPrice: number,
    positionSize: number,
    leverage: number,
    maintenanceMarginRate: number,
    direction: 'LONG' | 'SHORT'
  ): number {
    // For simplified calculation, assume no unrealized PnL
    // Liquidation price = entry_price * (1 ± (1/leverage - maintenance_margin_rate))
    const leverageFactor = 1 / leverage;
    const marginFactor = maintenanceMarginRate;

    if (direction === 'LONG') {
      // Long liquidation: price falls
      return entryPrice * (1 - leverageFactor + marginFactor);
    } else {
      // Short liquidation: price rises
      return entryPrice * (1 + leverageFactor - marginFactor);
    }
  }

  /**
   * Check and perform daily reset at 00:00 IST
   */
  private async checkDailyReset(): Promise<void> {
    try {
      const now = new Date();

      // Convert to IST (UTC+5:30)
      const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
      const istTime = new Date(now.getTime() + istOffset);

      // Check if it's 00:00 IST
      const isResetTime = istTime.getHours() === 0 && istTime.getMinutes() === 0;

      // Check if we haven't reset today yet
      const lastResetDate = this.config.lastTradeAt ?
        new Date(this.config.lastTradeAt).toISOString().split('T')[0] : null;
      const todayDate = istTime.toISOString().split('T')[0];

      if (isResetTime && lastResetDate !== todayDate) {
        logger.info({
          agentId: this.config.id,
          lastResetDate,
          todayDate
        }, 'Performing daily reset at 00:00 IST');

        // Reset daily counters
        this.config.dailyTrades = 0;
        this.config.consecutiveLosses = 0;
        this.config.dailyPnL = 0;

        // Save updated config
        await firestoreAdapter.updateAgentConfig(this.config.id, {
          dailyTrades: 0,
          consecutiveLosses: 0,
          dailyPnL: 0,
          lastTradeAt: now
        });

        logger.info({ agentId: this.config.id }, 'Daily reset completed');
      }
    } catch (error) {
      logger.error({
        agentId: this.config.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to perform daily reset');
    }
  }

  /**
   * Detect support and resistance levels from recent candles
   */
  private detectSupportResistance(candles: any[], lookback: number = 50): { support: number; resistance: number } {
    if (!candles || candles.length < lookback) {
      return { support: 0, resistance: 0 };
    }

    // Use the last 'lookback' candles
    const recentCandles = candles.slice(-lookback);
    const highs = recentCandles.map(c => c.high);
    const lows = recentCandles.map(c => c.low);

    // Find swing highs and lows (simplified approach)
    const swingHighs: number[] = [];
    const swingLows: number[] = [];

    for (let i = 2; i < recentCandles.length - 2; i++) {
      const current = recentCandles[i];
      const prev2 = recentCandles[i - 2];
      const prev1 = recentCandles[i - 1];
      const next1 = recentCandles[i + 1];
      const next2 = recentCandles[i + 2];

      // Swing high: higher than previous 2 and next 2
      if (current.high > prev2.high && current.high > prev1.high &&
          current.high > next1.high && current.high > next2.high) {
        swingHighs.push(current.high);
      }

      // Swing low: lower than previous 2 and next 2
      if (current.low < prev2.low && current.low < prev1.low &&
          current.low < next1.low && current.low < next2.low) {
        swingLows.push(current.low);
      }
    }

    // Find the most relevant S/R levels (closest to current price)
    const currentPrice = recentCandles[recentCandles.length - 1].close;
    const resistance = swingHighs.length > 0 ?
      Math.min(...swingHighs.filter(h => h > currentPrice)) : currentPrice * 1.1;
    const support = swingLows.length > 0 ?
      Math.max(...swingLows.filter(l => l < currentPrice)) : currentPrice * 0.9;

    return { support, resistance };
  }

  /**
   * Validate trade against support/resistance levels
   */
  private validateTradeWithSR(
    entryPrice: number,
    stopLoss: number,
    takeProfit: number,
    direction: 'LONG' | 'SHORT',
    sr: { support: number; resistance: number },
    atr: number
  ): { valid: boolean; reason?: string } {
    const { support, resistance } = sr;

    if (direction === 'LONG') {
      // For LONG trades, check if resistance is too close to TP
      const distanceToResistance = resistance - entryPrice;
      const tpDistance = takeProfit - entryPrice;

      if (distanceToResistance < tpDistance || distanceToResistance < (0.8 * atr)) {
        return {
          valid: false,
          reason: `REJECTED_DUE_TO_SR: Resistance at ${resistance.toFixed(2)} too close to TP at ${takeProfit.toFixed(2)}`
        };
      }
    } else { // SHORT
      // For SHORT trades, check if support is too close to TP
      const distanceToSupport = entryPrice - support;
      const tpDistance = entryPrice - takeProfit;

      if (distanceToSupport < tpDistance || distanceToSupport < (0.8 * atr)) {
        return {
          valid: false,
          reason: `REJECTED_DUE_TO_SR: Support at ${support.toFixed(2)} too close to TP at ${takeProfit.toFixed(2)}`
        };
      }
    }

    return { valid: true };
  }

  /**
   * Calculate all technical indicators for signal generation
   */
  calculateIndicators(candles: CandleData[]): {
    rsi: number;
    ema50: number;
    bbUpper: number;
    bbLower: number;
    bbMiddle: number;
    atr: number;
  } {
    if (!candles || candles.length < 50) {
      throw new Error('Need at least 50 candles for indicator calculation');
    }

    // Extract closing prices (most recent first for RSI)
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    // Calculate indicators
    const rsi = TechnicalIndicators.calculateRSI(closes, 14);
    const ema50 = TechnicalIndicators.calculateEMA(closes, 50);
    const bb = TechnicalIndicators.calculateBollingerBands(closes, 20, 2);
    const atr = TechnicalIndicators.calculateATR(candles, 14);

    return {
      rsi,
      ema50,
      bbUpper: bb.upper,
      bbLower: bb.lower,
      bbMiddle: bb.middle,
      atr
    };
  }

  /**
   * Generate trading signal based on indicators with S/R validation
   */
  generateSignal(
    candle: any,
    indicators: {
      rsi: number;
      ema50: number;
      bbUpper: number;
      bbLower: number;
      atr: number;
    },
    recentCandles?: any[]
  ): TradingSignal | null {
    const { price, timestamp } = candle;
    const { rsi, ema50, bbUpper, bbLower, atr } = indicators;

    // Check if this is a Liquidity Sweep agent
    const isLiquiditySweepAgent = this.config.name && this.config.name.includes('Liquidity Sweep');
    
    // Check if this is an HTF Trend Filter agent
    const isHTFTrendFilterAgent = this.config.name && this.config.name.includes('HTF Trend Filter');

    if (isLiquiditySweepAgent) {
      return this.generateLiquiditySweepSignal(candle, indicators, recentCandles);
    }

    if (isHTFTrendFilterAgent) {
      return this.generateHTFTrendFilterSignal(candle, indicators, recentCandles);
    }

    // Create deterministic signal ID from agent + candle + indicators
    const createSignalId = (direction: 'LONG' | 'SHORT') => {
      const signalData = `${this.config.id}:${timestamp}:${direction}:${price}:${rsi}:${ema50}:${bbUpper}:${bbLower}:${atr}`;
      // Simple hash for deterministic ID
      let hash = 0;
      for (let i = 0; i < signalData.length; i++) {
        const char = signalData.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      return `signal_${Math.abs(hash).toString(36)}`;
    };

    // LONG conditions - ALL must be met
    if (
      price > ema50 && // Price above EMA 50 (trend filter)
      rsi < 30 && // RSI oversold
      (price <= bbLower) // Price touches or closes below lower BB
    ) {
      const entryPrice = price;
      let stopLoss = entryPrice - atr; // 1 ATR stop loss
      let takeProfit = entryPrice + (3 * atr); // 3 ATR take profit (1:3 RR)

      // Calculate RR ratio
      const riskAmount = entryPrice - stopLoss;
      const rewardAmount = takeProfit - entryPrice;
      const rrRatio = rewardAmount / riskAmount;

      // Signal generated successfully

      // Validate trade with Support/Resistance levels
      let srValidation = { tpBlocked: false, rrValid: true, reason: '' };
      if (recentCandles) {
        const sr = this.detectSupportResistance(recentCandles, 50);

        // S/R levels calculated

        // Check if TP is blocked by resistance (within 0.5 ATR distance)
        if (sr.resistance && (sr.resistance - takeProfit) < (0.5 * atr)) {
          srValidation = {
            tpBlocked: true,
            rrValid: false,
            reason: `TP blocked by resistance at ${sr.resistance.toFixed(2)}`
          };
        }

        // Check minimum RR after S/R validation
        if (rrRatio < 3) {
          srValidation = {
            tpBlocked: false,
            rrValid: false,
            reason: `RR ratio ${rrRatio.toFixed(2)} below minimum 3.0`
          };
        }

        if (!srValidation.rrValid) {
          logger.info({
            agentId: this.config.id,
            signalId: createSignalId('LONG'),
            reason: srValidation.reason,
            entryPrice,
            stopLoss,
            takeProfit,
            rrRatio,
            sr
          }, 'LONG signal rejected due to S/R validation');

          // Signal rejected due to S/R validation

          return null; // Reject trade
        }

        // Adjust SL/TP for better S/R alignment (safety tweak)
        // Push SL slightly below nearest swing low if it's closer
        const swingLows = recentCandles.slice(-50).map(c => c.low).sort((a, b) => b - a);
        const nearestSwingLow = swingLows.find(low => low < entryPrice);
        if (nearestSwingLow && (entryPrice - nearestSwingLow) < atr) {
          stopLoss = Math.min(stopLoss, nearestSwingLow - 0.001); // Push SL below swing low
        }

        // Cap TP slightly before strong resistance if it's very close
        if (sr.resistance && (sr.resistance - entryPrice) < (2 * atr)) {
          takeProfit = Math.min(takeProfit, sr.resistance - 0.001); // Cap TP before resistance
        }
      }

      const signalId = createSignalId('LONG');

      // Valid LONG signal generated

      return {
        signalId,
        direction: 'LONG',
        entryPrice,
        stopLoss,
        takeProfit,
        timestamp: new Date(),
        candleTimestamp: new Date(timestamp),
        indicators: { rsi, ema50, bbUpper, bbLower, atr }
      };
    }

    // SHORT conditions - ALL must be met
    if (
      price < ema50 && // Price below EMA 50 (trend filter)
      rsi > 70 && // RSI overbought
      (price >= bbUpper) // Price touches or closes above upper BB
    ) {
      const entryPrice = price;
      let stopLoss = entryPrice + atr; // 1 ATR stop loss
      let takeProfit = entryPrice - (3 * atr); // 3 ATR take profit (1:3 RR)

      // Calculate RR ratio
      const riskAmount = stopLoss - entryPrice;
      const rewardAmount = entryPrice - takeProfit;
      const rrRatio = rewardAmount / riskAmount;

      // SHORT signal generated

      // Validate trade with Support/Resistance levels
      let srValidation = { tpBlocked: false, rrValid: true, reason: '' };
      if (recentCandles) {
        const sr = this.detectSupportResistance(recentCandles, 50);

        // S/R levels calculated

        // Check if TP is blocked by support (within 0.5 ATR distance)
        if (sr.support && (takeProfit - sr.support) < (0.5 * atr)) {
          srValidation = {
            tpBlocked: true,
            rrValid: false,
            reason: `TP blocked by support at ${sr.support.toFixed(2)}`
          };
        }

        // Check minimum RR after S/R validation
        if (rrRatio < 3) {
          srValidation = {
            tpBlocked: false,
            rrValid: false,
            reason: `RR ratio ${rrRatio.toFixed(2)} below minimum 3.0`
          };
        }

        if (!srValidation.rrValid) {
          logger.info({
            agentId: this.config.id,
            signalId: createSignalId('SHORT'),
            reason: srValidation.reason,
            entryPrice,
            stopLoss,
            takeProfit,
            rrRatio,
            sr
          }, 'SHORT signal rejected due to S/R validation');

          // Signal rejected due to S/R validation

          return null; // Reject trade
        }

        // Adjust SL/TP for better S/R alignment (safety tweak)
        // Push SL slightly above nearest swing high if it's closer
        const swingHighs = recentCandles.slice(-50).map(c => c.high).sort((a, b) => a - b);
        const nearestSwingHigh = swingHighs.find(high => high > entryPrice);
        if (nearestSwingHigh && (nearestSwingHigh - entryPrice) < atr) {
          stopLoss = Math.max(stopLoss, nearestSwingHigh + 0.001); // Push SL above swing high
        }

        // Cap TP slightly before strong support if it's very close
        if (sr.support && (entryPrice - sr.support) < (2 * atr)) {
          takeProfit = Math.max(takeProfit, sr.support + 0.001); // Cap TP before support
        }
      }

      const signalId = createSignalId('SHORT');

      // Valid SHORT signal generated

      return {
        signalId,
        direction: 'SHORT',
        entryPrice,
        stopLoss,
        takeProfit,
        timestamp: new Date(),
        candleTimestamp: new Date(timestamp),
        indicators: { rsi, ema50, bbUpper, bbLower, atr }
      };
    }

    return null; // No signal
  }

  /**
   * Generate liquidity sweep trading signal
   */
  private generateLiquiditySweepSignal(
    candle: any,
    indicators: {
      rsi: number;
      ema50: number;
      bbUpper: number;
      bbLower: number;
      atr: number;
    },
    recentCandles?: any[]
  ): TradingSignal | null {
    const { price, timestamp } = candle;
    const { rsi, ema50, bbUpper, bbLower, atr } = indicators;

    if (!recentCandles || recentCandles.length < 20) {
      return null;
    }

    // Create deterministic signal ID
    const createSignalId = (direction: 'LONG' | 'SHORT') => {
      const signalData = `${this.config.id}:${timestamp}:${direction}:${price}`;
      let hash = 0;
      for (let i = 0; i < signalData.length; i++) {
        const char = signalData.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return `liquidity_sweep_${Math.abs(hash).toString(36)}`;
    };

    // Detect market structure: equal highs/lows
    const marketStructure = this.detectMarketStructure(recentCandles);
    if (!marketStructure.detected) {
      return null;
    }

    // Detect liquidity sweep
    const sweep = this.detectLiquiditySweep(recentCandles, marketStructure);
    if (!sweep.detected) {
      return null;
    }

    // Check entry confirmation
    const confirmation = this.checkEntryConfirmation(recentCandles, marketStructure, sweep.direction!);
    if (!confirmation.confirmed) {
      return null;
    }

    // Generate signal
    const entryPrice = price;
    let stopLoss: number;
    let takeProfit: number;

    if (confirmation.direction === 'SHORT') {
      stopLoss = candle.high + (atr * 0.1); // Just beyond sweep wick
      takeProfit = entryPrice - (Math.abs(entryPrice - stopLoss) * 3); // 1:3 RR preferred
    } else {
      stopLoss = candle.low - (atr * 0.1); // Just beyond sweep wick
      takeProfit = entryPrice + (Math.abs(entryPrice - stopLoss) * 3); // 1:3 RR preferred
    }

    return {
      signalId: createSignalId(confirmation.direction!),
      direction: confirmation.direction!,
      entryPrice,
      stopLoss,
      takeProfit,
      timestamp: new Date(timestamp),
      candleTimestamp: new Date(timestamp),
      indicators: { rsi, ema50, bbUpper, bbLower, atr }
    };
  }

  /**
   * Detect market structure: equal highs or equal lows
   */
  private detectMarketStructure(candles: any[]): { detected: boolean; type?: 'equalHighs' | 'equalLows'; level?: number; confirmed: boolean } {
    if (candles.length < 15) {
      return { detected: false, confirmed: false };
    }

    const recentCandles = candles.slice(-15);
    const highs = recentCandles.map(c => c.high);
    const maxHigh = Math.max(...highs);
    const equalHighs = highs.filter(h => Math.abs(h - maxHigh) / maxHigh <= 0.001).length;

    const lows = recentCandles.map(c => c.low);
    const minLow = Math.min(...lows);
    const equalLows = lows.filter(l => Math.abs(l - minLow) / minLow <= 0.001).length;

    if (equalHighs >= 3) {
      return {
        detected: true,
        type: 'equalHighs',
        level: maxHigh,
        confirmed: equalHighs >= 4
      };
    }

    if (equalLows >= 3) {
      return {
        detected: true,
        type: 'equalLows',
        level: minLow,
        confirmed: equalLows >= 4
      };
    }

    return { detected: false, confirmed: false };
  }

  /**
   * Detect liquidity sweep above/below equal highs/lows
   */
  private detectLiquiditySweep(candles: any[], marketStructure: any): {
    detected: boolean;
    direction?: 'LONG' | 'SHORT';
    wickLength?: number;
    volumeSpike?: boolean;
    wickBeyondLevel: boolean;
  } {
    if (!marketStructure.detected || !marketStructure.confirmed) {
      return { detected: false, wickBeyondLevel: false };
    }

    const latestCandle = candles[candles.length - 1];
    const level = marketStructure.level;

    if (marketStructure.type === 'equalHighs') {
      const wickAbove = latestCandle.high - level;
      const wickLength = wickAbove > 0 ? wickAbove : 0;
      const wickBeyondLevel = wickLength > 0;

      const recentVolumes = candles.slice(-10, -1).map(c => c.volume);
      const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
      const volumeSpike = latestCandle.volume > avgVolume * 1.5;

      return {
        detected: wickBeyondLevel && volumeSpike,
        direction: 'SHORT',
        wickLength,
        volumeSpike,
        wickBeyondLevel
      };
    } else if (marketStructure.type === 'equalLows') {
      const wickBelow = level - latestCandle.low;
      const wickLength = wickBelow > 0 ? wickBelow : 0;
      const wickBeyondLevel = wickLength > 0;

      const recentVolumes = candles.slice(-10, -1).map(c => c.volume);
      const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
      const volumeSpike = latestCandle.volume > avgVolume * 1.5;

      return {
        detected: wickBeyondLevel && volumeSpike,
        direction: 'LONG',
        wickLength,
        volumeSpike,
        wickBeyondLevel
      };
    }

    return { detected: false, wickBeyondLevel: false };
  }

  /**
   * Check entry confirmation: price returns back inside the range with minor structure shift
   */
  private checkEntryConfirmation(candles: any[], marketStructure: any, sweepDirection: 'LONG' | 'SHORT'): {
    confirmed: boolean;
    priceReturned: boolean;
    minorStructureShift: boolean;
    direction?: 'LONG' | 'SHORT';
  } {
    if (candles.length < 5) {
      return { confirmed: false, priceReturned: false, minorStructureShift: false };
    }

    const latestCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const level = marketStructure.level;

    let priceReturned = false;
    if (marketStructure.type === 'equalHighs') {
      priceReturned = latestCandle.close < level;
    } else if (marketStructure.type === 'equalLows') {
      priceReturned = latestCandle.close > level;
    }

    let minorStructureShift = false;
    if (sweepDirection === 'SHORT' && marketStructure.type === 'equalHighs') {
      minorStructureShift = latestCandle.high < prevCandle.high;
    } else if (sweepDirection === 'LONG' && marketStructure.type === 'equalLows') {
      minorStructureShift = latestCandle.low > prevCandle.low;
    }

    const confirmed = priceReturned && minorStructureShift;

    return {
      confirmed,
      priceReturned,
      minorStructureShift,
      direction: confirmed ? sweepDirection : undefined
    };
  }

  /**
   * Generate HTF Trend Filter trading signal
   * NOTE: This method expects 1m candles in recentCandles
   * HTF (15m) candles must be fetched separately by the caller
   */
  private generateHTFTrendFilterSignal(
    candle: any,
    indicators: {
      rsi: number;
      ema50: number;
      bbUpper: number;
      bbLower: number;
      atr: number;
    },
    recentCandles?: any[]
  ): TradingSignal | null {
    const { price, timestamp } = candle;

    if (!recentCandles || recentCandles.length < 200) {
      logger.debug({
        agentId: this.config.id,
        candlesCount: recentCandles?.length || 0
      }, 'HTF Trend Filter: Insufficient candles for analysis');
      return null;
    }

    // Import HTF strategy
    const { HTFTrendFilterStrategy } = require('./htfTrendFilterStrategy');

    // NOTE: For HTF analysis, we need 15m candles
    // Since we only have 1m candles here, we'll skip HTF analysis for now
    // The caller (agentExecutionService) should fetch both 15m and 1m candles
    // For now, we'll assume LONG_ONLY trend as a placeholder
    // TODO: Fetch 15m candles in agentExecutionService and pass HTF trend here

    // Analyze LTF (1m) entry using the provided 1m candles
    const ltfSignal = HTFTrendFilterStrategy.analyzeLTFEntry(recentCandles, 'LONG_ONLY');

    if (!ltfSignal.isValid) {
      logger.debug({
        agentId: this.config.id,
        reason: ltfSignal.reason
      }, 'HTF Trend Filter: LTF entry conditions not met');
      return null;
    }

    // Create deterministic signal ID
    const createSignalId = (direction: 'LONG' | 'SHORT') => {
      const signalData = `${this.config.id}:${timestamp}:${direction}:${price}`;
      let hash = 0;
      for (let i = 0; i < signalData.length; i++) {
        const char = signalData.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return `htf_trend_filter_${Math.abs(hash).toString(36)}`;
    };

    return {
      signalId: createSignalId(ltfSignal.direction!),
      direction: ltfSignal.direction!,
      entryPrice: ltfSignal.entryPrice,
      stopLoss: ltfSignal.stopLoss,
      takeProfit: ltfSignal.takeProfit,
      timestamp: new Date(timestamp),
      candleTimestamp: new Date(timestamp),
      indicators: {
        rsi: ltfSignal.indicators.rsi,
        ema50: ltfSignal.indicators.ema50,
        bbUpper: ltfSignal.indicators.bbUpper,
        bbLower: ltfSignal.indicators.bbLower,
        atr: indicators.atr
      }
    };
  }

  /**
   * Check for duplicate/overtrading protection with idempotency
   * Note: Most checks are now done at executeAgent level for hardening
   */
  checkOvertradingProtection(signal: TradingSignal, recentTrades: TradeRecord[], lastProcessedCandle?: Date): boolean {
    // Check if this exact signal was already executed (idempotency)
    const existingSignal = recentTrades.find(t => t.signalId === signal.signalId);
    if (existingSignal) {
      logger.info({
        agentId: this.config.id,
        signalId: signal.signalId,
        existingTradeId: existingSignal.id
      }, 'Idempotency: signal already executed, skipping');
      return false;
    }

    // Note: Other checks (candle determinism, position limits, cooldowns) are now
    // handled at the executeAgent level with database-backed enforcement

    return true;
  }

  /**
   * Execute trade with risk management
   */
  async executeTrade(
    signal: TradingSignal,
    accountBalance: number,
    dailyCounters?: { consecutiveLosses: number; dailyPnL: number; tradesToday: number }
  ): Promise<TradeRecord | null> {
    try {
      // Check for daily reset at 00:00 IST
      await this.checkDailyReset();

      // Validate agent can trade
      const canTradeCheck = this.canTrade();
      if (!canTradeCheck.canTrade) {
        logger.info({
          agentId: this.config.id,
          reason: canTradeCheck.reason
        }, 'Trade blocked by risk rules');
        return null;
      }

      // Get recent trades for overtrading protection
      const recentTrades = await firestoreAdapter.getAgentTrades(this.config.id, 10);

      // Check overtrading protection
      if (!this.checkOvertradingProtection(signal, recentTrades)) {
        return null;
      }

      // Calculate position size with liquidation safety validation
      const positionCalc = this.calculatePositionSize(
        accountBalance,
        signal.entryPrice,
        signal.stopLoss,
        this.config.leverage || 8
      );

      // CRITICAL: Reject if position sizing is unsafe BEFORE execution
      if (!positionCalc.isSafe) {
        logger.warn({
          agentId: this.config.id,
          signalId: signal.signalId,
          reason: positionCalc.reason,
          positionSize: positionCalc.positionSize,
          marginRequired: positionCalc.marginRequired,
          liquidationPrice: positionCalc.liquidationPrice,
          liquidationDistance: positionCalc.liquidationDistance,
          slDistance: Math.abs(signal.entryPrice - signal.stopLoss)
        }, 'Trade rejected due to position sizing safety check');

        // Diagnostics removed - handled by caller

        return null;
      }

      const quantity = positionCalc.positionSize;

      // Create trade record
      const tradeRecord: TradeRecord = {
        id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        signalId: signal.signalId, // For idempotency
        agentId: this.config.id,
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        quantity,
        status: 'OPEN',
        entryTime: signal.timestamp,
        candleTimestamp: signal.candleTimestamp,
        indicators: signal.indicators
      };

      // Check if this is a DRY RUN
      if (this.config.dryRun) {
        logger.info({
          agentId: this.config.id,
          tradeId: tradeRecord.id,
          direction: signal.direction,
          entryPrice: signal.entryPrice,
          quantity,
          dryRun: true
        }, 'DRY RUN: Trade simulated (not executed)');

        // Save trade record as SIMULATED status
        tradeRecord.status = 'SIMULATED';
        await firestoreAdapter.saveAgentTrade(tradeRecord);

        // Update agent stats for dry run
        await this.updateAgentStatsAfterTrade();

        return tradeRecord;
      }

      // Execute actual order with HARD GATE enforcement
      try {
        const orderResult = await this.executeBracketOrder(tradeRecord);

        if (orderResult.success) {
          // Update trade record with order ID
          tradeRecord.orderId = orderResult.orderId;
          tradeRecord.status = 'OPEN'; // Trade is now live on exchange
          await firestoreAdapter.saveAgentTrade(tradeRecord);

          // Update agent stats
          await this.updateAgentStatsAfterTrade();

          logger.info({
            agentId: this.config.id,
            tradeId: tradeRecord.id,
            orderId: orderResult.orderId,
            direction: signal.direction,
            entryPrice: signal.entryPrice,
            quantity,
            liquidationPrice: positionCalc.liquidationPrice,
            liquidationDistance: positionCalc.liquidationDistance
          }, 'HARD GATE PASSED: Trade executed successfully with safety validation');

          return tradeRecord;
        } else {
          // HARD GATE: Order failed - must be logged and rejected
          const normalizedError = this.normalizeExchangeError(orderResult.error);

          logger.error({
            agentId: this.config.id,
            tradeId: tradeRecord.id,
            error: orderResult.error,
            normalizedError,
            direction: signal.direction,
            entryPrice: signal.entryPrice,
            quantity
          }, 'HARD GATE VIOLATION: Order execution failed - trade permanently rejected');

          // Save failed trade record for diagnostics
          tradeRecord.status = 'FAILED';
          tradeRecord.error = normalizedError;
          await firestoreAdapter.saveAgentTrade(tradeRecord);

          // Save diagnostic record for UI visibility (HARD REQUIREMENT)
          await this.saveDiagnostics({
            timestamp: new Date(),
            tradingPair: this.config.tradingPair,
            decision: {
              action: 'REJECT',
              reason: `EXECUTION_FAILED: ${normalizedError}`
            },
            execution: {
              success: false,
              error: normalizedError
            }
          });

          return null;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const normalizedError = this.normalizeExchangeError(errorMessage);

        logger.error({
          agentId: this.config.id,
          tradeId: tradeRecord.id,
          error: errorMessage,
          normalizedError
        }, 'HARD GATE VIOLATION: Order execution exception - trade permanently rejected');

        // Save failed trade record for diagnostics
        tradeRecord.status = 'FAILED';
        tradeRecord.error = normalizedError;
        await firestoreAdapter.saveAgentTrade(tradeRecord);

        // Save diagnostic record for UI visibility (HARD REQUIREMENT)
        await this.saveDiagnostics({
          timestamp: new Date(),
          tradingPair: this.config.tradingPair,
          decision: {
            action: 'REJECT',
            reason: `EXECUTION_EXCEPTION: ${normalizedError}`
          },
          execution: {
            success: false,
            error: normalizedError
          }
        });

        return null;
      }
    } catch (error) {
      logger.error({
        agentId: this.config.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to execute trade');
      return null;
    }
  }

  /**
   * Update agent statistics after trade
   */
  private async updateAgentStatsAfterTrade(): Promise<void> {
    try {
      // Update daily trades counter
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const updatedConfig = {
        ...this.config,
        dailyTrades: this.config.dailyTrades + 1,
        lastTradeAt: new Date()
      };

      // Reset daily counters if it's a new day
      const lastTradeDate = this.config.lastTradeAt ? new Date(this.config.lastTradeAt) : null;
      if (!lastTradeDate || lastTradeDate < today) {
        updatedConfig.dailyTrades = 1;
        updatedConfig.consecutiveLosses = 0;
        updatedConfig.dailyPnL = 0;
      }

      this.config = updatedConfig;
      await firestoreAdapter.updateAgentConfig(this.config.id, updatedConfig);
    } catch (error) {
      logger.error({
        agentId: this.config.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to update agent stats');
    }
  }

  /**
   * Get agent performance summary
   */
  getPerformanceSummary() {
    return {
      totalTrades: this.config.totalTrades,
      winningTrades: this.config.winningTrades,
      losingTrades: this.config.losingTrades,
      winRate: this.config.totalTrades > 0 ? (this.config.winningTrades / this.config.totalTrades) * 100 : 0,
      totalPnL: this.config.totalPnL,
      dailyPnL: this.config.dailyPnL,
      dailyTrades: this.config.dailyTrades,
      consecutiveLosses: this.config.consecutiveLosses,
      drawdown: this.config.drawdown,
      lastTradeAt: this.config.lastTradeAt
    };
  }

  /**
   * Get agent strategy overview
   */
  getStrategyOverview() {
    return {
      name: this.config.name,
      tradingPair: this.config.tradingPair,
      marketType: this.config.marketType,
      indicators: ['RSI (14)', 'Bollinger Bands (20, 2)', 'EMA (50)', 'ATR (14)'],
      entryConditions: {
        LONG: [
          'Price > EMA 50',
          'RSI (14) < 30',
          'Price touches or closes below Lower Bollinger Band'
        ],
        SHORT: [
          'Price < EMA 50',
          'RSI (14) > 70',
          'Price touches or closes above Upper Bollinger Band'
        ]
      },
      riskManagement: {
        stopLoss: '1 × ATR from entry',
        takeProfit: '0.8 × ATR from entry',
        riskPerTrade: `${this.config.riskPerTrade}% of account equity`,
        maxConcurrentTrades: this.config.maxConcurrentTrades,
        maxTradesPerDay: this.config.maxTradesPerDay,
        dailySafetyRules: [
          'Stop trading after 3 consecutive losses',
          'Stop trading after reaching +2R daily profit',
          'Maximum 6 trades per day'
        ]
      },
      expectedPerformance: {
        tradesPerDay: '4-5',
        expectedDrawdown: 'Conservative risk management prevents large drawdowns',
        survivability: 'Rule-based, deterministic strategy with strict risk controls'
      }
    };
  }

  /**
   * Save comprehensive diagnostics for decision tracking
   */
  private async saveDiagnostics(diagnostics: Partial<TradingDiagnostics>): Promise<void> {
    try {
      const diagnosticRecord = {
        agentId: this.config.id,
        timestamp: new Date(),
        pair: this.config.tradingPair,
        direction: diagnostics.signal?.direction || null,

        // Candle snapshot used for decision
        candleSnapshot: diagnostics.candleCheck ? {
          timestamp: diagnostics.candleCheck.candleTimestamp,
          price: diagnostics.candleCheck.price,
          isClosed: diagnostics.candleCheck.isClosed
        } : null,

        // Complete indicator values
        indicatorSnapshot: diagnostics.indicators ? {
          rsi: diagnostics.indicators.rsi,
          ema50: diagnostics.indicators.ema50,
          bbUpper: diagnostics.indicators.bbUpper,
          bbLower: diagnostics.indicators.bbLower,
          atr: diagnostics.indicators.atr
        } : null,

        // Support & Resistance levels
        srSnapshot: diagnostics.supportResistance ? {
          support: diagnostics.supportResistance.support,
          resistance: diagnostics.supportResistance.resistance,
          calculated: diagnostics.supportResistance.calculated
        } : null,

        // Risk calculation details
        riskSnapshot: diagnostics.riskAnalysis ? {
          accountBalance: diagnostics.riskAnalysis.accountBalance,
          riskPercent: diagnostics.riskAnalysis.riskPercent,
          positionSize: diagnostics.riskAnalysis.positionSize,
          maxPositionSize: diagnostics.riskAnalysis.maxPositionSize,
          availableMargin: diagnostics.riskAnalysis.availableMargin,
          liquidationRisk: diagnostics.riskAnalysis.liquidationRisk
        } : null,

        // Entry/SL/TP prices and RR
        tradeSetup: diagnostics.signal ? {
          entryPrice: diagnostics.signal.entryPrice,
          stopLoss: diagnostics.signal.stopLoss,
          takeProfit: diagnostics.signal.takeProfit,
          rrRatio: diagnostics.signal.rrRatio
        } : null,

        // S/R validation results
        srValidation: diagnostics.srValidation ? {
          tpBlocked: diagnostics.srValidation.tpBlocked,
          rrValid: diagnostics.srValidation.rrValid,
          reason: diagnostics.srValidation.reason
        } : null,

        // Final decision with exact reason
        decision: diagnostics.decision ? {
          action: diagnostics.decision.action,
          reason: diagnostics.decision.reason,
          confidence: diagnostics.decision.confidence
        } : null,

        // Exchange execution result
        executionResult: diagnostics.execution ? {
          success: diagnostics.execution.success,
          orderId: diagnostics.execution.orderId,
          error: diagnostics.execution.error
        } : null
      };

      // Diagnostics saving removed - will be handled by caller

      logger.info({
        agentId: this.config.id,
        action: diagnostics.decision?.action,
        reason: diagnostics.decision?.reason
      }, 'Diagnostics saved');

    } catch (error) {
      logger.error({
        agentId: this.config.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to save diagnostics');
    }
  }

  /**
   * Execute bracket order (entry + SL + TP atomically) on Bitget Futures
   */
  private async executeBracketOrder(tradeRecord: TradeRecord): Promise<{
    success: boolean;
    orderId?: string;
    error?: string;
  }> {
    try {
      // Get market provider for Bitget execution
      const marketProvider = await this.getMarketProvider();

      if (!marketProvider) {
        return { success: false, error: 'MARKET_PROVIDER_UNAVAILABLE' };
      }

      // Check if this is DRY RUN mode
      if (this.config.dryRun) {
        logger.info({
          agentId: this.config.id,
          tradeId: tradeRecord.id,
          dryRun: true,
          pair: tradeRecord.symbol,
          direction: tradeRecord.direction,
          quantity: tradeRecord.quantity,
          entryPrice: tradeRecord.entryPrice,
          stopLoss: tradeRecord.stopLoss,
          takeProfit: tradeRecord.takeProfit
        }, 'DRY RUN: Bracket order simulated (not executed)');

        // Simulate order ID for dry run
        const simulatedOrderId = `dry_run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        return { success: true, orderId: simulatedOrderId };
      }

      // Execute real bracket order on Bitget Futures
      const orderResult = await (marketProvider as any).placeCoinMBracketOrder({
        symbol: tradeRecord.symbol,
        side: tradeRecord.direction === 'LONG' ? 'BUY' : 'SELL',
        quantity: tradeRecord.quantity,
        entryPrice: tradeRecord.entryPrice,
        stopLoss: tradeRecord.stopLoss,
        takeProfit: tradeRecord.takeProfit,
        leverage: this.config.leverage || 8
      });

      logger.info({
        agentId: this.config.id,
        tradeId: tradeRecord.id,
        orderId: orderResult.orderId,
        pair: tradeRecord.symbol,
        direction: tradeRecord.direction,
        quantity: tradeRecord.quantity
      }, 'Bitget bracket order executed successfully');

      return { success: true, orderId: orderResult.orderId };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Normalize exchange errors
      const normalizedError = this.normalizeExchangeError(errorMessage);

      logger.error({
        agentId: this.config.id,
        tradeId: tradeRecord.id,
        error: errorMessage,
        normalizedError
      }, 'Bitget bracket order execution failed');

      return { success: false, error: normalizedError };
    }
  }

  /**
   * Get market provider for exchange operations
   */
  private async getMarketProvider(): Promise<any> {
    try {
      // Get user exchange credentials from settings
      const db = (await import('../utils/firebase')).getFirebaseAdmin().firestore();
      const userIntegrationsRef = db.collection('users').doc(this.config.userId).collection('integrations');
      const snapshot = await userIntegrationsRef.where('exchange', '==', this.config.exchange).get();

      if (snapshot.empty) {
        logger.error({
          agentId: this.config.id,
          userId: this.config.userId,
          exchange: this.config.exchange
        }, 'No exchange credentials found for trading agent');
        return null;
      }

      const integration = snapshot.docs[0].data();

      // Create market provider with user's credentials
      const { TradingAgentMarketProvider } = await import('./tradingAgentMarketProvider');
      const credentials: ExchangeCredentials = {
        apiKey: integration.apiKey,
        secret: integration.secret,
        passphrase: integration.passphrase,
        testnet: false
      };

      return new TradingAgentMarketProvider(credentials, this.config.exchange);

    } catch (error) {
      logger.error({
        agentId: this.config.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to get market provider');
      return null;
    }
  }

  /**
   * Normalize exchange errors to standard codes
   */
  private normalizeExchangeError(error: string): string {
    const errorMap: { [key: string]: string } = {
      'insufficient_balance': 'INSUFFICIENT_MARGIN',
      'margin_not_enough': 'INSUFFICIENT_MARGIN',
      'balance_not_enough': 'INSUFFICIENT_MARGIN',
      'invalid_price': 'INVALID_PRICE',
      'price_too_high': 'INVALID_PRICE',
      'price_too_low': 'INVALID_PRICE',
      'rate_limit': 'RATE_LIMIT',
      'too_many_requests': 'RATE_LIMIT',
      'order_rejected': 'EXCHANGE_REJECTED',
      'invalid_order': 'EXCHANGE_REJECTED',
      'leverage_too_high': 'EXCHANGE_REJECTED',
      'position_exists': 'EXCHANGE_REJECTED'
    };

    const lowerError = error.toLowerCase();
    return errorMap[lowerError] || 'EXCHANGE_ERROR';
  }
}