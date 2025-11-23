/**
 * Derivatives Strategy Module
 * Analyzes funding rate, open interest, and liquidations from Exchange APIs and CryptoQuant
 * Integrates data from multiple sources for robust signals
 */

import type { ExchangeConnector } from '../exchangeConnector';
import { CryptoCompareAdapter } from '../cryptoCompareAdapter';
import { analyzeFundingRate, analyzeOpenInterest, analyzeLiquidations, type FundingRateData, type OpenInterestData, type LiquidationsData } from './fundingOiStrategy';

export interface DerivativesData {
  fundingRate?: FundingRateData;
  openInterest?: OpenInterestData;
  liquidations?: LiquidationsData;
  source: 'exchange' | 'cryptocompare' | 'both';
}

export interface DerivativesResult {
  fundingRate: {
    signal: 'Bullish' | 'Bearish' | 'Neutral';
    score: number;
    value: number;
    description: string;
  };
  openInterest: {
    signal: 'Bullish' | 'Bearish' | 'Neutral';
    score: number;
    change24h: number;
    description: string;
  };
  liquidations: {
    signal: 'Bullish' | 'Bearish' | 'Neutral';
    score: number;
    longPct: number;
    shortPct: number;
    description: string;
  };
  overallSignal: 'Bullish' | 'Bearish' | 'Neutral';
  overallScore: number; // 0-1 normalized
  source: string;
}

/**
 * Fetch derivatives data from exchange APIs (primary) and CryptoQuant (supplement)
 */
export async function fetchDerivativesData(
  symbol: string,
  exchangeAdapter?: ExchangeConnector,
  cryptoCompareAdapter?: CryptoCompareAdapter
): Promise<DerivativesData> {
  const data: DerivativesData = {
    source: 'exchange',
  };

  // Try exchange APIs first (primary)
  if (exchangeAdapter) {
    try {
      if (typeof (exchangeAdapter as any).getDerivativesSnapshot === 'function') {
        const snapshot = await (exchangeAdapter as any).getDerivativesSnapshot(symbol);
        if (snapshot?.available) {
          if (snapshot.fundingRate) {
            data.fundingRate = {
              fundingRate: snapshot.fundingRate.fundingRate || 0,
              timestamp: snapshot.fundingRate.nextFundingTime,
            };
          }
          if (snapshot.openInterest) {
            data.openInterest = {
              openInterest: snapshot.openInterest.openInterest || 0,
              change24h: 0,
              timestamp: Date.now(),
            };
          }
          if (snapshot.liquidationData) {
            data.liquidations = {
              longLiquidation24h: snapshot.liquidationData.longLiquidation24h || 0,
              shortLiquidation24h: snapshot.liquidationData.shortLiquidation24h || 0,
              totalLiquidation24h: snapshot.liquidationData.totalLiquidation24h || 0,
              timestamp: Date.now(),
            };
          }
        }
      } else {
        // Check if adapter has these methods
        if (typeof (exchangeAdapter as any).getFundingRate === 'function') {
          const fr = await (exchangeAdapter as any).getFundingRate(symbol);
          if (fr) {
            data.fundingRate = {
              fundingRate: fr.fundingRate || 0,
              timestamp: fr.nextFundingTime,
            };
          }
        }

        if (typeof (exchangeAdapter as any).getOpenInterest === 'function') {
          const oi = await (exchangeAdapter as any).getOpenInterest(symbol);
          if (oi) {
            // Calculate 24h change (would need historical data, simplified for now)
            data.openInterest = {
              openInterest: oi.openInterest || 0,
              change24h: 0, // Would need historical comparison
              timestamp: Date.now(),
            };
          }
        }

        if (typeof (exchangeAdapter as any).getLiquidations === 'function') {
          const liq = await (exchangeAdapter as any).getLiquidations(symbol);
          if (liq) {
            data.liquidations = {
              longLiquidation24h: liq.longLiquidation24h || 0,
              shortLiquidation24h: liq.shortLiquidation24h || 0,
              totalLiquidation24h: liq.totalLiquidation24h || 0,
              timestamp: Date.now(),
            };
          }
        }
      }
    } catch (err: any) {
      // Exchange API failed, will try CryptoQuant
    }
  }

  // Supplement with CryptoCompare if available
  if (cryptoCompareAdapter) {
    try {
      // Get all metrics from CryptoCompare
      const cryptoData = await cryptoCompareAdapter.getAllMetrics(symbol);

      // Add funding rate data if not already present
      if (!data.fundingRate && cryptoData.fundingRate !== undefined) {
        data.fundingRate = {
          fundingRate: cryptoData.fundingRate / 100, // Convert from percentage
          timestamp: Date.now(),
        };
      }

      // Add liquidation data if not already present
      if (!data.liquidations && cryptoData.liquidations !== undefined) {
        data.liquidations = {
          longLiquidation24h: cryptoData.liquidations * 0.6,
          shortLiquidation24h: cryptoData.liquidations * 0.4,
          totalLiquidation24h: cryptoData.liquidations,
          timestamp: Date.now(),
        };
      }

      // Use reserve change as proxy for open interest if not already present
      if (!data.openInterest && cryptoData.reserveChange !== undefined) {
        data.openInterest = {
          openInterest: Math.abs(cryptoData.reserveChange) * 1000000,
          change24h: cryptoData.reserveChange / 100,
          timestamp: Date.now(),
        };
      }

      data.source = data.fundingRate || data.openInterest || data.liquidations ? 'both' : 'cryptocompare';
    } catch (err: any) {
      // CryptoCompare failed, use exchange data only
    }
  }

  return data;
}

/**
 * Analyze derivatives data and return comprehensive result
 */
export function analyzeDerivatives(data: DerivativesData): DerivativesResult {
  const results: DerivativesResult = {
    fundingRate: {
      signal: 'Neutral',
      score: 0.5,
      value: 0,
      description: 'Funding rate data not available',
    },
    openInterest: {
      signal: 'Neutral',
      score: 0.5,
      change24h: 0,
      description: 'Open interest data not available',
    },
    liquidations: {
      signal: 'Neutral',
      score: 0.5,
      longPct: 50,
      shortPct: 50,
      description: 'Liquidations data not available',
    },
    overallSignal: 'Neutral',
    overallScore: 0.5,
    source: data.source,
  };

  // Analyze funding rate
  if (data.fundingRate) {
    const frResult = analyzeFundingRate(data.fundingRate);
    results.fundingRate = {
      signal: frResult.signal,
      score: frResult.score,
      value: frResult.fundingRate,
      description: frResult.description,
    };
  }

  // Analyze open interest
  if (data.openInterest) {
    const oiResult = analyzeOpenInterest(data.openInterest);
    results.openInterest = {
      signal: oiResult.signal,
      score: oiResult.score,
      change24h: oiResult.change24h,
      description: oiResult.description,
    };
  }

    // Analyze liquidations
    if (data.liquidations) {
      const liqResult = analyzeLiquidations(data.liquidations);
      results.liquidations = {
        signal: liqResult.signal,
        score: liqResult.score,
        longPct: liqResult.longPct,
        shortPct: liqResult.shortPct,
        description: liqResult.description,
      };
    }

  // Calculate overall signal (weighted average of scores)
  const scores = [
    results.fundingRate.score,
    results.openInterest.score,
    results.liquidations.score,
  ].filter(s => s !== 0.5); // Only count non-neutral signals

  if (scores.length > 0) {
    results.overallScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    
    if (results.overallScore > 0.6) {
      results.overallSignal = 'Bullish';
    } else if (results.overallScore < 0.4) {
      results.overallSignal = 'Bearish';
    } else {
      results.overallSignal = 'Neutral';
    }
  }

  return results;
}

