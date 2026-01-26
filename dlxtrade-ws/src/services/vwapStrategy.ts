import { logger } from '../utils/logger';
import { TechnicalIndicators, CandleData } from './technicalIndicators';
import { ExchangeCredentials } from './exchangeConnector';

export interface VWAPStrategyConfig {
  userId: string;
  agentId: string;
  tradingPair: 'BTC/USDT' | 'ETH/USDT';
  marketType: 'spot' | 'futures';
  exchange: 'bitget' | 'binance' | 'bybit';
  riskPerTrade: number; // fraction of equity (e.g. 0.02 = 2%)
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  dryRun: boolean;
}

export interface VWAPStrategyDiagnostics {
  timestamp: Date;
  agentId: string;
  tradingPair: string;
  sessionCheck: {
    isValidSession: boolean;
    currentTime: string;
    sessionType?: 'London' | 'NewYork';
    reason?: string;
  };
  marketData: {
    currentPrice: number;
    vwap: number;
    ema200: number;
    atr: number;
    deviation: number;
    deviationPercent: number;
  };
  signal: {
    direction: 'LONG' | 'SHORT' | null;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    rrRatio?: number;
    meetsConditions: boolean;
    reason?: string;
  };
  riskAnalysis: {
    accountBalance: number;
    riskAmount: number;
    positionSize: number;
    maxPositionSize: number;
  };
  decision: {
    action: 'TRADE' | 'SKIP';
    reason: string;
  };
  execution?: {
    success: boolean;
    orderId?: string;
    error?: string;
  };
}

export class VWAPStrategy {
  private config: VWAPStrategyConfig;
  private technicalIndicators: TechnicalIndicators;
  private isRunning: boolean = false;
  private lastExecutionTime: Date | null = null;

  constructor(config: VWAPStrategyConfig) {
    this.config = config;
    this.technicalIndicators = new TechnicalIndicators();
  }

  /**
   * Start the VWAP strategy execution
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn({ agentId: this.config.agentId }, 'VWAP Strategy already running');
      return;
    }

    this.isRunning = true;
    logger.info({ agentId: this.config.agentId, strategyType: 'VWAP_MEAN_REVERSION' }, 'VWAP Strategy started');
  }

  /**
   * Stop the VWAP strategy execution
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    logger.info({ agentId: this.config.agentId, strategyType: 'VWAP_MEAN_REVERSION' }, 'VWAP Strategy stopped');
  }

  /**
   * Check if strategy is currently running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Execute VWAP strategy logic (called by scheduler)
   */
  async execute(marketDataProvider: any): Promise<VWAPStrategyDiagnostics> {
    const diagnostics: VWAPStrategyDiagnostics = {
      timestamp: new Date(),
      agentId: this.config.agentId,
      tradingPair: this.config.tradingPair,
      sessionCheck: { isValidSession: false, currentTime: '' },
      marketData: { currentPrice: 0, vwap: 0, ema200: 0, atr: 0, deviation: 0, deviationPercent: 0 },
      signal: { direction: null, entryPrice: 0, stopLoss: 0, takeProfit: 0, rrRatio: 0, meetsConditions: false },
      riskAnalysis: { accountBalance: 0, riskAmount: 0, positionSize: 0, maxPositionSize: 0 },
      decision: { action: 'SKIP', reason: 'Execution started' }
    };

    try {
      const symbol = this.config.tradingPair.replace('/', '').toUpperCase();

      // Check trading session
      const sessionCheck = this.checkTradingSession();
      diagnostics.sessionCheck = sessionCheck;

      if (!sessionCheck.isValidSession) {
        diagnostics.decision = { action: 'SKIP', reason: sessionCheck.reason || 'Outside trading hours' };
        logger.warn({
          agentId: this.config.agentId,
          currentTime: sessionCheck.currentTime,
          reason: sessionCheck.reason
        }, 'SKIP: Session check failed');
        return diagnostics;
      }

      // Get market data
      const candles = await marketDataProvider.getCandles(symbol, '5m', 50);
      if (!candles || candles.length < 20) {
        diagnostics.decision = { action: 'SKIP', reason: 'Insufficient market data' };
        logger.warn({
          agentId: this.config.agentId,
          symbol,
          candleCount: candles?.length || 0,
          required: 20
        }, 'SKIP: INSUFFICIENT_MARKET_DATA - need at least 20 candles');
        return diagnostics;
      }

      // Calculate indicators
      const currentCandle = candles[candles.length - 1];
      const vwap = this.calculateVWAP(candles);
      const ema200 = this.calculateEMA(candles.map(c => c.close), 200);
      const atr = this.calculateATR(candles, 14);

      diagnostics.marketData = {
        currentPrice: currentCandle.close,
        vwap: vwap,
        ema200: ema200,
        atr: atr,
        deviation: Math.abs(currentCandle.close - vwap),
        deviationPercent: Math.abs(currentCandle.close - vwap) / vwap * 100
      };

      // Check entry conditions
      const signal = this.generateSignal(currentCandle, vwap, ema200, atr, diagnostics.marketData.deviationPercent, candles);
      diagnostics.signal = signal;

      if (!signal.meetsConditions) {
        diagnostics.decision = { action: 'SKIP', reason: signal.reason || 'Conditions not met' };
        return diagnostics;
      }

      // Validate RR (hard gate) - already done in generateSignal, but double-check
      const entryPrice = Number(signal.entryPrice) || 0;
      const stopLoss = Number(signal.stopLoss) || 0;
      const takeProfit = Number(signal.takeProfit) || 0;
      const riskPerUnit = Math.abs(entryPrice - stopLoss);
      const rewardPerUnit = Math.abs(takeProfit - entryPrice);
      const rrRatio = riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : 0;
      diagnostics.signal.rrRatio = rrRatio;

      if (!isFinite(rrRatio) || rrRatio < 1.0) {
        diagnostics.decision = { action: 'SKIP', reason: `RR_TOO_LOW_${rrRatio.toFixed(2)}` };
        return diagnostics;
      }

      // Risk analysis
      const accountBalance = await marketDataProvider.getAccountBalance();
      const riskAmount = accountBalance.equity * this.config.riskPerTrade;
      const stopDistance = Math.abs(entryPrice - stopLoss);
      const positionSize = stopDistance > 0 ? (riskAmount / stopDistance) : 0;

      diagnostics.riskAnalysis = {
        accountBalance: accountBalance.equity,
        riskAmount: riskAmount,
        positionSize: positionSize,
        maxPositionSize: accountBalance.available
      };

      // Validate position size
      if (!isFinite(positionSize) || positionSize <= 0) {
        diagnostics.decision = { action: 'SKIP', reason: 'INVALID_POSITION_SIZE' };
        return diagnostics;
      }

      // Futures margin sanity check (5x leverage): notional/lev must be <= available USDT
      const leverage = 5;
      const notionalUsd = entryPrice > 0 ? positionSize * entryPrice : 0;
      const marginRequired = leverage > 0 ? notionalUsd / leverage : notionalUsd;
      if (!isFinite(marginRequired) || marginRequired <= 0 || marginRequired > accountBalance.available) {
        diagnostics.decision = { action: 'SKIP', reason: 'INSUFFICIENT_MARGIN' };
        return diagnostics;
      }

      // Execute trade if not in dry run mode
      if (!this.config.dryRun) {
        const orderResult = await marketDataProvider.placeOrder({
          symbol: symbol,
          side: signal.direction === 'LONG' ? 'BUY' : 'SELL',
          type: 'MARKET',
          quantity: positionSize,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit
        });

        diagnostics.execution = {
          success: true,
          orderId: orderResult
        };

        diagnostics.decision = { action: 'TRADE', reason: `Executed ${signal.direction} trade with SL/TP on exchange` };
        this.lastExecutionTime = new Date();
      } else {
        diagnostics.decision = { action: 'TRADE', reason: `DRY RUN: Would execute ${signal.direction} trade with SL/TP` };
        diagnostics.execution = {
          success: true,
          orderId: 'DRY_RUN'
        };
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        agentId: this.config.agentId
      }, 'VWAP Strategy execution error');

      diagnostics.decision = { action: 'SKIP', reason: 'Execution error' };
    }

    return diagnostics;
  }


  /**
   * Check if current time is within trading sessions (London/NY)
   * FIX: Enhanced logging for session filter clarity
   */
  private checkTradingSession() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMinute = now.getUTCMinutes();
    const currentTime = `${utcHour}:${utcMinute.toString().padStart(2, '0')} UTC`;

    // London session: 8:00-16:59 UTC
    if (utcHour >= 8 && utcHour < 17) {
      logger.info({
        currentTime,
        session: 'London',
        sessionWindow: '08:00-16:59 UTC'
      }, 'SESSION_CHECK: Within London trading session');
      return {
        isValidSession: true,
        currentTime,
        sessionType: 'London' as const
      };
    }

    // New York session: 14:30-21:29 UTC
    if ((utcHour === 14 && utcMinute >= 30) || (utcHour >= 15 && utcHour < 21) || (utcHour === 21 && utcMinute < 30)) {
      logger.info({
        currentTime,
        session: 'NewYork',
        sessionWindow: '14:30-21:29 UTC'
      }, 'SESSION_CHECK: Within New York trading session');
      return {
        isValidSession: true,
        currentTime,
        sessionType: 'NewYork' as const
      };
    }

    // Outside trading hours
    const nextSessionStart = utcHour < 8 ? '08:00 UTC (London)' : '14:30 UTC (New York next day)';
    logger.warn({
      currentTime,
      londonSession: '08:00-16:59 UTC',
      newYorkSession: '14:30-21:29 UTC',
      nextSessionStart
    }, 'SKIP: OUTSIDE_TRADING_HOURS - current time outside London/NY sessions');

    return {
      isValidSession: false,
      currentTime,
      reason: `Outside trading hours (London: 08:00-16:59 UTC, NY: 14:30-21:29 UTC). Next session: ${nextSessionStart}`
    };
  }

  /**
   * Calculate VWAP from candle data
   */
  private calculateVWAP(candles: CandleData[]): number {
    let priceVolumeSum = 0;
    let volumeSum = 0;

    for (const candle of candles) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume || 1; // Fallback if volume not available

      priceVolumeSum += typicalPrice * volume;
      volumeSum += volume;
    }

    return volumeSum > 0 ? priceVolumeSum / volumeSum : candles[candles.length - 1].close;
  }

  /**
   * Calculate EMA from price array
   */
  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1];

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
    }

    return ema;
  }

  /**
   * Calculate ATR (Average True Range)
   */
  private calculateATR(candles: CandleData[], period: number): number {
    if (candles.length < period + 1) return 0;

    const trueRanges: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const candle = candles[i];
      const prevCandle = candles[i - 1];

      const tr1 = candle.high - candle.low;
      const tr2 = Math.abs(candle.high - prevCandle.close);
      const tr3 = Math.abs(candle.low - prevCandle.close);

      trueRanges.push(Math.max(tr1, tr2, tr3));
    }

    // Simple average of true ranges (could be improved with exponential smoothing)
    return trueRanges.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
  }

  /**
   * Generate trading signal based on VWAP strategy rules
   * FIX: Added EMA 200 buffer for flexibility (1.5% buffer - more relaxed)
   * FIX: Clear skip reason logging for every condition
   */
  private generateSignal(
    currentCandle: CandleData,
    vwap: number,
    ema200: number,
    atr: number,
    deviationPercent: number,
    candles: CandleData[]
  ): VWAPStrategyDiagnostics['signal'] {

    const signal = {
      direction: null as 'LONG' | 'SHORT' | null,
      entryPrice: currentCandle.close,
      stopLoss: 0,
      takeProfit: 0,
      meetsConditions: false,
      reason: ''
    };

    // FIX: EMA 200 FLEXIBILITY - allow configurable buffer (1.5% below EMA 200)
    // This allows trades slightly below EMA 200 in strong trends - more relaxed
    const ema200Buffer = ema200 * 0.015; // 1.5% buffer (increased from 1%)
    const ema200Threshold = ema200 - ema200Buffer;

    // LONG ENTRY RULES:
    // 1. Price above EMA 200 (with buffer for flexibility)
    if (currentCandle.close < ema200Threshold) {
      const distanceFromEMA = ((ema200 - currentCandle.close) / ema200 * 100).toFixed(2);
      logger.warn({
        currentPrice: currentCandle.close,
        ema200,
        ema200Threshold,
        ema200Buffer,
        distancePercent: distanceFromEMA + '%'
      }, `SKIP: PRICE_BELOW_EMA200 - price ${distanceFromEMA}% below EMA 200 threshold (buffer: 1.5%)`);
      signal.reason = `Price ${distanceFromEMA}% below EMA 200 (threshold with 1.5% buffer: ${ema200Threshold.toFixed(2)})`;
      return signal;
    }

    // 2. Price below VWAP (reversion opportunity)
    if (currentCandle.close >= vwap) {
      const distanceFromVWAP = ((currentCandle.close - vwap) / vwap * 100).toFixed(2);
      logger.warn({
        currentPrice: currentCandle.close,
        vwap,
        distancePercent: distanceFromVWAP + '%'
      }, `SKIP: PRICE_ABOVE_VWAP - price ${distanceFromVWAP}% above VWAP, no mean reversion opportunity`);
      signal.reason = `Price ${distanceFromVWAP}% above VWAP (need price below VWAP for LONG)`;
      return signal;
    }

    // 3. Deviation threshold (BTC ≥0.8%, ETH ≥0.6%)
    const minDeviation = this.config.tradingPair === 'BTC/USDT' ? 0.8 : 0.6;
    if (deviationPercent < minDeviation) {
      logger.warn({
        deviationPercent: deviationPercent.toFixed(2) + '%',
        minRequired: minDeviation + '%',
        pair: this.config.tradingPair
      }, `SKIP: INSUFFICIENT_VWAP_DEVIATION - deviation ${deviationPercent.toFixed(2)}% below ${minDeviation}% threshold`);
      signal.reason = `Deviation ${deviationPercent.toFixed(2)}% below threshold ${minDeviation}%`;
      return signal;
    }

    // 4. Bullish rejection candle
    if (!this.isBullishRejection(currentCandle)) {
      logger.warn({
        open: currentCandle.open,
        close: currentCandle.close,
        high: currentCandle.high,
        low: currentCandle.low
      }, 'SKIP: NOT_BULLISH_REJECTION - candle does not show bullish rejection pattern');
      signal.reason = 'Not a bullish rejection candle (need close > open with 30%+ body)';
      return signal;
    }

    // Generate LONG signal with SIMPLE swing-structure SL/TP
    signal.direction = 'LONG';
    
    // SIMPLE SWING-STRUCTURE SL/TP LOGIC
    // 1) SL: LONG = just BELOW the last clear swing LOW
    signal.stopLoss = this.findSwingLow(candles);
    
    // 2) TP: LONG = nearest visible RESISTANCE
    signal.takeProfit = this.findNearestResistance(candles, currentCandle.close);
    
    // 3) RR CHECK: Minimum RR = 1:1
    const riskPerUnit = Math.abs(currentCandle.close - signal.stopLoss);
    const rewardPerUnit = Math.abs(signal.takeProfit - currentCandle.close);
    const rrRatio = riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : 0;
    
    // If RR < 1 → SKIP trade (do NOT force TP or SL)
    if (!isFinite(rrRatio) || rrRatio < 1.0) {
      logger.warn({
        entryPrice: currentCandle.close,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        riskPerUnit,
        rewardPerUnit,
        rrRatio: rrRatio.toFixed(2)
      }, 'VWAP LONG: RR_FAIL - Risk/Reward ratio below 1:1');
      
      signal.reason = `RR_FAIL: ${rrRatio.toFixed(2)} < 1.0`;
      signal.meetsConditions = false;
      return signal;
    }
    
    // Check if structure is clear - if structure is unclear → SKIP
    if (signal.stopLoss >= currentCandle.close || signal.takeProfit <= currentCandle.close) {
      logger.warn({
        entryPrice: currentCandle.close,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit
      }, 'VWAP LONG: NO_STRUCTURE - Invalid swing structure');
      
      signal.reason = 'NO_STRUCTURE: Invalid swing levels';
      signal.meetsConditions = false;
      return signal;
    }

    // If SL too far & TP too close → SKIP (no extra filters allowed)
    const slDistancePercent = Math.abs((currentCandle.close - signal.stopLoss) / currentCandle.close) * 100;
    const tpDistancePercent = Math.abs((signal.takeProfit - currentCandle.close) / currentCandle.close) * 100;
    
    if (slDistancePercent > 2.0 && tpDistancePercent < 0.5) {
      logger.warn({
        entryPrice: currentCandle.close,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        slDistancePercent: slDistancePercent.toFixed(2),
        tpDistancePercent: tpDistancePercent.toFixed(2)
      }, 'VWAP LONG: POOR_STRUCTURE - SL too far & TP too close');
      
      signal.reason = 'POOR_STRUCTURE: SL too far & TP too close';
      signal.meetsConditions = false;
      return signal;
    }

    signal.meetsConditions = true;

    logger.info({
      direction: 'LONG',
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      vwap,
      ema200,
      ema200Threshold,
      deviation: deviationPercent.toFixed(2) + '%'
    }, '✅ VWAP_SIGNAL_GENERATED - all conditions met for LONG entry');

    return signal;
  }

  /**
   * Check if candle is a bullish rejection
   */
  private isBullishRejection(candle: CandleData): boolean {
    // Close higher than open (bullish candle)
    if (candle.close <= candle.open) return false;

    // Body should be reasonably sized (not a doji)
    const bodySize = Math.abs(candle.close - candle.open);
    const totalRange = candle.high - candle.low;

    if (totalRange === 0) return false;

    // Body should be at least 30% of total range
    return (bodySize / totalRange) >= 0.3;
  }

  /**
   * Find swing low for LONG stop loss - SIMPLE approach
   * LONG: place SL just BELOW the last clear swing LOW
   */
  private findSwingLow(candles: CandleData[]): number {
    const lookback = Math.min(20, candles.length);
    const recentCandles = candles.slice(-lookback); // Take last 20 candles
    const lows = recentCandles.map(c => c.low);
    const swingLow = Math.min(...lows);
    
    // Place SL just BELOW the swing low (no ATR, no buffers, no extra math)
    return swingLow * 0.999; // Just below swing low
  }

  /**
   * Find swing high for SHORT stop loss - SIMPLE approach
   * SHORT: place SL just ABOVE the last clear swing HIGH
   */
  private findSwingHigh(candles: CandleData[]): number {
    const lookback = Math.min(20, candles.length);
    const recentCandles = candles.slice(-lookback); // Take last 20 candles
    const highs = recentCandles.map(c => c.high);
    const swingHigh = Math.max(...highs);
    
    // Place SL just ABOVE the swing high (no ATR, no buffers, no extra math)
    return swingHigh * 1.001; // Just above swing high
  }

  /**
   * Find nearest resistance for LONG take profit - SIMPLE approach
   * LONG: nearest visible RESISTANCE
   */
  private findNearestResistance(candles: CandleData[], entryPrice: number): number {
    const lookback = Math.min(50, candles.length);
    const recentCandles = candles.slice(-lookback); // Take last 50 candles
    
    // Find highs above entry price that could act as resistance
    const resistanceLevels = recentCandles
      .map(c => c.high)
      .filter(high => high > entryPrice)
      .sort((a, b) => a - b); // Sort ascending to get nearest first
    
    // Return nearest visible resistance above entry
    // If no clear resistance found, skip trade (will be caught by RR check)
    return resistanceLevels.length > 0 ? resistanceLevels[0] : entryPrice * 1.005; // Minimal fallback
  }

  /**
   * Find nearest support for SHORT take profit - SIMPLE approach
   * SHORT: nearest visible SUPPORT
   */
  private findNearestSupport(candles: CandleData[], entryPrice: number): number {
    const lookback = Math.min(50, candles.length);
    const recentCandles = candles.slice(-lookback); // Take last 50 candles
    
    // Find lows below entry price that could act as support
    const supportLevels = recentCandles
      .map(c => c.low)
      .filter(low => low < entryPrice)
      .sort((a, b) => b - a); // Sort descending to get nearest first
    
    // Return nearest visible support below entry
    // If no clear support found, skip trade (will be caught by RR check)
    return supportLevels.length > 0 ? supportLevels[0] : entryPrice * 0.995; // Minimal fallback
  }
}