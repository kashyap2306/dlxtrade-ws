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
        return diagnostics;
      }

      // Get market data
      const candles = await marketDataProvider.getCandles(symbol, '5m', 50);
      if (!candles || candles.length < 20) {
        diagnostics.decision = { action: 'SKIP', reason: 'Insufficient market data' };
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
      const signal = this.generateSignal(currentCandle, vwap, ema200, atr, diagnostics.marketData.deviationPercent);
      diagnostics.signal = signal;

      if (!signal.meetsConditions) {
        diagnostics.decision = { action: 'SKIP', reason: signal.reason || 'Conditions not met' };
        return diagnostics;
      }

      // Risk analysis
      const accountBalance = await marketDataProvider.getAccountBalance();
      const riskAmount = accountBalance.equity * this.config.riskPerTrade;
      const stopDistance = atr * 1.2;
      const positionSize = stopDistance > 0 ? (riskAmount / stopDistance) : 0;

      // Validate RR (hard gate)
      const entryPrice = Number(signal.entryPrice) || 0;
      const stopLoss = Number(signal.stopLoss) || 0;
      const takeProfit = Number(signal.takeProfit) || 0;
      const riskPerUnit = Math.abs(entryPrice - stopLoss);
      const rewardPerUnit = Math.abs(takeProfit - entryPrice);
      const rrRatio = riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : 0;
      diagnostics.signal.rrRatio = rrRatio;

      if (!isFinite(rrRatio) || rrRatio < 1.3) {
        diagnostics.decision = { action: 'SKIP', reason: `RR_TOO_LOW_${rrRatio.toFixed(2)}` };
        return diagnostics;
      }

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

        diagnostics.decision = { action: 'TRADE', reason: `Executed ${signal.direction} trade` };
        this.lastExecutionTime = new Date();
      } else {
        diagnostics.decision = { action: 'TRADE', reason: `DRY RUN: Would execute ${signal.direction} trade` };
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
   */
  private checkTradingSession() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMinute = now.getUTCMinutes();

    // London session: 8:00-16:59 UTC
    if (utcHour >= 8 && utcHour < 17) {
      return {
        isValidSession: true,
        currentTime: `${utcHour}:${utcMinute.toString().padStart(2, '0')} UTC`,
        sessionType: 'London' as const
      };
    }

    // New York session: 14:30-21:29 UTC
    if ((utcHour === 14 && utcMinute >= 30) || (utcHour >= 15 && utcHour < 21) || (utcHour === 21 && utcMinute < 30)) {
      return {
        isValidSession: true,
        currentTime: `${utcHour}:${utcMinute.toString().padStart(2, '0')} UTC`,
        sessionType: 'NewYork' as const
      };
    }

    return {
      isValidSession: false,
      currentTime: `${utcHour}:${utcMinute.toString().padStart(2, '0')} UTC`,
      reason: 'Outside London/NY trading sessions'
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
   */
  private generateSignal(
    currentCandle: CandleData,
    vwap: number,
    ema200: number,
    atr: number,
    deviationPercent: number
  ): VWAPStrategyDiagnostics['signal'] {

    const signal = {
      direction: null as 'LONG' | 'SHORT' | null,
      entryPrice: currentCandle.close,
      stopLoss: 0,
      takeProfit: 0,
      meetsConditions: false,
      reason: ''
    };

    // LONG ENTRY RULES:
    // 1. Price above EMA 200 (bullish bias)
    if (currentCandle.close <= ema200) {
      signal.reason = 'Price below EMA 200';
      return signal;
    }

    // 2. Price below VWAP (reversion opportunity)
    if (currentCandle.close >= vwap) {
      signal.reason = 'Price above VWAP';
      return signal;
    }

    // 3. Deviation threshold (BTC ≥0.8%, ETH ≥0.6%)
    const minDeviation = this.config.tradingPair === 'BTC/USDT' ? 0.8 : 0.6;
    if (deviationPercent < minDeviation) {
      signal.reason = `Deviation ${deviationPercent.toFixed(2)}% below threshold ${minDeviation}%`;
      return signal;
    }

    // 4. Bullish rejection candle
    if (!this.isBullishRejection(currentCandle)) {
      signal.reason = 'Not a bullish rejection candle';
      return signal;
    }

    // Generate LONG signal
    signal.direction = 'LONG';
    signal.stopLoss = currentCandle.close - (1.2 * atr);
    signal.takeProfit = vwap; // Primary exit at VWAP
    signal.meetsConditions = true;

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
}