/**
 * Funding Rate & Open Interest Strategy Module
 * Analyzes derivatives data (funding rate, open interest, liquidations)
 */

export interface FundingRateData {
  fundingRate: number; // Funding rate as decimal (e.g., 0.01 = 1%)
  timestamp?: number;
}

export interface OpenInterestData {
  openInterest: number; // Total open interest
  change24h: number; // 24h change as decimal (e.g., 0.05 = 5%)
  timestamp?: number;
}

export interface LiquidationsData {
  longLiquidation24h: number; // Long liquidations in USD
  shortLiquidation24h: number; // Short liquidations in USD
  totalLiquidation24h: number; // Total liquidations in USD
  timestamp?: number;
}

export interface FundingRateResult {
  signal: 'Bullish' | 'Bearish' | 'Neutral';
  score: number; // 0-1 normalized score
  fundingRate: number;
  description: string;
}

export interface OpenInterestResult {
  signal: 'Bullish' | 'Bearish' | 'Neutral';
  score: number; // 0-1 normalized score
  change24h: number;
  description: string;
}

export interface LiquidationsResult {
  signal: 'Bullish' | 'Bearish' | 'Neutral';
  score: number; // 0-1 normalized score
  longPct: number; // Percentage of long liquidations
  shortPct: number; // Percentage of short liquidations
  description: string;
}

/**
 * Analyze funding rate
 * Signal logic:
 * - Negative funding rate (< -0.01%) → Bullish (shorts pay longs)
 * - Positive funding rate (> 0.01%) → Bearish (longs pay shorts)
 * - Near zero → Neutral
 */
export function analyzeFundingRate(data: FundingRateData): FundingRateResult {
  const fundingRate = data.fundingRate || 0;
  const fundingRatePercent = fundingRate * 100;

  let signal: 'Bullish' | 'Bearish' | 'Neutral';
  let score: number;
  let description: string;

  if (fundingRate < -0.0001) {
    // Negative funding rate (shorts pay longs) → Bullish
    signal = 'Bullish';
    // Normalize: -0.1% = 1.0, 0% = 0.5
    score = Math.min(1.0, 0.5 + Math.abs(fundingRate) * 100);
    description = `Negative funding rate ${fundingRatePercent.toFixed(4)}% (shorts pay longs) → Bullish`;
  } else if (fundingRate > 0.0001) {
    // Positive funding rate (longs pay shorts) → Bearish
    signal = 'Bearish';
    // Normalize: 0.1% = 0.0, 0% = 0.5
    score = Math.max(0.0, 0.5 - fundingRate * 100);
    description = `Positive funding rate ${fundingRatePercent.toFixed(4)}% (longs pay shorts) → Bearish`;
  } else {
    // Near zero → Neutral
    signal = 'Neutral';
    score = 0.5;
    description = `Funding rate near zero ${fundingRatePercent.toFixed(4)}% → Neutral`;
  }

  return {
    signal,
    score,
    fundingRate,
    description,
  };
}

/**
 * Analyze open interest change
 * Signal logic:
 * - Increasing OI (> 5%) → Bullish (new positions opening)
 * - Decreasing OI (< -5%) → Bearish (positions closing/liquidations)
 * - Small change → Neutral
 */
export function analyzeOpenInterest(data: OpenInterestData): OpenInterestResult {
  const change24h = data.change24h || 0;
  const changePercent = change24h * 100;

  let signal: 'Bullish' | 'Bearish' | 'Neutral';
  let score: number;
  let description: string;

  if (change24h > 0.05) {
    // Strong increase → Bullish
    signal = 'Bullish';
    // Normalize: 10% = 1.0, 0% = 0.5
    score = Math.min(1.0, 0.5 + (change24h * 10));
    description = `Open Interest increased ${changePercent.toFixed(1)}% → Bullish (accumulation)`;
  } else if (change24h < -0.05) {
    // Strong decrease → Bearish
    signal = 'Bearish';
    // Normalize: -10% = 0.0, 0% = 0.5
    score = Math.max(0.0, 0.5 + (change24h * 10));
    description = `Open Interest decreased ${Math.abs(changePercent).toFixed(1)}% → Bearish (liquidation pressure)`;
  } else {
    // Small change → Neutral
    signal = 'Neutral';
    score = 0.5;
    description = `Open Interest change ${changePercent.toFixed(1)}% → Neutral`;
  }

  return {
    signal,
    score,
    change24h,
    description,
  };
}

/**
 * Analyze liquidations
 * Signal logic:
 * - More long liquidations (> 60%) → Bearish (longs getting liquidated)
 * - More short liquidations (> 60%) → Bullish (shorts getting liquidated)
 * - Balanced → Neutral
 */
export function analyzeLiquidations(data: LiquidationsData): LiquidationsResult {
  const total = data.totalLiquidation24h || 0;
  const longLiq = data.longLiquidation24h || 0;
  const shortLiq = data.shortLiquidation24h || 0;

  if (total === 0) {
    return {
      signal: 'Neutral',
      score: 0.5,
      longPct: 50,
      shortPct: 50,
      description: 'No significant liquidations',
    };
  }

  const longPct = (longLiq / total) * 100;
  const shortPct = (shortLiq / total) * 100;

  let signal: 'Bullish' | 'Bearish' | 'Neutral';
  let score: number;
  let description: string;

  if (longPct > 60) {
    // More long liquidations → Bearish
    signal = 'Bearish';
    // Normalize: 100% long = 0.0, 50% = 0.5
    score = Math.max(0.0, 0.5 - ((longPct - 50) / 50));
    description = `Long liquidations ${longPct.toFixed(1)}% > Short ${shortPct.toFixed(1)}% → Bearish`;
  } else if (shortPct > 60) {
    // More short liquidations → Bullish
    signal = 'Bullish';
    // Normalize: 100% short = 1.0, 50% = 0.5
    score = Math.min(1.0, 0.5 + ((shortPct - 50) / 50));
    description = `Short liquidations ${shortPct.toFixed(1)}% > Long ${longPct.toFixed(1)}% → Bullish`;
  } else {
    // Balanced → Neutral
    signal = 'Neutral';
    score = 0.5;
    description = `Balanced liquidations: Long ${longPct.toFixed(1)}% / Short ${shortPct.toFixed(1)}% → Neutral`;
  }

  return {
    signal,
    score,
    longPct,
    shortPct,
    description,
  };
}

