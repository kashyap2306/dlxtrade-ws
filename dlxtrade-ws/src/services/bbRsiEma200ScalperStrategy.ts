import { logger } from '../utils/logger';
import { TechnicalIndicators, CandleData } from './technicalIndicators';

/**
 * BB-RSI EMA200 Scalper Pro Strategy
 * 
 * High-accuracy short-term scalping using mean reversion entries with strict EMA200 trend filter.
 * Designed for liquid pairs only, low drawdown, fast exits.
 * 
 * Timeframes: 3m primary, 5m confirmation
 * Supported Pairs: BTC/USDT, ETH/USDT, SOL/USDT, BNB/USDT, XRP/USDT
 * 
 * Indicators:
 * - EMA(200) trend filter
 * - Bollinger Bands(20, 2.0) for mean reversion
 * - RSI(14) for confirmation
 * - Volume MA(20) for volume filter
 * - ADX(14) to skip strong trends (>30)
 * 
 * Entry Logic:
 * LONG: Close > EMA200, Low touches/breaks Lower BB, RSI ≤ 30, Volume > VolumeMA
 * SHORT: Close < EMA200, High touches/breaks Upper BB, RSI ≥ 70, Volume > VolumeMA
 * 
 * Risk Management:
 * - Leverage: 5x (range 3x-8x)
 * - Risk per trade: 0.75% (hard cap 1%)
 * - Daily drawdown limit: 5%
 * - Equity drawdown limit: 12%
 */

export type MeanReversionDirection = 'LONG' | 'SHORT' | 'NO_TRADE';

export interface MeanReversionSignal {
  isValid: boolean;
  direction: MeanReversionDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number; // 60% exit
  takeProfit2: number; // 40% exit
  reason: string;
  indicators: {
    price: number;
    ema200: number;
    bbUpper: number;
    bbMiddle: number;
    bbLower: number;
    rsi: number;
    adx: number;
    volumeMA: number;
    volume: number;
  };
  confidence: number; // 0-100
  tradeSetup: {
    bbTouch: boolean;
    rsiConfirm: boolean;
    volumeConfirm: boolean;
    adxFilter: boolean;
  };
}

export class BBRsiEma200ScalperStrategy {
  /**
   * Generate mean reversion trading signal based on BB-RSI-EMA200 logic
   */
  static generateSignal(candles: CandleData[], accountBalance: number): MeanReversionSignal {
    // Validate input
    if (!candles || candles.length < 250) {
      return {
        isValid: false,
        direction: 'NO_TRADE',
        entryPrice: 0,
        stopLoss: 0,
        takeProfit1: 0,
        takeProfit2: 0,
        reason: 'Insufficient candle data (need 250+)',
        indicators: {} as any,
        confidence: 0,
        tradeSetup: { bbTouch: false, rsiConfirm: false, volumeConfirm: false, adxFilter: false }
      };
    }

    // Sort candles: most recent first
    const sortedCandles = [...candles].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const closes = sortedCandles.map(c => c.close);
    const highs = sortedCandles.map(c => c.high);
    const lows = sortedCandles.map(c => c.low);
    const volumes = sortedCandles.map(c => c.volume);

    // Calculate indicators
    const ema200 = TechnicalIndicators.calculateEMA(closes, 200);
    const bb = TechnicalIndicators.calculateBollingerBands(closes, 20, 2.0);
    const rsi = TechnicalIndicators.calculateRSI(closes, 14);
    const adx = this.calculateADX(highs, lows, closes, 14);
    const volumeMA = volumes.slice(0, 20).reduce((a, b) => a + b, 0) / 20;

    const latestCandle = sortedCandles[0];
    const prevCandle = sortedCandles[1];
    const price = latestCandle.close;
    const volume = latestCandle.volume;

    // Get swing high/low for last 5 candles (for SL calculation)
    const last5Candles = sortedCandles.slice(0, 5);
    const swingHigh = Math.max(...last5Candles.map(c => c.high));
    const swingLow = Math.min(...last5Candles.map(c => c.low));

    let signal: MeanReversionDirection = 'NO_TRADE';
    let entryPrice = price;
    let stopLoss = 0;
    let tp1 = 0;
    let tp2 = 0;
    let confidence = 0;
    const tradeSetup = {
      bbTouch: false,
      rsiConfirm: false,
      volumeConfirm: false,
      adxFilter: false
    };

    // FILTER 1: ADX > 30 means strong trend → skip mean reversion
    if (adx > 30) {
      return {
        isValid: false,
        direction: 'NO_TRADE',
        entryPrice: 0,
        stopLoss: 0,
        takeProfit1: 0,
        takeProfit2: 0,
        reason: `ADX too high (${adx.toFixed(2)} > 30) - strong trend, skip mean reversion`,
        indicators: {
          price,
          ema200,
          bbUpper: bb.upper,
          bbMiddle: bb.middle,
          bbLower: bb.lower,
          rsi,
          adx,
          volumeMA,
          volume
        },
        confidence: 0,
        tradeSetup
      };
    }
    tradeSetup.adxFilter = true;

    // FILTER 2: Check if current candle or previous candle touched BB
    const currTouchesLower = latestCandle.low <= bb.lower;
    const currTouchesUpper = latestCandle.high >= bb.upper;
    const prevTouchesLower = prevCandle.low <= bb.lower;
    const prevTouchesUpper = prevCandle.high >= bb.upper;
    const touchesLowerBB = currTouchesLower || prevTouchesLower;
    const touchesUpperBB = currTouchesUpper || prevTouchesUpper;

    // FILTER 3: Volume confirmation
    const volumeOK = volume > volumeMA * 0.9; // Allow 10% tolerance
    tradeSetup.volumeConfirm = volumeOK;

    // LONG SETUP: Uptrend + Mean Reversion to Lower BB
    if (price > ema200 && touchesLowerBB && rsi <= 30 && volumeOK) {
      // Confirmation: current candle closed back INSIDE BB (above lower band)
      if (latestCandle.close > bb.lower) {
        signal = 'LONG';
        tradeSetup.bbTouch = true;
        tradeSetup.rsiConfirm = true;

        entryPrice = price;

        // SL: min(swing_low_last_5, LowerBand - 0.15%)
        const slBand = bb.lower * (1 - 0.0015);
        stopLoss = Math.min(swingLow, slBand);

        // Validate SL distance (0.6% - 1.2%)
        const slDistance = ((entryPrice - stopLoss) / entryPrice) * 100;
        if (slDistance < 0.6 || slDistance > 1.2) {
          // SL out of range → skip
          return {
            isValid: false,
            direction: 'NO_TRADE',
            entryPrice: 0,
            stopLoss: 0,
            takeProfit1: 0,
            takeProfit2: 0,
            reason: `SL distance ${slDistance.toFixed(2)}% outside range [0.6%, 1.2%]`,
            indicators: {
              price,
              ema200,
              bbUpper: bb.upper,
              bbMiddle: bb.middle,
              bbLower: bb.lower,
              rsi,
              adx,
              volumeMA,
              volume
            },
            confidence,
            tradeSetup
          };
        }

        // TP1: Middle BB (close 60%)
        tp1 = bb.middle;

        // TP2: +0.8% profit OR upper BB (close 40%)
        tp2 = Math.max(entryPrice * 1.008, bb.upper);

        confidence = Math.min(100, 65 + (rsi < 20 ? 15 : 0) + (volume > volumeMA * 1.5 ? 10 : 0));
      }
    }

    // SHORT SETUP: Downtrend + Mean Reversion to Upper BB
    if (price < ema200 && touchesUpperBB && rsi >= 70 && volumeOK) {
      // Confirmation: current candle closed back INSIDE BB (below upper band)
      if (latestCandle.close < bb.upper) {
        signal = 'SHORT';
        tradeSetup.bbTouch = true;
        tradeSetup.rsiConfirm = true;

        entryPrice = price;

        // SL: max(swing_high_last_5, UpperBand + 0.15%)
        const slBand = bb.upper * (1 + 0.0015);
        stopLoss = Math.max(swingHigh, slBand);

        // Validate SL distance (0.6% - 1.2%)
        const slDistance = ((stopLoss - entryPrice) / entryPrice) * 100;
        if (slDistance < 0.6 || slDistance > 1.2) {
          // SL out of range → skip
          return {
            isValid: false,
            direction: 'NO_TRADE',
            entryPrice: 0,
            stopLoss: 0,
            takeProfit1: 0,
            takeProfit2: 0,
            reason: `SL distance ${slDistance.toFixed(2)}% outside range [0.6%, 1.2%]`,
            indicators: {
              price,
              ema200,
              bbUpper: bb.upper,
              bbMiddle: bb.middle,
              bbLower: bb.lower,
              rsi,
              adx,
              volumeMA,
              volume
            },
            confidence,
            tradeSetup
          };
        }

        // TP1: Middle BB (close 60%)
        tp1 = bb.middle;

        // TP2: -0.8% profit OR lower BB (close 40%)
        tp2 = Math.min(entryPrice * 0.992, bb.lower);

        confidence = Math.min(100, 65 + (rsi > 80 ? 15 : 0) + (volume > volumeMA * 1.5 ? 10 : 0));
      }
    }

    // Validate risk/reward
    if (signal !== 'NO_TRADE') {
      const riskAmount = Math.abs(entryPrice - stopLoss);
      const rewardAmount = Math.abs((signal === 'LONG' ? tp2 : tp1) - entryPrice);
      const rrRatio = rewardAmount / riskAmount;

      if (rrRatio < 1.0) {
        return {
          isValid: false,
          direction: 'NO_TRADE',
          entryPrice: 0,
          stopLoss: 0,
          takeProfit1: 0,
          takeProfit2: 0,
          reason: `Risk/Reward ratio too low: ${rrRatio.toFixed(2)}:1 (need ≥1.0:1)`,
          indicators: {
            price,
            ema200,
            bbUpper: bb.upper,
            bbMiddle: bb.middle,
            bbLower: bb.lower,
            rsi,
            adx,
            volumeMA,
            volume
          },
          confidence,
          tradeSetup
        };
      }
    }

    // Validate position sizing against account (max 0.75% risk per trade)
    if (signal !== 'NO_TRADE') {
      const riskAmount = Math.abs(entryPrice - stopLoss);
      const maxRiskPercent = 0.0075; // 0.75%
      const maxRiskInUSDT = accountBalance * maxRiskPercent;

      if (riskAmount > maxRiskInUSDT) {
        return {
          isValid: false,
          direction: 'NO_TRADE',
          entryPrice: 0,
          stopLoss: 0,
          takeProfit1: 0,
          takeProfit2: 0,
          reason: `Risk per trade exceeds 0.75% of balance. Risk: ${riskAmount.toFixed(2)} USDT, Max: ${maxRiskInUSDT.toFixed(2)} USDT`,
          indicators: {
            price,
            ema200,
            bbUpper: bb.upper,
            bbMiddle: bb.middle,
            bbLower: bb.lower,
            rsi,
            adx,
            volumeMA,
            volume
          },
          confidence,
          tradeSetup
        };
      }
    }

    return {
      isValid: signal !== 'NO_TRADE',
      direction: signal,
      entryPrice,
      stopLoss,
      takeProfit1: tp1,
      takeProfit2: tp2,
      reason: signal === 'NO_TRADE' ? 'No mean reversion signal detected' : `${signal} signal: BB touch + RSI confirmation + Volume expansion`,
      indicators: {
        price,
        ema200,
        bbUpper: bb.upper,
        bbMiddle: bb.middle,
        bbLower: bb.lower,
        rsi,
        adx,
        volumeMA,
        volume
      },
      confidence,
      tradeSetup
    };
  }

  /**
   * Calculate ADX (Average Directional Index) for trend strength
   */
  private static calculateADX(highs: number[], lows: number[], closes: number[], period: number = 14): number {
    if (highs.length < period + 5) {
      return 0;
    }

    // Calculate +DM, -DM, TR
    let sumPlusDM = 0;
    let sumMinusDM = 0;
    let sumTR = 0;

    for (let i = 0; i < period; i++) {
      const high = highs[i];
      const low = lows[i];
      const prevClose = closes[i + 1];

      // True Range
      const tr1 = high - low;
      const tr2 = Math.abs(high - prevClose);
      const tr3 = Math.abs(low - prevClose);
      const tr = Math.max(tr1, tr2, tr3);
      sumTR += tr;

      // Directional Movements
      const upMove = high - highs[i + 1];
      const downMove = lows[i + 1] - low;

      let plusDM = 0;
      let minusDM = 0;

      if (upMove > downMove && upMove > 0) {
        plusDM = upMove;
      } else if (downMove > upMove && downMove > 0) {
        minusDM = downMove;
      }

      sumPlusDM += plusDM;
      sumMinusDM += minusDM;
    }

    const avgTR = sumTR / period;
    const avgPlusDM = sumPlusDM / period;
    const avgMinusDM = sumMinusDM / period;

    const plusDI = (avgPlusDM / avgTR) * 100;
    const minusDI = (avgMinusDM / avgTR) * 100;

    const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
    return dx;
  }
}
