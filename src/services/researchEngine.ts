import { logger } from '../utils/logger';
import { BinanceAdapter } from './binanceAdapter';
import { firestoreAdapter } from './firestoreAdapter';
import { CryptoQuantAdapter } from './cryptoquantAdapter';
import { LunarCrushAdapter } from './lunarcrushAdapter';
import { CoinAPIAdapter } from './coinapiAdapter';
import type { Orderbook, Trade } from '../types';

export interface ResearchResult {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  accuracy: number;
  orderbookImbalance: number;
  recommendedAction: string;
  microSignals: {
    spread: number;
    volume: number;
    priceMomentum: number;
    orderbookDepth: number;
  };
}

export class ResearchEngine {
  private recentTrades: Map<string, Trade[]> = new Map();
  private orderbookHistory: Map<string, Orderbook[]> = new Map();
  private spreadHistory: Map<string, number[]> = new Map();
  private volumeHistory: Map<string, number[]> = new Map();
  private depthHistory: Map<string, number[]> = new Map();
  private imbalanceHistory: Map<string, number[]> = new Map();

  async runResearch(symbol: string, uid: string, adapter?: BinanceAdapter): Promise<ResearchResult> {
    try {
      // Orderbook data is optional - if adapter is available, use it; otherwise use defaults
      let imbalance = 0; // Neutral imbalance when no orderbook data
      let microSignals: ResearchResult['microSignals'] = {
        spread: 0,
        volume: 0,
        priceMomentum: 0,
        orderbookDepth: 0,
        // @ts-ignore: extend runtime shape
        volatility: 0,
      };

      // Try to get orderbook data if adapter is available (optional)
      if (adapter) {
        try {
          const orderbook = await adapter.getOrderbook(symbol, 20);
          
          // Calculate orderbook imbalance
          imbalance = this.calculateOrderbookImbalance(orderbook);
          
          // Get micro-signals
          microSignals = this.calculateMicroSignals(symbol, orderbook);

          // Persist snapshot for momentum/history-based features
          this.addOrderbook(symbol, orderbook);
        } catch (orderbookErr: any) {
          // If orderbook fetch fails, continue with default values
          logger.debug({ err: orderbookErr, symbol }, 'Could not fetch orderbook, using defaults');
        }
      }
      
      // Calculate accuracy based on external APIs and available data sources
      // This works without exchange adapter - uses CryptoQuant, LunarCrush, CoinAPI
      let accuracy = 0.5; // Default base accuracy
      try {
        accuracy = await this.calculateAccuracy(symbol, imbalance, microSignals, uid);
      } catch (accuracyErr: any) {
        // If accuracy calculation fails, use base accuracy
        logger.warn({ err: accuracyErr, symbol, uid }, 'Accuracy calculation failed, using base accuracy');
        accuracy = 0.5;
      }

      // Liquidity filters: dynamically block low-liquidity / high-spread conditions
      // Only apply if we have orderbook data (microSignals.volume > 0)
      if (microSignals.volume > 0 && this.shouldBlockForLiquidity(symbol, microSignals)) {
        accuracy = Math.min(accuracy, 0.49);
      }
      
      // Determine signal using dynamic thresholds
      // If no orderbook data, signal will be HOLD (imbalance = 0)
      let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
      try {
        signal = this.determineSignalDynamic(symbol, imbalance, microSignals, accuracy);
      } catch (signalErr: any) {
        // If signal determination fails, default to HOLD
        logger.warn({ err: signalErr, symbol }, 'Signal determination failed, defaulting to HOLD');
        signal = 'HOLD';
      }
      
      // Recommended action
      let recommendedAction = 'Wait for better signal';
      try {
        recommendedAction = this.getRecommendedAction(signal, accuracy);
      } catch (actionErr: any) {
        // If action determination fails, use default
        logger.warn({ err: actionErr, symbol }, 'Recommended action failed, using default');
        recommendedAction = signal === 'HOLD' ? 'Wait for better signal' : `Consider ${signal} trade`;
      }

      const result: ResearchResult = {
        symbol,
        signal,
        accuracy,
        orderbookImbalance: imbalance,
        recommendedAction,
        microSignals,
      };

      // Save to Firestore (non-blocking - don't fail research if save fails)
      // Wrap in additional try/catch to ensure no errors escape
      try {
        try {
          const admin = await import('firebase-admin');
          if (admin && admin.firestore && admin.firestore.Timestamp) {
            await firestoreAdapter.saveResearchLog(uid, {
              symbol,
              timestamp: admin.firestore.Timestamp.now(),
              signal,
              accuracy,
              orderbookImbalance: imbalance,
              recommendedAction,
              microSignals,
            });
          }
        } catch (firestoreErr: any) {
          // Log but don't fail the research if Firestore save fails
          logger.warn({ err: firestoreErr, symbol, uid }, 'Failed to save research log to Firestore (non-critical)');
        }
      } catch (saveErr: any) {
        // Double-wrapped catch to ensure no errors escape
        logger.debug({ err: saveErr, symbol, uid }, 'Firestore save error caught (non-critical)');
      }

      logger.info({ symbol, signal, accuracy, hasAdapter: !!adapter }, 'Research completed');

      return result;
    } catch (error: any) {
      // Wrap entire research in try/catch to prevent any unhandled errors
      // NEVER throw - always return a valid result even on error
      logger.error({ error: error.message, symbol, uid, stack: error.stack }, 'Error in runResearch - returning fallback result');
      
      // Return fallback result instead of throwing
      return {
        symbol,
        signal: 'HOLD' as const,
        accuracy: 0.5,
        orderbookImbalance: 0,
        recommendedAction: 'Research encountered an error - please try again',
        microSignals: {
          spread: 0,
          volume: 0,
          priceMomentum: 0,
          orderbookDepth: 0,
        },
      };
    }
  }

  private calculateOrderbookImbalance(orderbook: Orderbook): number {
    if (orderbook.bids.length === 0 || orderbook.asks.length === 0) {
      return 0;
    }

    const bidVolume = orderbook.bids.slice(0, 10).reduce((sum, bid) => {
      return sum + parseFloat(bid.quantity);
    }, 0);

    const askVolume = orderbook.asks.slice(0, 10).reduce((sum, ask) => {
      return sum + parseFloat(ask.quantity);
    }, 0);

    const totalVolume = bidVolume + askVolume;
    if (totalVolume === 0) return 0;

    // Imbalance: positive = more bids (bullish), negative = more asks (bearish)
    return (bidVolume - askVolume) / totalVolume;
  }

  private calculateMicroSignals(symbol: string, orderbook: Orderbook): ResearchResult['microSignals'] {
    const bestBid = parseFloat(orderbook.bids[0]?.price || '0');
    const bestAsk = parseFloat(orderbook.asks[0]?.price || '0');
    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2;
    const spreadPct = midPrice > 0 ? (spread / midPrice) * 100 : 0;

    const bidDepth = orderbook.bids.slice(0, 5).reduce((sum, bid) => {
      return sum + parseFloat(bid.quantity) * parseFloat(bid.price);
    }, 0);

    const askDepth = orderbook.asks.slice(0, 5).reduce((sum, ask) => {
      return sum + parseFloat(ask.quantity) * parseFloat(ask.price);
    }, 0);

    // Simple volume calculation
    const volume = bidDepth + askDepth;

    // Price momentum from per-symbol history: (currentMid - prevMid) / prevMid
    let priceMomentum = 0;
    const history = this.orderbookHistory.get(symbol);
    if (midPrice > 0 && history && history.length >= 1) {
      const prev = history[history.length - 1];
      const prevBid = parseFloat(prev.bids[0]?.price || '0');
      const prevAsk = parseFloat(prev.asks[0]?.price || '0');
      const prevMid = prevBid > 0 && prevAsk > 0 ? (prevBid + prevAsk) / 2 : 0;
      if (prevMid > 0) {
        priceMomentum = (midPrice - prevMid) / prevMid;
      }
    }

    // Rolling volatility (stddev of mid returns) over last N snapshots
    const volatility = this.computeVolatility(symbol, 20);

    return {
      spread: spreadPct,
      volume,
      priceMomentum,
      orderbookDepth: bidDepth + askDepth,
      // @ts-ignore: extend runtime shape
      volatility,
    };
  }

  private async calculateAccuracy(
    symbol: string,
    imbalance: number,
    microSignals: ResearchResult['microSignals'],
    uid?: string
  ): Promise<number> {
    // Multi-source accuracy calculation using all available data sources
    let accuracy = 0.5; // Base accuracy

    // 1. Orderbook imbalance strength (Binance data)
    const imbalanceStrength = Math.abs(imbalance);
    if (imbalanceStrength > 0.3) {
      accuracy += 0.15;
    } else if (imbalanceStrength > 0.15) {
      accuracy += 0.1;
    } else if (imbalanceStrength > 0.05) {
      accuracy += 0.05;
    }

    // 2. Spread analysis (tighter spread = higher confidence)
    if (microSignals.spread < 0.05) {
      accuracy += 0.15; // Very tight spread
    } else if (microSignals.spread < 0.1) {
      accuracy += 0.1;
    } else if (microSignals.spread < 0.2) {
      accuracy += 0.05;
    }

    // 3. Volume depth analysis
    if (microSignals.volume > 500000) {
      accuracy += 0.15; // Very high volume
    } else if (microSignals.volume > 100000) {
      accuracy += 0.1;
    } else if (microSignals.volume > 50000) {
      accuracy += 0.05;
    }

    // 4. Orderbook depth analysis
    if (microSignals.orderbookDepth > 1000000) {
      accuracy += 0.1;
    } else if (microSignals.orderbookDepth > 500000) {
      accuracy += 0.05;
    }

    // 5. Fetch external data sources if integrations are available
    if (uid) {
      try {
        let integrations;
        try {
          integrations = await firestoreAdapter.getEnabledIntegrations(uid);
        } catch (integrationErr: any) {
          // If we can't fetch integrations, continue with base accuracy
          logger.debug({ err: integrationErr, uid }, 'Could not fetch integrations, using base accuracy only');
          integrations = {};
        }
        
        // CryptoQuant data (if available)
        if (integrations.cryptoquant) {
          try {
            // Validate API key before creating adapter
            const apiKey = integrations.cryptoquant.apiKey;
            if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 20) {
              logger.warn({ symbol, apiKeyLength: apiKey?.length || 0 }, 'CryptoQuant API key too short or invalid, skipping');
              // Skip CryptoQuant entirely if key is invalid
            } else {
              try {
                const cryptoquantAdapter = new CryptoQuantAdapter(apiKey);
                
                // Only proceed if adapter is not disabled
                if (!cryptoquantAdapter.disabled) {
                  const onChainData = await cryptoquantAdapter.getOnChainMetrics(symbol);
                  const flowData = await cryptoquantAdapter.getExchangeFlow(symbol);
                  
                  // Positive exchange flow (more inflow than outflow) is bullish
                  if (flowData.exchangeFlow && flowData.exchangeFlow > 0) {
                    accuracy += 0.05;
                  }
                  
                  // High whale transactions indicate strong interest
                  if (onChainData.whaleTransactions && onChainData.whaleTransactions > 10) {
                    accuracy += 0.03;
                  }
                  
                  // Active addresses indicate network activity
                  if (onChainData.activeAddresses && onChainData.activeAddresses > 100000) {
                    accuracy += 0.02;
                  }
                }
              } catch (adapterErr: any) {
                // Handle 401 errors specifically
                const errMsg = adapterErr.message || '';
                if (errMsg.includes('401') || errMsg.includes('authentication failed') || errMsg.includes('Token does not exist')) {
                  logger.warn({ symbol, error: errMsg }, 'CryptoQuant 401 Unauthorized - invalid API key');
                  // Don't throw - just skip CryptoQuant data
                } else {
                  logger.debug({ err: adapterErr, symbol, errorMessage: errMsg }, 'CryptoQuant fetch error (non-critical)');
                }
                // Never throw - always continue without CryptoQuant data
              }
            }
          } catch (err: any) {
            // Catch any other errors (constructor errors, etc.)
            logger.debug({ err, symbol, errorMessage: err.message }, 'CryptoQuant error (non-critical, skipping)');
            // Don't throw - continue without CryptoQuant data
          }
        }

        // LunarCrush sentiment data (if available)
        if (integrations.lunarcrush) {
          try {
            const apiKey = integrations.lunarcrush.apiKey;
            if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 20) {
              logger.warn({ symbol }, 'LunarCrush API key too short or invalid, skipping');
            } else {
              try {
                const lunarcrushAdapter = new LunarCrushAdapter(apiKey);
                const sentimentData = await lunarcrushAdapter.getCoinData(symbol);
                
                // Positive sentiment boosts accuracy
                if (sentimentData.sentiment && sentimentData.sentiment > 0.3) {
                  accuracy += 0.05;
                } else if (sentimentData.sentiment && sentimentData.sentiment < -0.3) {
                  // Negative sentiment reduces accuracy
                  accuracy -= 0.03;
                }
                
                // High social volume indicates interest
                if (sentimentData.socialVolume && sentimentData.socialVolume > 1000) {
                  accuracy += 0.03;
                }
                
                // Bullish sentiment percentage
                if (sentimentData.bullishSentiment && sentimentData.bullishSentiment > 0.6) {
                  accuracy += 0.02;
                }
              } catch (adapterErr: any) {
                logger.debug({ err: adapterErr, symbol }, 'LunarCrush fetch error (non-critical)');
              }
            }
          } catch (err: any) {
            logger.debug({ err, symbol }, 'LunarCrush error (non-critical, skipping)');
          }
        }

        // CoinAPI historical data (if available)
        // Check for all CoinAPI sub-types
        const coinapiMarket = integrations['coinapi_market'];
        const coinapiFlatfile = integrations['coinapi_flatfile'];
        const coinapiExchangerate = integrations['coinapi_exchangerate'];
        
        if (coinapiMarket || coinapiFlatfile || coinapiExchangerate) {
          try {
            // Try market data first
            if (coinapiMarket) {
              try {
                const apiKey = coinapiMarket.apiKey;
                if (apiKey && typeof apiKey === 'string' && apiKey.trim().length >= 20) {
                  const marketAdapter = new CoinAPIAdapter(apiKey, 'market');
                  const marketData = await marketAdapter.getMarketData(symbol);
                  
                  // Positive 24h price change is bullish
                  if (marketData.priceChangePercent24h && marketData.priceChangePercent24h > 2) {
                    accuracy += 0.03;
                  }
                  
                  // High volume indicates liquidity
                  if (marketData.volume24h && marketData.volume24h > 1000000) {
                    accuracy += 0.02;
                  }
                }
              } catch (adapterErr: any) {
                logger.debug({ err: adapterErr, symbol }, 'CoinAPI market fetch error (non-critical)');
              }
            }
            
            // Try historical data for trend analysis
            if (coinapiFlatfile) {
              try {
                const apiKey = coinapiFlatfile.apiKey;
                if (apiKey && typeof apiKey === 'string' && apiKey.trim().length >= 20) {
                  const flatfileAdapter = new CoinAPIAdapter(apiKey, 'flatfile');
                  const historicalData = await flatfileAdapter.getHistoricalData(symbol, 7);
                  
                  // Analyze trend from historical data
                  if (historicalData.historicalData && historicalData.historicalData.length >= 2) {
                    const recent = historicalData.historicalData[historicalData.historicalData.length - 1];
                    const previous = historicalData.historicalData[historicalData.historicalData.length - 2];
                    
                    // Safe division - check for zero or missing price
                    if (previous.price && previous.price > 0 && recent.price) {
                      const trend = (recent.price - previous.price) / previous.price;
                      
                      if (trend > 0.02) {
                        accuracy += 0.03; // Uptrend
                      } else if (trend < -0.02) {
                        accuracy -= 0.02; // Downtrend
                      }
                    }
                  }
                }
              } catch (adapterErr: any) {
                logger.debug({ err: adapterErr, symbol }, 'CoinAPI flatfile fetch error (non-critical)');
              }
            }
            
            // Exchange rate data (less critical for accuracy, but can be used)
            if (coinapiExchangerate) {
              try {
                const apiKey = coinapiExchangerate.apiKey;
                if (apiKey && typeof apiKey === 'string' && apiKey.trim().length >= 20) {
                  const baseAsset = symbol.replace('USDT', '').replace('USD', '');
                  const exchangerateAdapter = new CoinAPIAdapter(apiKey, 'exchangerate');
                  const rateData = await exchangerateAdapter.getExchangeRate(baseAsset, 'USD');
                  // Could use exchange rate for additional validation
                }
              } catch (adapterErr: any) {
                logger.debug({ err: adapterErr, symbol }, 'CoinAPI exchangerate fetch error (non-critical)');
              }
            }
          } catch (err: any) {
            logger.debug({ err, symbol }, 'CoinAPI error (non-critical, skipping)');
          }
        }
      } catch (err: any) {
        logger.debug({ err, errorMessage: err.message }, 'Error fetching external data sources for accuracy (non-critical)');
        // Don't throw - continue with base accuracy calculation
      }
    }

    // 6. Price momentum (if we have historical data)
    if (this.orderbookHistory.has(symbol)) {
      const history = this.orderbookHistory.get(symbol);
      if (history && history.length >= 2) {
        const recent = history[history.length - 1];
        const previous = history[history.length - 2];
        const recentMid = (parseFloat(recent.bids[0]?.price || '0') + parseFloat(recent.asks[0]?.price || '0')) / 2;
        const previousMid = (parseFloat(previous.bids[0]?.price || '0') + parseFloat(previous.asks[0]?.price || '0')) / 2;
        
        // Safe division - check for zero or invalid values
        if (previousMid > 0 && recentMid > 0 && isFinite(recentMid) && isFinite(previousMid)) {
          const momentum = (recentMid - previousMid) / previousMid;
          
          // Strong momentum in direction of signal increases confidence
          if (isFinite(momentum) && Math.abs(momentum) > 0.001) {
            accuracy += 0.05;
          }
        }
      }
    }

    // Cap at 0.95 max (never 100% confidence)
    return Math.min(0.95, Math.max(0.1, accuracy));
  }

  private determineSignalDynamic(
    symbol: string,
    imbalance: number,
    microSignals: ResearchResult['microSignals'],
    accuracy: number
  ): 'BUY' | 'SELL' | 'HOLD' {
    if (accuracy < 0.5) {
      return 'HOLD';
    }

    const dynamic = this.computeDynamicThresholds(symbol);
    const thr = Math.max(0.05, Math.min(0.4, dynamic.imbalanceThreshold));

    if (imbalance > thr) {
      return 'BUY';
    } else if (imbalance < -thr) {
      return 'SELL';
    }

    return 'HOLD';
  }

  private getRecommendedAction(signal: 'BUY' | 'SELL' | 'HOLD', accuracy: number): string {
    if (signal === 'HOLD') {
      return 'Wait for better signal';
    }

    if (accuracy >= 0.85) {
      return `Execute ${signal} trade (high confidence)`;
    } else if (accuracy >= 0.7) {
      return `Consider ${signal} trade (moderate confidence)`;
    } else {
      return `Monitor ${signal} signal (low confidence)`;
    }
  }

  addTrade(symbol: string, trade: Trade): void {
    if (!this.recentTrades.has(symbol)) {
      this.recentTrades.set(symbol, []);
    }
    const trades = this.recentTrades.get(symbol);
    if (trades) {
      trades.push(trade);
      // Keep only last 100 trades
      if (trades.length > 100) {
        trades.shift();
      }
    }
  }

  addOrderbook(symbol: string, orderbook: Orderbook): void {
    if (!this.orderbookHistory.has(symbol)) {
      this.orderbookHistory.set(symbol, []);
    }
    const history = this.orderbookHistory.get(symbol);
    if (history) {
      history.push(orderbook);
      // Keep only last 50 snapshots
      if (history.length > 50) {
        history.shift();
      }
    }
  }

  private updateSignalHistories(symbol: string, micro: ResearchResult['microSignals'], imbalance: number): void {
    const pushWithCap = (map: Map<string, number[]>, value: number, cap: number = 200) => {
      if (!map.has(symbol)) map.set(symbol, []);
      const arr = map.get(symbol);
      if (arr) {
        arr.push(value);
        if (arr.length > cap) arr.shift();
      }
    };

    pushWithCap(this.spreadHistory, micro.spread);
    pushWithCap(this.volumeHistory, micro.volume);
    pushWithCap(this.depthHistory, micro.orderbookDepth);
    pushWithCap(this.imbalanceHistory, Math.abs(imbalance));
  }

  private computeVolatility(symbol: string, window: number = 20): number {
    const history = this.orderbookHistory.get(symbol);
    if (!history || history.length < 2) return 0;
    const mids: number[] = history.map((ob) => {
      const b = parseFloat(ob.bids[0]?.price || '0');
      const a = parseFloat(ob.asks[0]?.price || '0');
      return b > 0 && a > 0 ? (b + a) / 2 : 0;
    }).filter((m) => m > 0);
    if (mids.length < 2) return 0;
    const rets: number[] = [];
    const start = Math.max(1, mids.length - window);
    for (let i = start; i < mids.length; i++) {
      // Safe division - check for zero before dividing
      if (mids[i - 1] > 0 && mids[i] > 0) {
        const r = (mids[i] - mids[i - 1]) / mids[i - 1];
        // Only add finite values
        if (isFinite(r)) {
          rets.push(r);
        }
      }
    }
    if (rets.length === 0) return 0;
    const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
    if (!isFinite(mean)) return 0;
    const variance = rets.reduce((s, v) => s + (v - mean) * (v - mean), 0) / rets.length;
    if (!isFinite(variance) || variance < 0) return 0;
    return Math.sqrt(variance);
  }

  private percentile(values: number[], p: number): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
    return sorted[idx];
  }

  private median(values: number[]): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private computeDynamicThresholds(symbol: string): {
    spreadP20: number;
    spreadP40: number;
    spreadP60: number;
    volumeMedian: number;
    depthMedian: number;
    imbalanceStd: number;
    imbalanceThreshold: number;
  } {
    const spreads = this.spreadHistory.get(symbol) || [];
    const volumes = this.volumeHistory.get(symbol) || [];
    const depths = this.depthHistory.get(symbol) || [];
    const imbs = this.imbalanceHistory.get(symbol) || [];

    const spreadP20 = this.percentile(spreads, 20);
    const spreadP40 = this.percentile(spreads, 40);
    const spreadP60 = this.percentile(spreads, 60);
    const volumeMedian = this.median(volumes);
    const depthMedian = this.median(depths);

    const imbMean = imbs.length ? imbs.reduce((s, v) => s + v, 0) / imbs.length : 0;
    const imbVar = imbs.length ? imbs.reduce((s, v) => s + (v - imbMean) * (v - imbMean), 0) / imbs.length : 0;
    const imbalanceStd = Math.sqrt(imbVar);

    const imbP70 = this.percentile(imbs, 70);
    const imbalanceThreshold = imbP70 || 0.2;

    return { spreadP20, spreadP40, spreadP60, volumeMedian, depthMedian, imbalanceStd, imbalanceThreshold };
  }

  private shouldBlockForLiquidity(symbol: string, micro: ResearchResult['microSignals']): boolean {
    const dynamic = this.computeDynamicThresholds(symbol);
    const spread80 = this.percentile(this.spreadHistory.get(symbol) || [micro.spread], 80);
    const spreadTooWide = spread80 > 0 ? micro.spread > spread80 : false;
    const depthTooLow = dynamic.depthMedian > 0 ? micro.orderbookDepth < dynamic.depthMedian * 0.5 : false;
    const volumeTooLow = dynamic.volumeMedian > 0 ? micro.volume < dynamic.volumeMedian * 0.5 : false;
    return spreadTooWide || depthTooLow || volumeTooLow;
  }
}

export const researchEngine = new ResearchEngine();

