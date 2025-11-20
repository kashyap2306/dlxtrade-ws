import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { CryptoQuantAdapter } from './cryptoquantAdapter';
import { LunarCrushAdapter } from './lunarcrushAdapter';
import { CoinAPIAdapter } from './coinapiAdapter';
import { apiUsageTracker } from './apiUsageTracker';
import { featureEngine } from './featureEngine';
import { mlModelService } from './ml/mlModelService';
import { CoinGlassConnector } from './dataConnectors/coinglassConnector';
import { IntoTheBlockConnector } from './dataConnectors/intotheblockConnector';
import { NewsApiConnector } from './dataConnectors/newsApiConnector';
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
  status: 'ok' | 'insufficient_data' | 'error'; // Status field for data quality
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
  // ML Model explainability - always included
  explanations: string[]; // SHAP-based explanations (max 12)
  accuracyRange: string | undefined; // e.g., "85-90%"
  // Extended fields for full details (manual research)
  rsi5?: number | null;
  rsi14?: number | null;
  trendAnalysis?: {
    ema12: number | null;
    ema26: number | null;
    trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  } | null;
  confidenceBreakdown?: {
    baseAccuracy: number;
    orderbookImbalance: number;
    spreadAnalysis: number;
    volumeDepth: number;
    orderbookDepth: number;
    externalAPIs: number;
    mlModel: number;
  };
  exchangeTickers?: Record<string, any>;
  exchangeOrderbooks?: Array<{ exchange: string; bidsCount: number; asksCount: number }>;
  exchangeCount?: number;
  exchangesUsed?: string[];
  autoTradeDecision?: {
    triggered: boolean;
    confidence: number;
    threshold: number;
    reason?: string;
  };
  features?: {
    rsi: number;
    macd: { signal: number; histogram: number; trend: string };
    volume: string;
    orderbookImbalance: string;
    fundingRate: string;
    openInterest: string;
    liquidations: string;
    trendStrength: string;
    volatility: string;
    newsSentiment: string;
  };
}

export class ResearchEngine {
  private recentTrades: Map<string, Trade[]> = new Map();
  private orderbookHistory: Map<string, Orderbook[]> = new Map();
  private spreadHistory: Map<string, number[]> = new Map();
  private volumeHistory: Map<string, number[]> = new Map();
  private depthHistory: Map<string, number[]> = new Map();
  private imbalanceHistory: Map<string, number[]> = new Map();
  
  // ML Model connectors (optional - only if API keys provided)
  private coinGlassConnector?: CoinGlassConnector;
  private intoTheBlockConnector?: IntoTheBlockConnector;
  private newsApiConnector?: NewsApiConnector;
  
  constructor() {
    // Initialize connectors if API keys are available
    if (process.env.COINGLASS_API_KEY) {
      this.coinGlassConnector = new CoinGlassConnector(process.env.COINGLASS_API_KEY);
    }
    if (process.env.INTO_THE_BLOCK_API_KEY) {
      this.intoTheBlockConnector = new IntoTheBlockConnector(process.env.INTO_THE_BLOCK_API_KEY);
    }
    if (process.env.NEWS_API_KEY) {
      this.newsApiConnector = new NewsApiConnector(process.env.NEWS_API_KEY);
    }
  }

  /**
   * Aggregate orderbook data from multiple exchanges
   */
  private async aggregateOrderbooks(
    symbol: string,
    adapters: Array<{ exchange: string; adapter: ExchangeConnector }>,
    apiCalls: string[]
  ): Promise<{ aggregatedOrderbook: Orderbook | null; exchangeOrderbooks: Map<string, Orderbook> }> {
    const exchangeOrderbooks = new Map<string, Orderbook>();
    const allBids: Array<{ price: string; quantity: string }> = [];
    const allAsks: Array<{ price: string; quantity: string }> = [];

    // Fetch orderbooks from all exchanges in parallel
    const orderbookPromises = adapters.map(async ({ exchange, adapter }) => {
      try {
        const exchangeName = this.detectExchangeName(adapter);
        apiUsageTracker.increment(exchangeName);
        apiCalls.push(`${exchangeName}: GET /orderbook`);
        
        logger.debug({ symbol, exchange, exchangeName }, `Fetching orderbook from ${exchange}`);
        const orderbook = await adapter.getOrderbook(symbol, 20);
        
        if (!orderbook || !orderbook.bids || !orderbook.asks || orderbook.bids.length === 0 || orderbook.asks.length === 0) {
          logger.warn({ symbol, exchange, hasOrderbook: !!orderbook, bidsCount: orderbook?.bids?.length || 0, asksCount: orderbook?.asks?.length || 0 }, 
            `Empty or invalid orderbook from ${exchange}`);
          return;
        }
        
        exchangeOrderbooks.set(exchange, orderbook);
        
        // Collect bids and asks for aggregation
        allBids.push(...orderbook.bids);
        allAsks.push(...orderbook.asks);
        
        logger.info({ symbol, exchange, bidsCount: orderbook.bids.length, asksCount: orderbook.asks.length }, 
          `Orderbook successfully fetched from ${exchange}`);
      } catch (err: any) {
        logger.error({ err: err.message, stack: err.stack, symbol, exchange }, `Failed to fetch orderbook from ${exchange}`);
      }
    });

    await Promise.allSettled(orderbookPromises);

    // Aggregate orderbooks: sort by price and merge quantities at same price
    const aggregatedBids = this.mergeOrderbookLevels(allBids, 'desc');
    const aggregatedAsks = this.mergeOrderbookLevels(allAsks, 'asc');

    const aggregatedOrderbook: Orderbook | null = 
      aggregatedBids.length > 0 && aggregatedAsks.length > 0
        ? { 
            symbol,
            bids: aggregatedBids.slice(0, 20), 
            asks: aggregatedAsks.slice(0, 20),
            lastUpdateId: 0, // Aggregated orderbook doesn't have a single update ID
          }
        : null;

    return { aggregatedOrderbook, exchangeOrderbooks };
  }

  /**
   * Merge orderbook levels at same price
   */
  private mergeOrderbookLevels(
    levels: Array<{ price: string; quantity: string }>,
    direction: 'asc' | 'desc'
  ): Array<{ price: string; quantity: string }> {
    const priceMap = new Map<string, number>();
    
    for (const level of levels) {
      const price = parseFloat(level.price);
      if (isNaN(price) || price <= 0) continue;
      
      const priceKey = price.toFixed(8); // Normalize price precision
      const existingQty = priceMap.get(priceKey) || 0;
      priceMap.set(priceKey, existingQty + parseFloat(level.quantity));
    }

    // Convert back to array and sort
    const merged = Array.from(priceMap.entries())
      .map(([price, quantity]) => ({ price, quantity: quantity.toString() }))
      .sort((a, b) => {
        const diff = parseFloat(a.price) - parseFloat(b.price);
        return direction === 'asc' ? diff : -diff;
      });

    return merged;
  }

  /**
   * Aggregate ticker data from multiple exchanges
   */
  private async aggregateTickers(
    symbol: string,
    adapters: Array<{ exchange: string; adapter: ExchangeConnector }>,
    apiCalls: string[]
  ): Promise<{ aggregatedPrice: number; exchangeTickers: Map<string, any> }> {
    const exchangeTickers = new Map<string, any>();
    const prices: number[] = [];

    // Fetch tickers from all exchanges in parallel
    const tickerPromises = adapters.map(async ({ exchange, adapter }) => {
      try {
        const exchangeName = this.detectExchangeName(adapter);
        apiUsageTracker.increment(exchangeName);
        apiCalls.push(`${exchangeName}: GET /ticker`);
        
        logger.debug({ symbol, exchange, exchangeName }, `Fetching ticker from ${exchange}`);
        const ticker = await adapter.getTicker(symbol);
        
        if (!ticker) {
          logger.warn({ symbol, exchange }, `Empty ticker response from ${exchange}`);
          return;
        }
        
        exchangeTickers.set(exchange, ticker);
        
        const price = parseFloat(ticker?.lastPrice || ticker?.price || ticker?.last || '0');
        if (price > 0) {
          prices.push(price);
          logger.info({ symbol, exchange, price }, `Ticker successfully fetched from ${exchange}: $${price}`);
        } else {
          logger.warn({ symbol, exchange, ticker }, `Invalid price from ${exchange} ticker`);
        }
      } catch (err: any) {
        logger.error({ err: err.message, stack: err.stack, symbol, exchange }, `Failed to fetch ticker from ${exchange}`);
      }
    });

    await Promise.allSettled(tickerPromises);

    // Use median price as aggregated price (more robust than average)
    const aggregatedPrice = prices.length > 0 
      ? prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)]
      : 0;

    return { aggregatedPrice, exchangeTickers };
  }

  async runResearch(
    symbol: string, 
    uid: string, 
    adapter?: ExchangeConnector, 
    forceEngine: boolean = false,
    allExchanges?: Array<{ exchange: string; adapter: ExchangeConnector; credentials: any }>
  ): Promise<ResearchResult> {
    // Track all API calls
    const apiCalls: string[] = [];
    
    logger.info({ symbol, uid, hasAdapter: !!adapter, exchangeCount: allExchanges?.length || 0, forceEngine }, 'Starting research engine');
    
    try {
      // Get ALL connected exchanges for aggregation
      const exchangesToUse: Array<{ exchange: string; adapter: ExchangeConnector }> = [];
      
      if (allExchanges && allExchanges.length > 0) {
        // Use all provided exchanges
        for (const ex of allExchanges) {
          if (ex.adapter) {
            exchangesToUse.push({ exchange: ex.exchange, adapter: ex.adapter });
          }
        }
      } else if (adapter) {
        // Fallback to single adapter if no list provided
        exchangesToUse.push({ exchange: this.detectExchangeName(adapter), adapter });
      }

      // Aggregate orderbook data from ALL exchanges
      let imbalance = 0; // Neutral imbalance when no orderbook data
      let microSignals: ResearchResult['microSignals'] = {
        spread: 0,
        volume: 0,
        priceMomentum: 0,
        orderbookDepth: 0,
        // @ts-ignore: extend runtime shape
        volatility: 0,
      };
      let aggregatedOrderbook: Orderbook | null = null;
      let exchangeOrderbooks = new Map<string, Orderbook>();

      if (exchangesToUse.length > 0) {
        try {
          const { aggregatedOrderbook: aggOb, exchangeOrderbooks: exOb } = 
            await this.aggregateOrderbooks(symbol, exchangesToUse, apiCalls);
          
          aggregatedOrderbook = aggOb;
          exchangeOrderbooks = exOb;

          if (aggregatedOrderbook) {
            // Calculate orderbook imbalance from aggregated data
            imbalance = this.calculateOrderbookImbalance(aggregatedOrderbook);
            
            // Get micro-signals from aggregated orderbook
            microSignals = this.calculateMicroSignals(symbol, aggregatedOrderbook);

            // Persist snapshot for momentum/history-based features (CRITICAL for RSI/trend calculations)
            this.addOrderbook(symbol, aggregatedOrderbook);
            
            logger.info({ 
              symbol, 
              exchangeCount: exchangesToUse.length, 
              imbalance, 
              volume: microSignals.volume,
              spread: microSignals.spread,
              depth: microSignals.orderbookDepth,
              historySize: this.orderbookHistory.get(symbol)?.length || 0
            }, `Aggregated orderbook from ${exchangesToUse.length} exchanges`);
          } else {
            logger.warn({ symbol, exchangeCount: exchangesToUse.length }, 'No aggregated orderbook data available - RSI/trend calculations will fail');
          }
        } catch (orderbookErr: any) {
          logger.warn({ err: orderbookErr, symbol }, 'Could not aggregate orderbooks, using defaults');
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
      
      // Determine signal using dynamic thresholds (ML prediction will override if available)
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
      let mlPrediction: { signal: 'BUY' | 'SELL' | 'HOLD'; probability: number; explanations: string[] } | null = null;
      let explanations: string[] = [];
      let exchangeTickers = new Map<string, any>(); // Declare at function level for scope

      try {
        // ALWAYS fetch current price - aggregate from ALL exchanges or Binance fallback
        
        if (exchangesToUse.length > 0) {
          try {
            const { aggregatedPrice, exchangeTickers: exTickers } = 
              await this.aggregateTickers(symbol, exchangesToUse, apiCalls);
            
            currentPrice = aggregatedPrice;
            exchangeTickers = exTickers;
            
            if (currentPrice > 0) {
              logger.info({ symbol, currentPrice, exchangeCount: exchangesToUse.length }, 
                `Aggregated price from ${exchangesToUse.length} exchanges`);
            }
          } catch (tickerErr: any) {
            logger.warn({ err: tickerErr, symbol }, 'Could not aggregate tickers, trying fallback');
          }
        }
        
        // Fallback to Binance public API if aggregation failed or no exchanges available
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

        // ML Model Prediction (if model is available and we have price)
        let mlPrediction: { signal: 'BUY' | 'SELL' | 'HOLD'; probability: number; explanations: string[]; accuracyRange?: string } | null = null;
        let mlExplanations: string[] = [];
        
        if (currentPrice > 0) {
          try {
            // Compute feature vector for ML model
            const orderbookForML = adapter ? await adapter.getOrderbook(symbol, 20).catch(() => null) : null;
            const trades = this.recentTrades.get(symbol) || [];
            const volume24h = microSignals.volume || 0;
            
            const featureVector = featureEngine.computeFeatureVector(
              symbol,
              currentPrice,
              orderbookForML,
              trades,
              volume24h,
              '5m'
            );
            
            // Get ML prediction
            try {
              const isModelReady = await mlModelService.isModelReady();
              if (isModelReady) {
                logger.debug({ symbol }, 'ML model is ready, getting prediction');
                mlPrediction = await mlModelService.predict(featureVector, symbol);
                mlExplanations = mlPrediction.explanations || [];
                
                logger.info({ 
                  symbol, 
                  mlSignal: mlPrediction.signal, 
                  mlProbability: mlPrediction.probability,
                  currentAccuracy: accuracy,
                  willUpdate: mlPrediction.probability > accuracy
                }, 'ML model prediction obtained');
                
                // Use ML probability as accuracy if higher
                if (mlPrediction.probability > accuracy) {
                  const oldAccuracy = accuracy;
                  accuracy = mlPrediction.probability;
                  logger.info({ 
                    symbol, 
                    oldAccuracy: Math.round(oldAccuracy * 100), 
                    newAccuracy: Math.round(accuracy * 100),
                    mlProbability: Math.round(mlPrediction.probability * 100)
                  }, 'ML model improved accuracy');
                } else {
                  logger.debug({ 
                    symbol, 
                    mlProbability: Math.round(mlPrediction.probability * 100),
                    currentAccuracy: Math.round(accuracy * 100)
                  }, 'ML model probability not higher than current accuracy');
                }
                
                // Use ML signal if probability >= threshold
                const mlThreshold = parseFloat(process.env.ML_PROBABILITY_THRESHOLD || '0.75');
                if (mlPrediction.probability >= mlThreshold) {
                  signal = mlPrediction.signal;
                  logger.info({ symbol, signal, probability: mlPrediction.probability, threshold: mlThreshold }, 'Using ML model signal');
                }
              } else {
                logger.debug({ symbol }, 'ML model is not ready, skipping ML prediction');
              }
            } catch (mlCheckErr: any) {
              logger.warn({ err: mlCheckErr, symbol }, 'ML model check/prediction failed, using rule-based logic');
            }
          } catch (mlErr: any) {
            logger.warn({ err: mlErr, symbol }, 'ML prediction failed, using rule-based logic');
          }
        }

        // Generate comprehensive explanations from all available indicators
        let explanations: string[] = [];
        try {
          explanations = await this.generateExplanations(
            symbol,
            currentPrice,
            imbalance,
            microSignals,
            signal,
            accuracy,
            adapter,
            uid,
            apiCalls
          );
          // Merge ML explanations if available (they may be more sophisticated)
          if (mlExplanations.length > 0) {
            explanations = [...mlExplanations, ...explanations].slice(0, 12); // Max 12 explanations
          }
        } catch (explErr: any) {
          logger.warn({ err: explErr, symbol }, 'Explanation generation failed, using ML or basic explanations');
          explanations = mlExplanations.length > 0 ? mlExplanations : [];
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
      
      // Calculate RSI for full details (if we have price history)
      // IMPORTANT: RSI requires at least 14 price points, so we need orderbook history
      // CRITICAL: If orderbookHistory is empty, RSI will be null (this is expected on first run)
      let rsi14: number | null = null;
      let rsi5: number | null = null;
      if (currentPrice > 0) {
        const history = this.orderbookHistory.get(symbol);
        logger.debug({ 
          symbol, 
          historyLength: history?.length || 0, 
          currentPrice,
          hasHistory: !!history 
        }, '[DIAGNOSTIC] RSI calculation check');
        
        if (history && history.length >= 14) {
          try {
            const prices = history.slice(-14).map(ob => {
              const bid = parseFloat(ob.bids[0]?.price || '0');
              const ask = parseFloat(ob.asks[0]?.price || '0');
              return (bid + ask) / 2;
            }).filter(p => p > 0);
            
            logger.debug({ symbol, pricesLength: prices.length, required: 14 }, '[DIAGNOSTIC] RSI price extraction');
            
            if (prices.length >= 14) {
              const { featureEngine } = await import('./featureEngine');
              rsi14 = featureEngine.calculateRSI(prices, 14);
              logger.info({ symbol, rsi14, historyLength: history.length }, '[DIAGNOSTIC] RSI(14) calculated successfully');
              
              if (prices.length >= 5) {
                rsi5 = featureEngine.calculateRSI(prices.slice(-5), 5);
                logger.info({ symbol, rsi5 }, '[DIAGNOSTIC] RSI(5) calculated successfully');
              }
            } else {
              logger.warn({ symbol, pricesLength: prices.length, historyLength: history.length, required: 14 }, 
                '[DIAGNOSTIC] Not enough valid prices for RSI calculation');
            }
          } catch (rsiErr: any) {
            logger.error({ err: rsiErr.message, stack: rsiErr.stack, symbol }, '[DIAGNOSTIC] RSI calculation FAILED');
          }
        } else {
          logger.warn({ 
            symbol, 
            historyLength: history?.length || 0, 
            required: 14,
            currentPrice 
          }, '[DIAGNOSTIC] Not enough orderbook history for RSI (need at least 14 snapshots) - RSI will be null');
        }
      } else {
        logger.warn({ symbol, currentPrice }, '[DIAGNOSTIC] Cannot calculate RSI - currentPrice is 0');
      }
      
      // Get trend analysis (EMA/MA)
      // IMPORTANT: EMA requires at least 26 price points
      // CRITICAL: If orderbookHistory is empty, trendAnalysis will be null (this is expected on first run)
      let trendAnalysis: { ema12: number | null; ema26: number | null; trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' } | null = null;
      if (currentPrice > 0) {
        const history = this.orderbookHistory.get(symbol);
        logger.debug({ 
          symbol, 
          historyLength: history?.length || 0, 
          currentPrice,
          hasHistory: !!history,
          required: 26
        }, '[DIAGNOSTIC] Trend analysis check');
        
        if (history && history.length >= 26) {
          try {
            const prices = history.slice(-26).map(ob => {
              const bid = parseFloat(ob.bids[0]?.price || '0');
              const ask = parseFloat(ob.asks[0]?.price || '0');
              return (bid + ask) / 2;
            }).filter(p => p > 0);
            
            logger.debug({ symbol, pricesLength: prices.length, required: 26 }, '[DIAGNOSTIC] Trend price extraction');
            
            if (prices.length >= 26) {
              const { featureEngine } = await import('./featureEngine');
              const ema12 = featureEngine.calculateEMA(prices, 12);
              const ema26 = featureEngine.calculateEMA(prices, 26);
              
              logger.debug({ symbol, ema12, ema26 }, '[DIAGNOSTIC] EMA values calculated');
              
              let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
              if (ema12 !== null && ema26 !== null) {
                if (ema12 > ema26) {
                  trend = 'BULLISH';
                } else if (ema12 < ema26) {
                  trend = 'BEARISH';
                }
                
                trendAnalysis = { ema12, ema26, trend };
                logger.info({ symbol, ema12, ema26, trend, historyLength: history.length }, '[DIAGNOSTIC] Trend analysis calculated successfully');
              } else {
                logger.warn({ symbol, ema12, ema26 }, '[DIAGNOSTIC] EMA calculation returned null values');
              }
            } else {
              logger.warn({ symbol, pricesLength: prices.length, historyLength: history.length, required: 26 }, 
                '[DIAGNOSTIC] Not enough valid prices for trend analysis');
            }
          } catch (trendErr: any) {
            logger.error({ err: trendErr.message, stack: trendErr.stack, symbol }, '[DIAGNOSTIC] Trend analysis FAILED');
          }
        } else {
          logger.warn({ 
            symbol, 
            historyLength: history?.length || 0, 
            required: 26,
            currentPrice 
          }, '[DIAGNOSTIC] Not enough orderbook history for trend analysis (need at least 26 snapshots) - trendAnalysis will be null');
        }
      } else {
        logger.warn({ symbol, currentPrice }, '[DIAGNOSTIC] Cannot calculate trend - currentPrice is 0');
      }
      
      // Confidence breakdown
      const imbalanceStrength = Math.abs(imbalance);
      const orderbookImbalanceContrib = imbalanceStrength > 0.3 ? 0.15 : imbalanceStrength > 0.15 ? 0.1 : imbalanceStrength > 0.05 ? 0.05 : 0;
      const spreadContrib = microSignals.spread < 0.05 ? 0.15 : microSignals.spread < 0.1 ? 0.1 : microSignals.spread < 0.2 ? 0.05 : 0;
      const volumeContrib = microSignals.volume > 500000 ? 0.15 : microSignals.volume > 100000 ? 0.1 : microSignals.volume > 50000 ? 0.05 : 0;
      const depthContrib = microSignals.orderbookDepth > 1000000 ? 0.1 : microSignals.orderbookDepth > 500000 ? 0.05 : 0;
      const baseContrib = 0.5;
      const externalAPIsContrib = Math.max(0, accuracy - baseContrib - orderbookImbalanceContrib - spreadContrib - volumeContrib - depthContrib);
      
      const confidenceBreakdown = {
        baseAccuracy: baseContrib,
        orderbookImbalance: orderbookImbalanceContrib,
        spreadAnalysis: spreadContrib,
        volumeDepth: volumeContrib,
        orderbookDepth: depthContrib,
        externalAPIs: externalAPIsContrib,
        mlModel: mlPrediction && mlPrediction.probability > accuracy ? mlPrediction.probability - accuracy : 0,
      };
      
      // Determine status based on data quality
      // If key metrics are missing (spread=0, volume=0, depth=0), mark as insufficient_data
      const hasValidData = microSignals.spread > 0 || microSignals.volume > 0 || microSignals.orderbookDepth > 0;
      const status: 'ok' | 'insufficient_data' | 'error' = hasValidData ? 'ok' : 'insufficient_data';
      
      if (status === 'insufficient_data') {
        logger.warn({ 
          symbol,
          spread: microSignals.spread,
          volume: microSignals.volume,
          depth: microSignals.orderbookDepth
        }, '[RESEARCH] Marking result as insufficient_data - key metrics are zero');
      }
      
      // Calculate Feature Breakdown
      const features = await this.calculateFeatures(
        symbol,
        rsi14,
        trendAnalysis,
        microSignals,
        imbalance,
        currentPrice,
        uid
      );
      
      const result: ResearchResult = {
        symbol,
        status,
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
        explanations: explanations.length > 0 ? explanations : [], // Always include explanations array
        accuracyRange: ((mlPrediction && 'accuracyRange' in mlPrediction && typeof mlPrediction.accuracyRange === 'string') ? mlPrediction.accuracyRange as string : undefined)
          || (accuracy >= 0.9
            ? '90-95%'
            : accuracy >= 0.85
            ? '85-90%'
            : accuracy >= 0.8
            ? '80-85%'
            : accuracy >= 0.75
            ? '75-80%'
            : undefined) || undefined, // Always include accuracyRange field (may be undefined)
        // Extended fields for full details (manual research)
        rsi14: rsi14 ?? null,
        rsi5: rsi5 ?? null,
        trendAnalysis: trendAnalysis ?? null,
        confidenceBreakdown: confidenceBreakdown ?? undefined,
        exchangeTickers: exchangeTickers.size > 0 ? Object.fromEntries(exchangeTickers) : (exchangesToUse.length > 0 ? {} : undefined), // Empty object if exchanges attempted but failed
        exchangeOrderbooks: exchangeOrderbooks.size > 0 
          ? Array.from(exchangeOrderbooks.entries()).map(([ex, ob]) => ({ exchange: ex, bidsCount: ob.bids.length, asksCount: ob.asks.length }))
          : (exchangesToUse.length > 0 ? [] : undefined), // Empty array if exchanges attempted but failed
        features: features,
      };
      
      // DIAGNOSTIC: Log final result structure
      logger.info({
        symbol,
        hasRSI14: result.rsi14 !== null && result.rsi14 !== undefined,
        hasRSI5: result.rsi5 !== null && result.rsi5 !== undefined,
        hasTrendAnalysis: !!result.trendAnalysis,
        exchangeTickersCount: result.exchangeTickers ? Object.keys(result.exchangeTickers).length : 0,
        exchangeOrderbooksCount: result.exchangeOrderbooks ? result.exchangeOrderbooks.length : 0,
        hasConfidenceBreakdown: !!result.confidenceBreakdown,
        confidence: result.confidence,
        accuracy: result.accuracy,
        microSignals: {
          spread: result.microSignals.spread,
          volume: result.microSignals.volume,
          depth: result.microSignals.orderbookDepth
        }
      }, '[DIAGNOSTIC] Final ResearchResult structure');
      
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
        status: 'error',
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
        explanations: [], // Always include explanations array
        accuracyRange: undefined, // Always include accuracyRange field
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

  /**
   * Calculate Feature Breakdown for UI display
   */
  private async calculateFeatures(
    symbol: string,
    rsi14: number | null,
    trendAnalysis: { ema12: number | null; ema26: number | null; trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' } | null,
    microSignals: ResearchResult['microSignals'],
    imbalance: number,
    currentPrice: number,
    uid?: string
  ): Promise<ResearchResult['features']> {
    const { featureEngine } = await import('./featureEngine');
    
    // 1. RSI
    const rsiValue = rsi14 ?? 50;
    const rsiDirection = rsiValue > 70 ? 'Overbought' : rsiValue < 30 ? 'Oversold' : rsiValue > 50 ? 'Bullish' : 'Bearish';
    
    // 2. MACD
    let macdData = { signal: 0, histogram: 0, trend: 'NEUTRAL' as string };
    try {
      const history = this.orderbookHistory.get(symbol);
      if (history && history.length >= 26 && currentPrice > 0) {
        const prices = history.slice(-26).map(ob => {
          const bid = parseFloat(ob.bids[0]?.price || '0');
          const ask = parseFloat(ob.asks[0]?.price || '0');
          return (bid + ask) / 2;
        }).filter(p => p > 0);
        
        if (prices.length >= 26) {
          const macd = featureEngine.calculateMACD(prices);
          const macdTrend = macd.histogram > 0 
            ? (macd.macd > macd.signal ? 'BULLISH' : 'NEUTRAL')
            : (macd.macd < macd.signal ? 'BEARISH' : 'NEUTRAL');
          macdData = {
            signal: macd.signal,
            histogram: macd.histogram,
            trend: macdTrend,
          };
        }
      }
    } catch (err: any) {
      logger.debug({ err, symbol }, 'MACD calculation failed for features');
    }
    
    // 3. Volume Analysis
    const volumeHistory = this.volumeHistory.get(symbol) || [];
    let volumeAnalysis = 'Stable';
    if (volumeHistory.length >= 2) {
      const recent = volumeHistory.slice(-5);
      const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const current = microSignals.volume;
      const change = ((current - avg) / avg) * 100;
      if (change > 20) volumeAnalysis = 'Increasing';
      else if (change < -20) volumeAnalysis = 'Decreasing';
    }
    
    // 4. Orderbook Imbalance
    const imbalancePct = Math.abs(imbalance) * 100;
    const imbalanceDirection = imbalance > 0 ? 'Buy Pressure' : imbalance < 0 ? 'Sell Pressure' : 'Balanced';
    const orderbookImbalanceStr = `${imbalanceDirection} (${imbalancePct.toFixed(1)}%)`;
    
    // 5. Liquidity Zones (based on orderbook depth)
    const liquidityZonesStr = microSignals.orderbookDepth > 1000000 
      ? 'Strong' 
      : microSignals.orderbookDepth > 500000 
        ? 'Moderate' 
        : 'Weak';
    
    // 6. Funding Rate
    let fundingRateStr = 'N/A';
    try {
      if (this.coinGlassConnector) {
        const coinGlassData = await this.coinGlassConnector.getFundingRate(symbol).catch(() => null);
        if (coinGlassData?.fundingRate !== undefined && coinGlassData.fundingRate !== null) {
          const fr = coinGlassData.fundingRate * 100;
          fundingRateStr = fr > 0 ? `Positive (${fr.toFixed(4)}%)` : `Negative (${fr.toFixed(4)}%)`;
        }
      }
    } catch (err: any) {
      logger.debug({ err, symbol }, 'Funding rate fetch failed');
    }
    
    // 7. Open Interest
    let openInterestStr = 'N/A';
    try {
      if (this.coinGlassConnector) {
        const coinGlassData = await this.coinGlassConnector.getOpenInterest(symbol).catch(() => null);
        if (coinGlassData?.openInterestChange24h !== undefined && coinGlassData.openInterestChange24h !== null) {
          const change = coinGlassData.openInterestChange24h * 100;
          openInterestStr = change > 0 ? `Increasing (+${change.toFixed(1)}%)` : `Decreasing (${change.toFixed(1)}%)`;
        }
      }
    } catch (err: any) {
      logger.debug({ err, symbol }, 'Open interest fetch failed');
    }
    
    // 8. Liquidations
    let liquidationsStr = 'N/A';
    try {
      if (this.coinGlassConnector) {
        const coinGlassData = await this.coinGlassConnector.getLiquidations(symbol).catch(() => null);
        if (coinGlassData) {
          const longLiq = coinGlassData.longLiquidation24h || 0;
          const shortLiq = coinGlassData.shortLiquidation24h || 0;
          if (longLiq > 0 || shortLiq > 0) {
            const total = longLiq + shortLiq;
            const longPct = (longLiq / total) * 100;
            liquidationsStr = `Long: ${longPct.toFixed(1)}% | Short: ${(100 - longPct).toFixed(1)}%`;
          }
        }
      }
    } catch (err: any) {
      logger.debug({ err, symbol }, 'Liquidation data fetch failed');
    }
    
    // 9. Trend Strength
    let trendStrengthStr = 'Weak';
    if (trendAnalysis) {
      const emaDiff = trendAnalysis.ema12 && trendAnalysis.ema26 
        ? Math.abs(trendAnalysis.ema12 - trendAnalysis.ema26) / trendAnalysis.ema26 * 100
        : 0;
      if (emaDiff > 2) trendStrengthStr = 'Strong';
      else if (emaDiff > 0.5) trendStrengthStr = 'Medium';
    }
    
    // 10. Volatility Score
    const volatility = this.computeVolatility(symbol, 20);
    const volatilityScore = volatility > 0.05 ? 'High' : volatility > 0.02 ? 'Medium' : 'Low';
    
    // 11. News Sentiment
    let newsSentimentStr = 'Neutral';
    try {
      if (uid) {
        const integrations: Record<string, { apiKey: string; secretKey?: string }> = await firestoreAdapter.getEnabledIntegrations(uid).catch(() => ({}));
        const lc = integrations.lunarcrush ?? { apiKey: "" };
        if (lc && lc.apiKey) {
          const apiKey = lc.apiKey;
          if (apiKey && typeof apiKey === 'string' && apiKey.trim().length >= 20) {
            const { LunarCrushAdapter } = await import('./lunarcrushAdapter');
            const lunarcrushAdapter = new LunarCrushAdapter(apiKey);
            const sentimentData = await lunarcrushAdapter.getCoinData(symbol).catch(() => null);
            if (sentimentData?.sentiment !== undefined) {
              const sentiment = sentimentData.sentiment;
              if (sentiment > 0.3) newsSentimentStr = 'Bullish';
              else if (sentiment < -0.3) newsSentimentStr = 'Bearish';
            }
          }
        }
      }
    } catch (err: any) {
      logger.debug({ err, symbol }, 'News sentiment fetch failed');
    }
    
    return {
      rsi: rsiValue,
      macd: macdData,
      volume: volumeAnalysis,
      orderbookImbalance: orderbookImbalanceStr,
      fundingRate: fundingRateStr,
      openInterest: openInterestStr,
      liquidations: liquidationsStr,
      trendStrength: trendStrengthStr,
      volatility: volatilityScore,
      newsSentiment: newsSentimentStr,
    };
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
    const contributions: Record<string, number> = { base: 0.5 };

    // 1. Orderbook imbalance strength (Exchange data if available)
    const imbalanceStrength = Math.abs(imbalance);
    if (imbalanceStrength > 0.3) {
      accuracy += 0.15;
      contributions.imbalance = 0.15;
      logger.debug({ symbol, imbalanceStrength, contribution: 0.15 }, 'Orderbook imbalance contribution: +15%');
    } else if (imbalanceStrength > 0.15) {
      accuracy += 0.1;
      contributions.imbalance = 0.1;
      logger.debug({ symbol, imbalanceStrength, contribution: 0.1 }, 'Orderbook imbalance contribution: +10%');
    } else if (imbalanceStrength > 0.05) {
      accuracy += 0.05;
      contributions.imbalance = 0.05;
      logger.debug({ symbol, imbalanceStrength, contribution: 0.05 }, 'Orderbook imbalance contribution: +5%');
    } else {
      contributions.imbalance = 0;
      logger.debug({ symbol, imbalanceStrength }, 'Orderbook imbalance too weak, no contribution');
    }

    // 2. Spread analysis (tighter spread = higher confidence)
    // CRITICAL: Check if spread is actually calculated (not 0 due to missing data)
    if (microSignals.spread > 0 && microSignals.spread < 0.05) {
      accuracy += 0.15; // Very tight spread
      contributions.spread = 0.15;
      logger.debug({ symbol, spread: microSignals.spread, contribution: 0.15 }, 'Spread contribution: +15%');
    } else if (microSignals.spread > 0 && microSignals.spread < 0.1) {
      accuracy += 0.1;
      contributions.spread = 0.1;
      logger.debug({ symbol, spread: microSignals.spread, contribution: 0.1 }, 'Spread contribution: +10%');
    } else if (microSignals.spread > 0 && microSignals.spread < 0.2) {
      accuracy += 0.05;
      contributions.spread = 0.05;
      logger.debug({ symbol, spread: microSignals.spread, contribution: 0.05 }, 'Spread contribution: +5%');
    } else {
      contributions.spread = 0;
      if (microSignals.spread === 0) {
        logger.warn({ symbol }, 'Spread is ZERO - orderbook data may be missing or invalid');
      } else {
        logger.debug({ symbol, spread: microSignals.spread }, 'Spread too wide, no contribution');
      }
    }

    // 3. Volume depth analysis
    // CRITICAL: Check if volume is actually calculated (not 0 due to missing data)
    if (microSignals.volume > 500000) {
      accuracy += 0.15; // Very high volume
      contributions.volume = 0.15;
      logger.debug({ symbol, volume: microSignals.volume, contribution: 0.15 }, 'Volume contribution: +15%');
    } else if (microSignals.volume > 100000) {
      accuracy += 0.1;
      contributions.volume = 0.1;
      logger.debug({ symbol, volume: microSignals.volume, contribution: 0.1 }, 'Volume contribution: +10%');
    } else if (microSignals.volume > 50000) {
      accuracy += 0.05;
      contributions.volume = 0.05;
      logger.debug({ symbol, volume: microSignals.volume, contribution: 0.05 }, 'Volume contribution: +5%');
    } else {
      contributions.volume = 0;
      if (microSignals.volume === 0) {
        logger.warn({ symbol }, 'Volume is ZERO - orderbook data may be missing or invalid');
      } else {
        logger.debug({ symbol, volume: microSignals.volume }, 'Volume too low, no contribution');
      }
    }

    // 4. Orderbook depth analysis
    // CRITICAL: Check if depth is actually calculated (not 0 due to missing data)
    if (microSignals.orderbookDepth > 1000000) {
      accuracy += 0.1;
      contributions.depth = 0.1;
      logger.debug({ symbol, depth: microSignals.orderbookDepth, contribution: 0.1 }, 'Orderbook depth contribution: +10%');
    } else if (microSignals.orderbookDepth > 500000) {
      accuracy += 0.05;
      contributions.depth = 0.05;
      logger.debug({ symbol, depth: microSignals.orderbookDepth, contribution: 0.05 }, 'Orderbook depth contribution: +5%');
    } else {
      contributions.depth = 0;
      if (microSignals.orderbookDepth === 0) {
        logger.warn({ symbol }, 'Orderbook depth is ZERO - orderbook data may be missing or invalid');
      } else {
        logger.debug({ symbol, depth: microSignals.orderbookDepth }, 'Orderbook depth too low, no contribution');
      }
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
        
        // ALWAYS attempt to call CryptoQuant if API key is available
        const cq = integrations.cryptoquant ?? { apiKey: "" };
        if (cq && cq.apiKey) {
          try {
            // Validate API key before creating adapter
            const apiKey = cq.apiKey;
            if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 20) {
              logger.warn({ symbol, apiKeyLength: apiKey?.length || 0 }, 'CryptoQuant API key too short or invalid, skipping');
              // Skip CryptoQuant entirely if key is invalid
            } else {
              try {
                const cryptoquantAdapter = new CryptoQuantAdapter(apiKey);
                
                // ALWAYS attempt to call if adapter is not disabled
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
                  
                  logger.debug({ symbol }, 'CryptoQuant data successfully fetched and integrated');
                } else {
                  logger.debug({ symbol }, 'CryptoQuant adapter is disabled, skipping');
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
        } else {
          logger.debug({ symbol }, 'CryptoQuant integration not configured, skipping');
        }

        // ALWAYS attempt to call LunarCrush if API key is available
        const lc = integrations.lunarcrush ?? { apiKey: "" };
        if (lc && lc.apiKey) {
          try {
            const apiKey = lc.apiKey;
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
                
                logger.debug({ symbol }, 'LunarCrush data successfully fetched and integrated');
              } catch (adapterErr: any) {
                logger.debug({ err: adapterErr, symbol }, 'LunarCrush fetch error (non-critical)');
              }
            }
          } catch (err: any) {
            logger.debug({ err, symbol }, 'LunarCrush error (non-critical, skipping)');
          }
        } else {
          logger.debug({ symbol }, 'LunarCrush integration not configured, skipping');
        }

        // ALWAYS attempt to call CoinAPI if any sub-type is available
        // Check for all CoinAPI sub-types
        const coinapiMarket = integrations['coinapi_market'];
        const coinapiFlatfile = integrations['coinapi_flatfile'];
        const coinapiExchangerate = integrations['coinapi_exchangerate'];
        
        if (coinapiMarket || coinapiFlatfile || coinapiExchangerate) {
          logger.debug({ symbol, hasMarket: !!coinapiMarket, hasFlatfile: !!coinapiFlatfile, hasExchangerate: !!coinapiExchangerate }, 
            'CoinAPI integration(s) found, attempting to fetch data');
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
    const finalAccuracy = Math.min(0.95, Math.max(0.1, accuracy));
    
    // DIAGNOSTIC: Log full breakdown
    const contributionSummary = Object.entries(contributions)
      .filter(([k, v]) => k !== 'base' && v > 0)
      .map(([k, v]) => `${k}:+${Math.round(v * 100)}%`)
      .join(', ') || 'NONE';
    
    logger.info({ 
      symbol, 
      finalAccuracy: Math.round(finalAccuracy * 100), 
      baseAccuracy: 0.5,
      contributions,
      totalContributions: finalAccuracy - 0.5,
      microSignals: {
        spread: microSignals.spread,
        volume: microSignals.volume,
        depth: microSignals.orderbookDepth,
        momentum: microSignals.priceMomentum
      },
      imbalance
    }, `[ACCURACY] Breakdown: base 50% + ${contributionSummary} = ${Math.round(finalAccuracy * 100)}%`);
    
    return finalAccuracy;
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

  /**
   * Generate comprehensive explanations from all available indicators
   */
  private async generateExplanations(
    symbol: string,
    currentPrice: number,
    imbalance: number,
    microSignals: ResearchResult['microSignals'],
    signal: 'BUY' | 'SELL' | 'HOLD',
    accuracy: number,
    adapter?: ExchangeConnector,
    uid?: string,
    apiCalls?: string[]
  ): Promise<string[]> {
    const explanations: string[] = [];

    // 1. RSI Analysis (simplified - would need historical price data for full RSI)
    if (currentPrice > 0) {
      const history = this.orderbookHistory.get(symbol);
      if (history && history.length >= 14) {
        try {
          // Calculate simple RSI from price momentum
          const prices = history.slice(-14).map(ob => {
            const bid = parseFloat(ob.bids[0]?.price || '0');
            const ask = parseFloat(ob.asks[0]?.price || '0');
            return (bid + ask) / 2;
          }).filter(p => p > 0);

          if (prices.length >= 14) {
            const gains: number[] = [];
            const losses: number[] = [];
            for (let i = 1; i < prices.length; i++) {
              const change = prices[i] - prices[i - 1];
              if (change > 0) gains.push(change);
              else losses.push(Math.abs(change));
            }
            
            const avgGain = gains.reduce((a, b) => a + b, 0) / 14;
            const avgLoss = losses.reduce((a, b) => a + b, 0) / 14;
            
            if (avgLoss > 0) {
              const rs = avgGain / avgLoss;
              const rsi = 100 - (100 / (1 + rs));
              
              if (rsi < 30) {
                explanations.push(`RSI(14) oversold at ${rsi.toFixed(1)} → long bias`);
              } else if (rsi > 70) {
                explanations.push(`RSI(14) overbought at ${rsi.toFixed(1)} → short bias`);
              } else if (rsi > 50) {
                explanations.push(`RSI(14) at ${rsi.toFixed(1)} → bullish momentum`);
              } else {
                explanations.push(`RSI(14) at ${rsi.toFixed(1)} → bearish momentum`);
              }
            }
          }
        } catch (rsiErr: any) {
          logger.debug({ err: rsiErr, symbol }, 'RSI calculation failed');
        }
      }
    }

    // 2. MACD Crossover Detection (simplified - using EMA-like calculation)
    if (currentPrice > 0) {
      const history = this.orderbookHistory.get(symbol);
      if (history && history.length >= 26) {
        try {
          const prices = history.slice(-26).map(ob => {
            const bid = parseFloat(ob.bids[0]?.price || '0');
            const ask = parseFloat(ob.asks[0]?.price || '0');
            return (bid + ask) / 2;
          }).filter(p => p > 0);

          if (prices.length >= 26) {
            // Simple EMA12 and EMA26
            let ema12 = prices.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
            let ema26 = prices.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
            
            const multiplier12 = 2 / (12 + 1);
            const multiplier26 = 2 / (26 + 1);
            
            for (let i = 12; i < prices.length; i++) {
              ema12 = (prices[i] * multiplier12) + (ema12 * (1 - multiplier12));
            }
            for (let i = 26; i < prices.length; i++) {
              ema26 = (prices[i] * multiplier26) + (ema26 * (1 - multiplier26));
            }
            
            const macd = ema12 - ema26;
            const prevEma12 = prices.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
            const prevEma26 = prices.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
            const prevMacd = prevEma12 - prevEma26;
            
            if (macd > 0 && prevMacd <= 0) {
              explanations.push('MACD bullish crossover detected');
            } else if (macd < 0 && prevMacd >= 0) {
              explanations.push('MACD bearish crossover detected');
            } else if (macd > 0) {
              explanations.push(`MACD positive at ${macd.toFixed(4)} → bullish trend`);
            } else {
              explanations.push(`MACD negative at ${macd.toFixed(4)} → bearish trend`);
            }
          }
        } catch (macdErr: any) {
          logger.debug({ err: macdErr, symbol }, 'MACD calculation failed');
        }
      }
    }

    // 3. Orderbook Imbalance
    if (imbalance !== 0) {
      const imbalancePct = Math.abs(imbalance * 100);
      if (imbalance > 0) {
        explanations.push(`Buy-side orderbook imbalance ${imbalancePct.toFixed(1)}%`);
      } else {
        explanations.push(`Sell-side orderbook imbalance ${imbalancePct.toFixed(1)}%`);
      }
    }

    // 4. Volume Spike or Drop
    if (microSignals.volume > 0) {
      const volumeHistory = this.volumeHistory.get(symbol) || [];
      if (volumeHistory.length > 0) {
        const avgVolume = volumeHistory.reduce((a, b) => a + b, 0) / volumeHistory.length;
        const volumeChange = ((microSignals.volume - avgVolume) / avgVolume) * 100;
        
        if (volumeChange > 50) {
          explanations.push(`Volume spike ${volumeChange.toFixed(1)}% above average → increased activity`);
        } else if (volumeChange < -50) {
          explanations.push(`Volume drop ${Math.abs(volumeChange).toFixed(1)}% below average → decreased activity`);
        } else if (volumeChange > 20) {
          explanations.push(`Volume increased ${volumeChange.toFixed(1)}% → moderate activity`);
        }
      }
    }

    // 5. Funding Rate & Open Interest (if available from CoinGlass)
    if (this.coinGlassConnector) {
      try {
        const coinGlassData = await this.coinGlassConnector.getFundingRate(symbol).catch(() => null);
        if (coinGlassData) {
          // Funding Rate
          if (coinGlassData.fundingRate !== undefined && coinGlassData.fundingRate !== null) {
            const fundingRate = coinGlassData.fundingRate;
            if (fundingRate < 0) {
              explanations.push(`Negative funding rate ${(fundingRate * 100).toFixed(4)}% supports long`);
            } else if (fundingRate > 0.01) {
              explanations.push(`High positive funding rate ${(fundingRate * 100).toFixed(4)}% supports short`);
            } else if (fundingRate > 0) {
              explanations.push(`Positive funding rate ${(fundingRate * 100).toFixed(4)}% → moderate long bias`);
            }
          }
          
          // Open Interest Change
          if (coinGlassData.openInterestChange24h !== undefined && coinGlassData.openInterestChange24h !== null) {
            const changePct = coinGlassData.openInterestChange24h * 100;
            if (changePct > 5) {
              explanations.push(`Open Interest increased ${changePct.toFixed(1)}% → strong bullish momentum`);
            } else if (changePct < -5) {
              explanations.push(`Open Interest decreased ${Math.abs(changePct).toFixed(1)}% → liquidation pressure`);
            } else if (changePct > 2) {
              explanations.push(`Open Interest increased ${changePct.toFixed(1)}% → moderate accumulation`);
            }
          }
        }
      } catch (coinGlassErr: any) {
        logger.debug({ err: coinGlassErr, symbol }, 'CoinGlass data fetch failed');
      }
    }

    // 7. Whale Activity (from CryptoQuant)
    if (uid) {
      try {
        const integrations: Record<string, { apiKey: string; secretKey?: string }> = await firestoreAdapter.getEnabledIntegrations(uid).catch(() => ({}));
        const cq = integrations.cryptoquant ?? { apiKey: "" };
        if (cq && cq.apiKey) {
          try {
            const apiKey = cq.apiKey;
            if (apiKey && typeof apiKey === 'string' && apiKey.trim().length >= 20) {
              const cryptoquantAdapter = new CryptoQuantAdapter(apiKey);
              if (!cryptoquantAdapter.disabled) {
                const onChainData = await cryptoquantAdapter.getOnChainMetrics(symbol).catch(() => null);
                if (onChainData && onChainData.whaleTransactions) {
                  if (onChainData.whaleTransactions > 20) {
                    explanations.push(`Whale accumulation detected (${onChainData.whaleTransactions} large transactions)`);
                  } else if (onChainData.whaleTransactions > 10) {
                    explanations.push(`Moderate whale activity (${onChainData.whaleTransactions} large transactions)`);
                  }
                }
              }
            }
          } catch (whaleErr: any) {
            logger.debug({ err: whaleErr, symbol }, 'Whale activity fetch failed');
          }
        }
      } catch (whaleErr: any) {
        logger.debug({ err: whaleErr, symbol }, 'Whale activity check failed');
      }
    }

    // 8. Exchange Inflow/Outflow (from CryptoQuant)
    if (uid) {
      try {
        const integrations: Record<string, { apiKey: string; secretKey?: string }> = await firestoreAdapter.getEnabledIntegrations(uid).catch(() => ({}));
        const cq = integrations.cryptoquant ?? { apiKey: "" };
        if (cq && cq.apiKey) {
          try {
            const apiKey = cq.apiKey;
            if (apiKey && typeof apiKey === 'string' && apiKey.trim().length >= 20) {
              const cryptoquantAdapter = new CryptoQuantAdapter(apiKey);
              if (!cryptoquantAdapter.disabled) {
                const flowData = await cryptoquantAdapter.getExchangeFlow(symbol).catch(() => null);
                if (flowData && flowData.exchangeFlow !== undefined) {
                  const flowPct = flowData.exchangeFlow * 100;
                  if (flowPct > 0.1) {
                    explanations.push(`Exchange inflow ${flowPct.toFixed(2)}% → accumulation phase`);
                  } else if (flowPct < -0.1) {
                    explanations.push(`Exchange outflow ${Math.abs(flowPct).toFixed(2)}% → distribution phase`);
                  }
                }
              }
            }
          } catch (flowErr: any) {
            logger.debug({ err: flowErr, symbol }, 'Exchange flow fetch failed');
          }
        }
      } catch (flowErr: any) {
        logger.debug({ err: flowErr, symbol }, 'Exchange flow check failed');
      }
    }

    // 9. News & Social Sentiment (from LunarCrush)
    if (uid) {
      try {
        const integrations: Record<string, { apiKey: string; secretKey?: string }> = await firestoreAdapter.getEnabledIntegrations(uid).catch(() => ({}));
        const lc = integrations.lunarcrush ?? { apiKey: "" };
        if (lc && lc.apiKey) {
          try {
            const apiKey = lc.apiKey;
            if (apiKey && typeof apiKey === 'string' && apiKey.trim().length >= 20) {
              const lunarcrushAdapter = new LunarCrushAdapter(apiKey);
              const sentimentData = await lunarcrushAdapter.getCoinData(symbol).catch(() => null);
              if (sentimentData) {
                if (sentimentData.sentiment !== undefined) {
                  const sentimentPct = sentimentData.sentiment * 100;
                  if (sentimentPct > 5) {
                    explanations.push(`News sentiment +${sentimentPct.toFixed(1)}% (bullish)`);
                  } else if (sentimentPct < -5) {
                    explanations.push(`News sentiment ${sentimentPct.toFixed(1)}% (bearish)`);
                  }
                }
                if (sentimentData.bullishSentiment !== undefined) {
                  const bullishPct = sentimentData.bullishSentiment * 100;
                  if (bullishPct > 60) {
                    explanations.push(`Social sentiment ${bullishPct.toFixed(0)}% bullish → strong community support`);
                  }
                }
              }
            }
          } catch (sentimentErr: any) {
            logger.debug({ err: sentimentErr, symbol }, 'Sentiment fetch failed');
          }
        }
      } catch (sentimentErr: any) {
        logger.debug({ err: sentimentErr, symbol }, 'Sentiment check failed');
      }
    }

    // 10. Trend Strength (ADX/EMA slope)
    if (currentPrice > 0 && microSignals.priceMomentum !== 0) {
      const momentumPct = microSignals.priceMomentum * 100;
      if (momentumPct > 1) {
        explanations.push(`Strong uptrend detected (${momentumPct.toFixed(2)}% momentum)`);
      } else if (momentumPct < -1) {
        explanations.push(`Strong downtrend detected (${momentumPct.toFixed(2)}% momentum)`);
      } else if (momentumPct > 0.5) {
        explanations.push(`Moderate uptrend (${momentumPct.toFixed(2)}% momentum)`);
      } else if (momentumPct < -0.5) {
        explanations.push(`Moderate downtrend (${momentumPct.toFixed(2)}% momentum)`);
      }
    }

    // 11. Pattern Match (simplified - detect basic patterns)
    if (currentPrice > 0) {
      const history = this.orderbookHistory.get(symbol);
      if (history && history.length >= 5) {
        try {
          const prices = history.slice(-5).map(ob => {
            const bid = parseFloat(ob.bids[0]?.price || '0');
            const ask = parseFloat(ob.asks[0]?.price || '0');
            return (bid + ask) / 2;
          }).filter(p => p > 0);

          if (prices.length >= 5) {
            // Detect ascending/descending pattern
            const isAscending = prices.every((p, i) => i === 0 || p >= prices[i - 1]);
            const isDescending = prices.every((p, i) => i === 0 || p <= prices[i - 1]);
            
            if (isAscending && prices[prices.length - 1] > prices[0] * 1.01) {
              explanations.push('Ascending price pattern detected → bullish formation');
            } else if (isDescending && prices[prices.length - 1] < prices[0] * 0.99) {
              explanations.push('Descending price pattern detected → bearish formation');
            }
          }
        } catch (patternErr: any) {
          logger.debug({ err: patternErr, symbol }, 'Pattern detection failed');
        }
      }
    }

    // 12. Market Conditions
    if (imbalance > 0.15) {
      explanations.push('Bullish pressure detected → buyers dominating orderbook');
    } else if (imbalance < -0.15) {
      explanations.push('Bearish pressure detected → sellers dominating orderbook');
    }
    
    if (accuracy >= 0.8) {
      explanations.push(`High confidence signal (${(accuracy * 100).toFixed(0)}%) → strong market alignment`);
    } else if (accuracy < 0.6) {
      explanations.push(`Low confidence signal (${(accuracy * 100).toFixed(0)}%) → wait for better conditions`);
    }

    // Return explanations (limit to 12 max for UI)
    return explanations.slice(0, 12);
  }
}

export const researchEngine = new ResearchEngine();

