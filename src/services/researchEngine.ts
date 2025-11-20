import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { CryptoQuantAdapter } from './cryptoquantAdapter';
import { LunarCrushAdapter } from './lunarcrushAdapter';
import { CoinAPIAdapter } from './coinapiAdapter';
import { apiUsageTracker } from './apiUsageTracker';
import axios from 'axios';
import type { Orderbook, Trade } from '../types';
import type { ExchangeConnector } from './exchangeConnector';

export interface ResearchSignal {
  type: 'entry' | 'exit' | 'sl' | 'tp';
  price: number;
  reason?: string;
}

export interface LiveAnalysis {
  isLive: boolean;
  lastUpdated: string; // ISO timestamp
  summary: string;
  meta?: any;
}

export interface ResearchResult {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  accuracy: number;
  orderbookImbalance: number;
  recommendedAction: string; // Text description
  microSignals: {
    spread: number;
    volume: number;
    priceMomentum: number;
    orderbookDepth: number;
  };
  // Extended fields for full signal output
  entry: number | null;
  exits: number[];
  stopLoss: number | null;
  takeProfit: number | null;
  side: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number; // 0-100
  timeframe: string;
  signals: ResearchSignal[];
  liveAnalysis?: LiveAnalysis;
  message?: string;
  // Accuracy-based mode fields
  currentPrice: number;
  mode: 'LOW' | 'MID_BLUR' | 'NORMAL' | 'TRADE_SETUP';
  recommendedTrade: 'LONG' | 'SHORT' | null; // Trade recommendation (LONG/SHORT) for TRADE_SETUP mode
  blurFields: boolean;
  // API call tracking
  apiCalls: string[]; // Array of API endpoints called
}

export class ResearchEngine {
  private recentTrades: Map<string, Trade[]> = new Map();
  private orderbookHistory: Map<string, Orderbook[]> = new Map();
  private spreadHistory: Map<string, number[]> = new Map();
  private volumeHistory: Map<string, number[]> = new Map();
  private depthHistory: Map<string, number[]> = new Map();
  private imbalanceHistory: Map<string, number[]> = new Map();

  async runResearch(symbol: string, uid: string, adapter?: ExchangeConnector, forceEngine: boolean = false): Promise<ResearchResult> {
    // Track all API calls
    const apiCalls: string[] = [];
    
    logger.info({ symbol, uid, hasAdapter: !!adapter, forceEngine }, 'Starting research engine');
    
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
          // Detect exchange name for API tracking
          const exchangeName = this.detectExchangeName(adapter);
          apiUsageTracker.increment(exchangeName);
          apiCalls.push(`${exchangeName}: GET /orderbook`);
          
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
        accuracy = await this.calculateAccuracy(symbol, imbalance, microSignals, uid, apiCalls);
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

      // Generate full signal output: entry, exits, stopLoss, takeProfit, side, confidence, timeframe, signals
      let entry: number | null = null;
      let exits: number[] = [];
      let stopLoss: number | null = null;
      let takeProfit: number | null = null;
      let side: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
      let confidence: number = Math.round(accuracy * 100); // Convert 0-1 to 0-100
      let timeframe: string = '5m'; // Default timeframe
      let signals: ResearchSignal[] = [];
      let message: string | undefined = undefined;
      let currentPrice = 0; // Declare outside try block for scope

      try {
        // ALWAYS fetch current price - from adapter or Binance fallback
        
        if (adapter) {
          try {
            const exchangeName = this.detectExchangeName(adapter);
            apiUsageTracker.increment(exchangeName);
            apiCalls.push(`${exchangeName}: GET /ticker`);
            
            const ticker = await adapter.getTicker(symbol);
            currentPrice = parseFloat(ticker?.lastPrice || ticker?.price || ticker?.last || '0');
            
            if (currentPrice > 0) {
              logger.debug({ symbol, currentPrice, exchange: exchangeName }, 'Current price fetched from exchange adapter');
            }
          } catch (tickerErr: any) {
            logger.debug({ err: tickerErr, symbol }, 'Could not fetch ticker from adapter, trying Binance fallback');
          }
        }
        
        // Fallback to Binance public API if adapter failed or not available
        if (currentPrice === 0 || forceEngine) {
          try {
            apiCalls.push('Binance: GET /api/v3/ticker/24hr (public)');
            const response = await axios.get(`https://api.binance.com/api/v3/ticker/24hr`, {
              params: { symbol: symbol.toUpperCase() },
              timeout: 5000,
            });
            const fetchedPrice = parseFloat(response.data?.lastPrice || response.data?.price || '0');
            
            if (fetchedPrice > 0) {
              currentPrice = fetchedPrice;
              logger.info({ symbol, currentPrice, forceEngine }, 'Current price fetched from Binance public API');
            } else if (forceEngine && currentPrice === 0) {
              // Force engine mode: retry once more
              logger.warn({ symbol, forceEngine }, 'First Binance attempt failed, retrying...');
              const retryResponse = await axios.get(`https://api.binance.com/api/v3/ticker/24hr`, {
                params: { symbol: symbol.toUpperCase() },
                timeout: 10000,
              });
              currentPrice = parseFloat(retryResponse.data?.lastPrice || retryResponse.data?.price || '0');
              if (currentPrice > 0) {
                logger.info({ symbol, currentPrice }, 'Current price fetched from Binance retry');
              }
            }
          } catch (binanceErr: any) {
            logger.warn({ err: binanceErr, symbol, forceEngine }, 'Could not fetch price from Binance fallback');
            // Last resort: use mid price from orderbook if available
            if (microSignals.volume > 0) {
              const history = this.orderbookHistory.get(symbol);
              if (history && history.length > 0) {
                const latest = history[history.length - 1];
                const bestBid = parseFloat(latest.bids[0]?.price || '0');
                const bestAsk = parseFloat(latest.asks[0]?.price || '0');
                if (bestBid > 0 && bestAsk > 0) {
                  currentPrice = (bestBid + bestAsk) / 2;
                  logger.debug({ symbol, currentPrice }, 'Current price estimated from orderbook');
                }
              }
            }
          }
        }

        // Determine side based on signal
        // For accuracy >= 60, if signal is HOLD, default to LONG for signal generation
        if (signal === 'BUY') {
          side = 'LONG';
        } else if (signal === 'SELL') {
          side = 'SHORT';
        } else if (accuracy >= 0.6 && currentPrice > 0) {
          // If accuracy >= 60 but signal is HOLD, still generate signals (default to LONG)
          side = 'LONG';
        } else {
          side = 'NEUTRAL';
        }

        // ALWAYS generate signals when accuracy >= 60 and currentPrice > 0
        // This ensures signals are always generated for accurate predictions, even if signal is HOLD
        const shouldGenerateSignals = (accuracy >= 0.6 && currentPrice > 0);
        
        if (shouldGenerateSignals) {
          entry = currentPrice;
          
          // Calculate stop loss: 2% below entry for LONG, 2% above for SHORT
          const stopLossPercent = 0.02;
          if (side === 'LONG') {
            stopLoss = currentPrice * (1 - stopLossPercent);
          } else if (side === 'SHORT') {
            stopLoss = currentPrice * (1 + stopLossPercent);
          } else {
            stopLoss = currentPrice * (1 - stopLossPercent); // Default to LONG
          }

          // Calculate take profit: 3% above entry for LONG, 3% below for SHORT
          const takeProfitPercent = 0.03;
          if (side === 'LONG') {
            takeProfit = currentPrice * (1 + takeProfitPercent);
          } else if (side === 'SHORT') {
            takeProfit = currentPrice * (1 - takeProfitPercent);
          } else {
            takeProfit = currentPrice * (1 + takeProfitPercent); // Default to LONG
          }

          // Multiple exit targets (primary TP + 2 additional levels)
          if (side === 'LONG') {
            exits = [
              currentPrice * (1 + takeProfitPercent * 0.5), // First exit at 1.5%
              currentPrice * (1 + takeProfitPercent), // Primary TP at 3%
              currentPrice * (1 + takeProfitPercent * 2), // Tertiary TP at 6%
            ];
          } else if (side === 'SHORT') {
            exits = [
              currentPrice * (1 - takeProfitPercent * 0.5), // First exit at 1.5%
              currentPrice * (1 - takeProfitPercent), // Primary TP at 3%
              currentPrice * (1 - takeProfitPercent * 2), // Tertiary TP at 6%
            ];
          } else {
            // Default to LONG exits
            exits = [
              currentPrice * (1 + takeProfitPercent * 0.5),
              currentPrice * (1 + takeProfitPercent),
              currentPrice * (1 + takeProfitPercent * 2),
            ];
          }

          // Build signals array
          signals = [
            {
              type: 'entry',
              price: entry,
              reason: `Entry signal based on ${signal} recommendation with ${confidence}% confidence`,
            },
            {
              type: 'sl',
              price: stopLoss,
              reason: 'Stop loss set at 2% from entry to limit downside risk',
            },
            {
              type: 'tp',
              price: takeProfit,
              reason: 'Primary take profit target at 3% from entry',
            },
          ];

          // Add all exit signals
          exits.forEach((exitPrice, index) => {
            signals.push({
              type: 'exit',
              price: exitPrice,
              reason: index === 0 ? 'First exit target' : index === 1 ? 'Primary exit target' : 'Final exit target',
            });
          });

          timeframe = '5m'; // Default to 5-minute timeframe
        } else {
          // If we reach here, it means shouldGenerateSignals was false
          // This should only happen if currentPrice is 0 or accuracy < 60
          // But we ALWAYS want to generate signals if accuracy >= 60, so try to get price
          if (accuracy >= 0.6 && currentPrice === 0) {
            // Try to get price from orderbook history as last resort
            const history = this.orderbookHistory.get(symbol);
            if (history && history.length > 0) {
              const latest = history[history.length - 1];
              const bestBid = parseFloat(latest.bids[0]?.price || '0');
              const bestAsk = parseFloat(latest.asks[0]?.price || '0');
              if (bestBid > 0 && bestAsk > 0) {
                currentPrice = (bestBid + bestAsk) / 2;
                entry = currentPrice;
                stopLoss = currentPrice * 0.98;
                takeProfit = currentPrice * 1.03;
                exits = [
                  currentPrice * 1.015, // First exit at 1.5%
                  currentPrice * 1.03, // Primary TP at 3%
                  currentPrice * 1.06, // Final exit at 6%
                ];
                signals = [
                  { type: 'entry', price: entry, reason: `Entry signal with ${confidence}% confidence (estimated price)` },
                  { type: 'sl', price: stopLoss, reason: 'Stop loss set at 2% from entry' },
                  { type: 'tp', price: takeProfit, reason: 'Primary take profit target at 3% from entry' },
                ];
                exits.forEach((exitPrice, idx) => {
                  signals.push({ 
                    type: 'exit', 
                    price: exitPrice, 
                    reason: idx === 0 ? 'First exit target' : idx === 1 ? 'Primary exit target' : 'Final exit target' 
                  });
                });
                timeframe = '5m';
                logger.info({ symbol, accuracy, currentPrice }, 'Generated signals with estimated price from orderbook');
              } else {
                message = 'Unable to determine entry price - exchange API unavailable or symbol not found';
              }
            } else {
              message = 'Unable to determine entry price - no orderbook data available';
            }
          } else if (accuracy < 0.6) {
            message = 'Accuracy below 60% - signals not generated. Wait for better market conditions.';
          } else if (currentPrice === 0) {
            message = 'Unable to determine entry price - exchange API unavailable or symbol not found';
          }
        }
      } catch (signalGenErr: any) {
        logger.warn({ err: signalGenErr, symbol }, 'Error generating full signals, using defaults');
        message = `Signal generation encountered an error: ${signalGenErr.message}`;
      }

      // Determine accuracy-based mode and recommended action
      const accuracyPercent = Math.round(accuracy * 100);
      let mode: 'LOW' | 'MID_BLUR' | 'NORMAL' | 'TRADE_SETUP' = 'NORMAL';
      let finalRecommendedTrade: 'LONG' | 'SHORT' | null = null;
      let blurFields = false;
      let finalMessage = message;

      if (accuracyPercent < 50) {
        mode = 'LOW';
        // Hide entry/sl/tp/exits/signals for LOW mode
        entry = null;
        exits = [];
        stopLoss = null;
        takeProfit = null;
        signals = [];
        finalRecommendedTrade = null;
        finalMessage = 'Accuracy below 50% — Avoid trading';
      } else if (accuracyPercent >= 50 && accuracyPercent < 60) {
        mode = 'MID_BLUR';
        blurFields = true;
        // Keep all fields but mark for blur
        finalRecommendedTrade = null;
      } else if (accuracyPercent >= 60 && accuracyPercent < 75) {
        mode = 'NORMAL';
        // Show all signals but don't recommend trade
        finalRecommendedTrade = null;
      } else if (accuracyPercent >= 75) {
        mode = 'TRADE_SETUP';
        // Show all signals + add recommendedTrade
        if (side === 'LONG') {
          finalRecommendedTrade = 'LONG';
        } else if (side === 'SHORT') {
          finalRecommendedTrade = 'SHORT';
        } else {
          finalRecommendedTrade = null;
        }
      }

      // Ensure currentPrice is always set (use 0 if not available)
      if (currentPrice === 0 && entry !== null) {
        currentPrice = entry;
      }

      // Generate liveAnalysis
      let liveAnalysis: LiveAnalysis | undefined = undefined;
      try {
        const now = new Date();
        liveAnalysis = {
          isLive: true,
          lastUpdated: now.toISOString(),
          summary: `${symbol} analysis: ${signal} signal with ${confidence}% confidence. ${side !== 'NEUTRAL' ? `Entry: ${entry || 'N/A'}, SL: ${stopLoss || 'N/A'}, TP: ${takeProfit || 'N/A'}` : 'No active trade signals.'}`,
          meta: {
            accuracy,
            orderbookImbalance: imbalance,
            microSignals,
            timeframe,
            mode,
          },
        };
      } catch (liveErr: any) {
        logger.warn({ err: liveErr, symbol }, 'Error generating liveAnalysis');
        liveAnalysis = {
          isLive: false,
          lastUpdated: new Date().toISOString(),
          summary: 'Live analysis temporarily unavailable',
          meta: {},
        };
      }

      // Ensure apiCalls is always an array
      const finalApiCalls = Array.isArray(apiCalls) ? apiCalls : [];
      
      const result: ResearchResult = {
        symbol,
        signal,
        accuracy,
        orderbookImbalance: imbalance,
        recommendedAction: finalRecommendedTrade ? (finalRecommendedTrade === 'LONG' ? 'Consider LONG trade' : 'Consider SHORT trade') : recommendedAction,
        microSignals,
        entry,
        exits,
        stopLoss,
        takeProfit,
        side,
        confidence,
        timeframe,
        signals,
        liveAnalysis,
        message: finalMessage,
        currentPrice,
        mode,
        recommendedTrade: finalRecommendedTrade,
        blurFields,
        apiCalls: finalApiCalls, // Always include API call log
      };
      
      logger.info({ 
        symbol, 
        accuracy, 
        mode, 
        hasEntry: entry !== null,
        signalsCount: signals.length,
        apiCallsCount: finalApiCalls.length,
        forceEngine 
      }, 'Research result generated');

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
      
      // DEBUG: Log the RAW result being returned - check for any wrappers
      console.log('🔍 [RESEARCH_ENGINE] RUN RESEARCH RAW RETURN:', JSON.stringify(result, null, 2));
      console.log('🔍 [RESEARCH_ENGINE] Result type:', typeof result);
      console.log('🔍 [RESEARCH_ENGINE] Result keys:', Object.keys(result || {}));
      console.log('🔍 [RESEARCH_ENGINE] Has data wrapper?', 'data' in (result as any));
      console.log('🔍 [RESEARCH_ENGINE] Has result wrapper?', 'result' in (result as any));
      console.log('🔍 [RESEARCH_ENGINE] Has analysis wrapper?', 'analysis' in (result as any));

      // Log generated signals
      console.log('[DEEP-RESEARCH] Generated signals:', {
        symbol,
        entry,
        stopLoss,
        takeProfit,
        side,
        confidence,
        timeframe,
        signalsCount: signals.length,
      });
      
      console.log('🔍 [RESEARCH_ENGINE] CLEAN RESULT RETURN:', JSON.stringify(result, null, 2));
      console.log('[ENGINE RESULT]', JSON.stringify(result, null, 2));
      
      return result;
    } catch (error: any) {
      // Wrap entire research in try/catch to prevent any unhandled errors
      // NEVER throw - always return a valid result even on error
      logger.error({ error: error.message, symbol, uid, stack: error.stack }, 'Error in runResearch - returning complete result with error state');
      
      // Return complete result with error state - ensure ALL required fields are present
      // This is NOT a fallback - it's a complete result indicating an error state
      const errorResult: ResearchResult = {
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
        entry: null,
        exits: [],
        stopLoss: null,
        takeProfit: null,
        side: 'NEUTRAL',
        confidence: 50,
        timeframe: '5m',
        signals: [],
        liveAnalysis: {
          isLive: false,
          lastUpdated: new Date().toISOString(),
          summary: 'Research engine encountered an error',
          meta: {},
        },
        message: `Research error: ${error.message || 'Unknown error'}`,
        currentPrice: 0,
        mode: 'LOW' as const,
        recommendedTrade: null,
        blurFields: false,
        apiCalls: apiCalls.length > 0 ? apiCalls : [], // Include any API calls made before error
      };
      
      console.log('🔍 [RESEARCH_ENGINE] ERROR RESULT RETURN:', JSON.stringify(errorResult, null, 2));
      console.log('[ENGINE RESULT]', JSON.stringify(errorResult, null, 2));
      
      return errorResult;
    }
  }

  /**
   * Detect exchange name from adapter for API tracking
   */
  private detectExchangeName(adapter: ExchangeConnector): string {
    const adapterName = adapter.constructor.name.toLowerCase();
    if (adapterName.includes('binance')) return 'binance';
    if (adapterName.includes('bitget')) return 'bitget';
    if (adapterName.includes('kucoin')) return 'kucoin';
    if (adapterName.includes('bingx')) return 'bingx';
    if (adapterName.includes('weex')) return 'weex';
    if (adapterName.includes('bybit')) return 'bybit';
    if (adapterName.includes('okx')) return 'okx';
    return 'unknown';
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
    uid?: string,
    apiCalls?: string[]
  ): Promise<number> {
    // Multi-source accuracy calculation using all available data sources
    let accuracy = 0.5; // Base accuracy

    // 1. Orderbook imbalance strength (Exchange data if available)
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
                  apiUsageTracker.increment('cryptoquant');
                  apiCalls.push('CryptoQuant: GET /market-metrics');
                  
                  const onChainData = await cryptoquantAdapter.getOnChainMetrics(symbol);
                  
                  apiUsageTracker.increment('cryptoquant');
                  apiCalls.push('CryptoQuant: GET /exchange-flow');
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
                apiUsageTracker.increment('lunarcrush');
                apiCalls.push('LunarCrush: GET /coin-data');
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
                  apiUsageTracker.increment('coinapi');
                  apiCalls.push('CoinAPI: GET /market-data');
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
                  apiUsageTracker.increment('coinapi');
                  apiCalls.push('CoinAPI: GET /historical-data');
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

