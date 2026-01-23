import { logger } from '../utils/logger';
import { TechnicalIndicators, CandleData } from './technicalIndicators';

/**
 * HTF Trend Filter + EMA Pullback + RSI + Bollinger Scalping Strategy
 * 
 * Strategy Logic:
 * 1. HTF (15m): EMA 50 > EMA 200 → LONG ONLY, EMA 50 < EMA 200 → SHORT ONLY
 * 2. LTF (1m) LONG: Price > EMA 200, Pullback near EMA 50, RSI 40-50, Touch lower BB, Bullish close, Volume ≥ previous
 * 3. LTF (1m) SHORT: Price < EMA 200, Pullback near EMA 50, RSI 50-60, Touch upper BB, Bearish close, Volume ≥ previous
 * 4. Risk: 1% per trade, SL at swing high/low, TP = 1.2 × SL distance
 * 5. Max 1 trade per pair, Max 3 trades/day/pair, Max 5% daily loss
 */

export type HTFTrendDirection = 'LONG_ONLY' | 'SHORT_ONLY' | 'NO_TRADE';

export interface HTFTrendAnalysis {
  direction: HTFTrendDirection;
  ema50: number;
  ema200: number;
  reason: string;
}

export interface LTFEntrySignal {
  isValid: boolean;
  direction: 'LONG' | 'SHORT' | null;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  reason: string;
  indicators: {
    price: number;
    ema50: number;
    ema200: number;
    rsi: number;
    bbUpper: number;
    bbLower: number;
    volume: number;
    previousVolume: number;
    results?: {
      ema?: { value: number; status: 'confirmed' | 'rejected'; details?: string };
      rsi?: { value: number; range: string; status: 'confirmed' | 'rejected'; details?: string };
      vwap?: { status: 'confirmed' | 'rejected'; details?: string };
      sr?: { status: 'confirmed' | 'rejected'; details?: string };
      volume?: { status: 'confirmed' | 'rejected'; details?: string };
    };
  };
}

export class HTFTrendFilterStrategy {
  /**
   * Analyze HTF (15m) trend using EMA 50 and EMA 200
   */
  static analyzeHTFTrend(candles15m: CandleData[]): HTFTrendAnalysis {
    if (candles15m.length < 200) {
      return {
        direction: 'NO_TRADE',
        ema50: 0,
        ema200: 0,
        reason: 'Insufficient candles for HTF analysis (need 200+)'
      };
    }

    const closes = candles15m.map(c => c.close);
    const ema50 = TechnicalIndicators.calculateEMA(closes, 50);
    const ema200 = TechnicalIndicators.calculateEMA(closes, 200);

    // Calculate percentage difference to avoid false signals during crossover
    const emaDiffPercent = Math.abs((ema50 - ema200) / ema200) * 100;
    const minDiffPercent = 0.1; // Minimum 0.1% difference to avoid flat/crossing zones

    if (emaDiffPercent < minDiffPercent) {
      return {
        direction: 'NO_TRADE',
        ema50,
        ema200,
        reason: `EMA 50 and EMA 200 too close (${emaDiffPercent.toFixed(3)}% < ${minDiffPercent}%)`
      };
    }

    if (ema50 > ema200) {
      return {
        direction: 'LONG_ONLY',
        ema50,
        ema200,
        reason: `EMA 50 (${ema50.toFixed(2)}) > EMA 200 (${ema200.toFixed(2)}) - LONG ONLY`
      };
    } else {
      return {
        direction: 'SHORT_ONLY',
        ema50,
        ema200,
        reason: `EMA 50 (${ema50.toFixed(2)}) < EMA 200 (${ema200.toFixed(2)}) - SHORT ONLY`
      };
    }
  }

  /**
   * Analyze LTF (1m) entry conditions with enhanced diagnostics
   */
  static analyzeLTFEntry(candles1m: CandleData[], htfTrend: HTFTrendDirection): LTFEntrySignal {
    if (htfTrend === 'NO_TRADE') {
      return {
        isValid: false,
        direction: null,
        entryPrice: 0,
        stopLoss: 0,
        takeProfit: 0,
        reason: 'HTF trend is NO_TRADE',
        indicators: {} as any
      };
    }

    if (candles1m.length < 200) {
      return {
        isValid: false,
        direction: null,
        entryPrice: 0,
        stopLoss: 0,
        takeProfit: 0,
        reason: 'Insufficient candles for LTF analysis (need 200+)',
        indicators: {} as any
      };
    }

    // Calculate indicators
    const closes = candles1m.map(c => c.close);
    const ema50 = TechnicalIndicators.calculateEMA(closes, 50);
    const ema200 = TechnicalIndicators.calculateEMA(closes, 200);
    const rsi = TechnicalIndicators.calculateRSI(closes, 14);
    const bb = TechnicalIndicators.calculateBollingerBands(closes, 20, 2);

    const latestCandle = candles1m[0]; // Most recent candle
    const previousCandle = candles1m[1];
    const price = latestCandle.close;
    const volume = latestCandle.volume;
    const previousVolume = previousCandle.volume;

    // Check for pullback near EMA 50 (within 0.5% tolerance)
    const distanceToEma50Percent = Math.abs((price - ema50) / ema50) * 100;
    const maxEma50Distance = 0.5; // 0.5% tolerance

    const indicators = {
      price,
      ema50,
      ema200,
      rsi,
      bbUpper: bb.upper,
      bbLower: bb.lower,
      volume,
      previousVolume
    };

    // LONG conditions (only if HTF allows LONG)
    if (htfTrend === 'LONG_ONLY') {
      const priceAboveEma200 = price > ema200;
      const pullbackNearEma50 = distanceToEma50Percent <= maxEma50Distance;
      const rsiInRange = rsi >= 40 && rsi <= 50;
      const touchLowerBB = price <= bb.lower * 1.001; // Touch or slightly pierce (0.1% tolerance)
      const bullishClose = latestCandle.close > latestCandle.open;
      const volumeConfirm = volume >= previousVolume;

      // Create detailed indicator results for diagnostics
      const indicatorResults = {
        ema: { 
          value: ema50, 
          status: (priceAboveEma200 && pullbackNearEma50) ? 'confirmed' as const : 'rejected' as const,
          details: `Price ${priceAboveEma200 ? 'above' : 'below'} EMA200 (${ema200.toFixed(2)}), ${pullbackNearEma50 ? 'near' : 'far from'} EMA50 (${ema50.toFixed(2)})`
        },
        rsi: { 
          value: rsi, 
          range: '40-50',
          status: rsiInRange ? 'confirmed' as const : 'rejected' as const,
          details: `RSI ${rsi.toFixed(2)} ${rsiInRange ? 'within' : 'outside'} range 40-50`
        },
        vwap: { 
          status: touchLowerBB ? 'confirmed' as const : 'rejected' as const,
          details: `Price ${price.toFixed(2)} ${touchLowerBB ? 'touching' : 'not touching'} lower BB ${bb.lower.toFixed(2)}`
        },
        sr: { 
          status: bullishClose ? 'confirmed' as const : 'rejected' as const,
          details: `${bullishClose ? 'Bullish' : 'Bearish'} close (O:${latestCandle.open.toFixed(2)} C:${latestCandle.close.toFixed(2)})`
        },
        volume: { 
          status: volumeConfirm ? 'confirmed' as const : 'rejected' as const,
          details: `Volume ${volume.toFixed(0)} ${volumeConfirm ? '≥' : '<'} previous ${previousVolume.toFixed(0)}`
        }
      };

      // E) TRADE EXECUTION RULES - Execute ONLY if ALL conditions pass
      const allConditionsMet = priceAboveEma200 && pullbackNearEma50 && rsiInRange && touchLowerBB && bullishClose && volumeConfirm;
      
      if (allConditionsMet) {
        // Find swing low for stop loss
        const swingLow = this.findSwingLow(candles1m);
        const stopLoss = swingLow;
        const slDistance = price - stopLoss;
        const takeProfit = price + (slDistance * 1.2); // TP = 1.2 × SL distance

        return {
          isValid: true,
          direction: 'LONG',
          entryPrice: price,
          stopLoss,
          takeProfit,
          reason: 'EMA confirmed, RSI confirmed, VWAP confirmed, SR confirmed, Volume confirmed',
          indicators: { ...indicators, results: indicatorResults }
        };
      } else {
        // Build confirmation-style decision summary
        const confirmedIndicators = [];
        const rejectedIndicators = [];
        
        if (priceAboveEma200 && pullbackNearEma50) confirmedIndicators.push('EMA confirmed');
        else rejectedIndicators.push('EMA rejected');
        
        if (rsiInRange) confirmedIndicators.push('RSI confirmed');
        else rejectedIndicators.push('RSI rejected');
        
        if (touchLowerBB) confirmedIndicators.push('VWAP confirmed');
        else rejectedIndicators.push('VWAP rejected');
        
        if (bullishClose) confirmedIndicators.push('SR confirmed');
        else rejectedIndicators.push('SR rejected');
        
        if (volumeConfirm) confirmedIndicators.push('Volume confirmed');
        else rejectedIndicators.push('Volume rejected');

        const decisionSummary = [...confirmedIndicators, ...rejectedIndicators].join(', ');

        return {
          isValid: false,
          direction: null,
          entryPrice: 0,
          stopLoss: 0,
          takeProfit: 0,
          reason: decisionSummary,
          indicators: { ...indicators, results: indicatorResults }
        };
      }
    }

    // SHORT conditions (only if HTF allows SHORT)
    if (htfTrend === 'SHORT_ONLY') {
      const priceBelowEma200 = price < ema200;
      const pullbackNearEma50 = distanceToEma50Percent <= maxEma50Distance;
      const rsiInRange = rsi >= 50 && rsi <= 60;
      const touchUpperBB = price >= bb.upper * 0.999; // Touch or slightly pierce (0.1% tolerance)
      const bearishClose = latestCandle.close < latestCandle.open;
      const volumeConfirm = volume >= previousVolume;

      // Create detailed indicator results for diagnostics
      const indicatorResults = {
        ema: { 
          value: ema50, 
          status: (priceBelowEma200 && pullbackNearEma50) ? 'confirmed' as const : 'rejected' as const,
          details: `Price ${priceBelowEma200 ? 'below' : 'above'} EMA200 (${ema200.toFixed(2)}), ${pullbackNearEma50 ? 'near' : 'far from'} EMA50 (${ema50.toFixed(2)})`
        },
        rsi: { 
          value: rsi, 
          range: '50-60',
          status: rsiInRange ? 'confirmed' as const : 'rejected' as const,
          details: `RSI ${rsi.toFixed(2)} ${rsiInRange ? 'within' : 'outside'} range 50-60`
        },
        vwap: { 
          status: touchUpperBB ? 'confirmed' as const : 'rejected' as const,
          details: `Price ${price.toFixed(2)} ${touchUpperBB ? 'touching' : 'not touching'} upper BB ${bb.upper.toFixed(2)}`
        },
        sr: { 
          status: bearishClose ? 'confirmed' as const : 'rejected' as const,
          details: `${bearishClose ? 'Bearish' : 'Bullish'} close (O:${latestCandle.open.toFixed(2)} C:${latestCandle.close.toFixed(2)})`
        },
        volume: { 
          status: volumeConfirm ? 'confirmed' as const : 'rejected' as const,
          details: `Volume ${volume.toFixed(0)} ${volumeConfirm ? '≥' : '<'} previous ${previousVolume.toFixed(0)}`
        }
      };

      // E) TRADE EXECUTION RULES - Execute ONLY if ALL conditions pass
      const allConditionsMet = priceBelowEma200 && pullbackNearEma50 && rsiInRange && touchUpperBB && bearishClose && volumeConfirm;
      
      if (allConditionsMet) {
        // Find swing high for stop loss
        const swingHigh = this.findSwingHigh(candles1m);
        const stopLoss = swingHigh;
        const slDistance = stopLoss - price;
        const takeProfit = price - (slDistance * 1.2); // TP = 1.2 × SL distance

        return {
          isValid: true,
          direction: 'SHORT',
          entryPrice: price,
          stopLoss,
          takeProfit,
          reason: 'EMA confirmed, RSI confirmed, VWAP confirmed, SR confirmed, Volume confirmed',
          indicators: { ...indicators, results: indicatorResults }
        };
      } else {
        // Build confirmation-style decision summary
        const confirmedIndicators = [];
        const rejectedIndicators = [];
        
        if (priceBelowEma200 && pullbackNearEma50) confirmedIndicators.push('EMA confirmed');
        else rejectedIndicators.push('EMA rejected');
        
        if (rsiInRange) confirmedIndicators.push('RSI confirmed');
        else rejectedIndicators.push('RSI rejected');
        
        if (touchUpperBB) confirmedIndicators.push('VWAP confirmed');
        else rejectedIndicators.push('VWAP rejected');
        
        if (bearishClose) confirmedIndicators.push('SR confirmed');
        else rejectedIndicators.push('SR rejected');
        
        if (volumeConfirm) confirmedIndicators.push('Volume confirmed');
        else rejectedIndicators.push('Volume rejected');

        const decisionSummary = [...confirmedIndicators, ...rejectedIndicators].join(', ');

        return {
          isValid: false,
          direction: null,
          entryPrice: 0,
          stopLoss: 0,
          takeProfit: 0,
          reason: decisionSummary,
          indicators: { ...indicators, results: indicatorResults }
        };
      }
    }

    return {
      isValid: false,
      direction: null,
      entryPrice: 0,
      stopLoss: 0,
      takeProfit: 0,
      reason: 'Invalid HTF trend direction',
      indicators
    };
  }

  /**
   * Find swing low for LONG stop loss
   * Looks back 20 candles for the lowest low
   */
  private static findSwingLow(candles: CandleData[]): number {
    const lookback = Math.min(20, candles.length);
    const recentCandles = candles.slice(0, lookback);
    const lows = recentCandles.map(c => c.low);
    return Math.min(...lows);
  }

  /**
   * Find swing high for SHORT stop loss
   * Looks back 20 candles for the highest high
   */
  private static findSwingHigh(candles: CandleData[]): number {
    const lookback = Math.min(20, candles.length);
    const recentCandles = candles.slice(0, lookback);
    const highs = recentCandles.map(c => c.high);
    return Math.max(...highs);
  }

  /**
   * Calculate position size based on 1% risk
   */
  static calculatePositionSize(
    accountBalance: number,
    entryPrice: number,
    stopLoss: number,
    leverage: number = 8
  ): {
    positionSize: number;
    marginRequired: number;
    isSafe: boolean;
    reason?: string;
  } {
    try {
      const riskPercent = 1; // Fixed 1% risk per trade
      const riskAmount = accountBalance * (riskPercent / 100);
      const slDistance = Math.abs(entryPrice - stopLoss);

      if (slDistance === 0) {
        return {
          positionSize: 0,
          marginRequired: 0,
          isSafe: false,
          reason: 'INVALID_SL_DISTANCE'
        };
      }

      // Position size = risk amount / SL distance
      const positionValueUSD = riskAmount / slDistance;
      const leveragedPositionValue = positionValueUSD * leverage;
      const positionSize = leveragedPositionValue / entryPrice;
      const marginRequired = leveragedPositionValue / leverage;

      // Safety checks
      const maxMarginUsage = 70; // Max 70% margin usage per trade
      const marginUsagePercent = (marginRequired / accountBalance) * 100;
      const isMarginSafe = marginUsagePercent <= maxMarginUsage;

      if (!isMarginSafe) {
        return {
          positionSize: 0,
          marginRequired: 0,
          isSafe: false,
          reason: `MARGIN_USAGE_TOO_HIGH: ${marginUsagePercent.toFixed(1)}% > ${maxMarginUsage}%`
        };
      }

      return {
        positionSize,
        marginRequired,
        isSafe: true
      };
    } catch (error) {
      logger.error({
        accountBalance,
        entryPrice,
        stopLoss,
        leverage,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to calculate position size for HTF Trend Filter strategy');

      return {
        positionSize: 0,
        marginRequired: 0,
        isSafe: false,
        reason: 'CALCULATION_ERROR'
      };
    }
  }
}
