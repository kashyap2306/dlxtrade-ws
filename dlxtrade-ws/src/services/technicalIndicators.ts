/**
 * Technical Indicators Calculator
 * All calculations use CLOSED candles only
 */

export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorValues {
  rsi: number;
  ema50: number;
  bbUpper: number;
  bbLower: number;
  bbMiddle: number;
  atr: number;
}

export class TechnicalIndicators {
  /**
   * Calculate RSI (Relative Strength Index)
   * @param closes - Array of closing prices (most recent first)
   * @param period - RSI period (default: 14)
   */
  static calculateRSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) {
      throw new Error(`Need at least ${period + 1} closes for RSI calculation`);
    }

    const gains: number[] = [];
    const losses: number[] = [];

    // Calculate price changes
    for (let i = closes.length - 2; i >= 0; i--) {
      const change = closes[i] - closes[i + 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }

    // Calculate initial averages
    let avgGain = gains.slice(0, period).reduce((sum, gain) => sum + gain, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((sum, loss) => sum + loss, 0) / period;

    // Use Wilder's smoothing for remaining values
    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  /**
   * Calculate EMA (Exponential Moving Average)
   * @param closes - Array of closing prices (most recent first)
   * @param period - EMA period
   */
  static calculateEMA(closes: number[], period: number): number {
    if (closes.length < period) {
      throw new Error(`Need at least ${period} closes for EMA calculation`);
    }

    const multiplier = 2 / (period + 1);
    let ema = closes[closes.length - 1]; // Start with SMA

    // Calculate EMA for remaining values
    for (let i = closes.length - 2; i >= 0; i--) {
      ema = (closes[i] * multiplier) + (ema * (1 - multiplier));
    }

    return ema;
  }

  /**
   * Calculate Bollinger Bands
   * @param closes - Array of closing prices (most recent first)
   * @param period - BB period (default: 20)
   * @param stdDev - Standard deviation multiplier (default: 2)
   */
  static calculateBollingerBands(
    closes: number[],
    period: number = 20,
    stdDev: number = 2
  ): { upper: number; middle: number; lower: number } {
    if (closes.length < period) {
      throw new Error(`Need at least ${period} closes for Bollinger Bands calculation`);
    }

    // Calculate SMA (middle band)
    const sma = closes.slice(0, period).reduce((sum, price) => sum + price, 0) / period;

    // Calculate standard deviation
    const squaredDiffs = closes.slice(0, period).map(price => Math.pow(price - sma, 2));
    const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / period;
    const standardDeviation = Math.sqrt(variance);

    return {
      upper: sma + (standardDeviation * stdDev),
      middle: sma,
      lower: sma - (standardDeviation * stdDev)
    };
  }

  /**
   * Calculate ATR (Average True Range)
   * @param candles - Array of candle data (most recent first)
   * @param period - ATR period (default: 14)
   */
  static calculateATR(candles: CandleData[], period: number = 14): number {
    if (candles.length < period + 1) {
      throw new Error(`Need at least ${period + 1} candles for ATR calculation`);
    }

    const trueRanges: number[] = [];

    // Calculate True Range for each candle
    for (let i = candles.length - 2; i >= 0; i--) {
      const current = candles[i];
      const previous = candles[i + 1];

      const tr1 = current.high - current.low;
      const tr2 = Math.abs(current.high - previous.close);
      const tr3 = Math.abs(current.low - previous.close);

      const trueRange = Math.max(tr1, tr2, tr3);
      trueRanges.push(trueRange);
    }

    // Calculate ATR using Wilder's smoothing
    let atr = trueRanges.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;

    // Apply Wilder's smoothing for remaining values
    for (let i = period; i < trueRanges.length; i++) {
      atr = (atr * (period - 1) + trueRanges[i]) / period;
    }

    return atr;
  }

  /**
   * Calculate all indicators for the latest candle
   * @param candles - Array of candle data (most recent first, at least 50 candles)
   */
  static calculateAllIndicators(candles: CandleData[]): IndicatorValues {
    if (candles.length < 50) {
      throw new Error('Need at least 50 candles for complete indicator calculation');
    }

    const closes = candles.map(c => c.close);

    // Calculate each indicator
    const rsi = this.calculateRSI(closes, 14);
    const ema50 = this.calculateEMA(closes, 50);
    const bb = this.calculateBollingerBands(closes, 20, 2);
    const atr = this.calculateATR(candles, 14);

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
   * Validate that all required indicators are available
   */
  static validateIndicators(indicators: Partial<IndicatorValues>): boolean {
    const required = ['rsi', 'ema50', 'bbUpper', 'bbLower', 'atr'];
    return required.every(key => {
      const value = indicators[key as keyof IndicatorValues];
      return typeof value === 'number' && !isNaN(value) && isFinite(value);
    });
  }

  /**
   * Get indicator descriptions for UI display
   */
  static getIndicatorDescriptions() {
    return {
      rsi: {
        name: 'RSI (14)',
        description: 'Relative Strength Index - momentum oscillator measuring price changes',
        range: '0-100',
        signals: {
          oversold: '< 30',
          overbought: '> 70'
        }
      },
      ema50: {
        name: 'EMA (50)',
        description: '50-period Exponential Moving Average - trend indicator',
        signals: {
          bullish: 'Price > EMA',
          bearish: 'Price < EMA'
        }
      },
      bollingerBands: {
        name: 'Bollinger Bands (20, 2)',
        description: 'Volatility bands around price action',
        signals: {
          lowerBreakout: 'Price touches/closes below lower band',
          upperBreakout: 'Price touches/closes above upper band'
        }
      },
      atr: {
        name: 'ATR (14)',
        description: 'Average True Range - volatility indicator',
        signals: {
          stopLoss: '1 × ATR from entry',
          takeProfit: '0.8 × ATR from entry'
        }
      }
    };
  }
}