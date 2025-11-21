import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { CryptoQuantAdapter } from './cryptoquantAdapter';
import { LunarCrushAdapter } from './lunarcrushAdapter';
import { CoinAPIAdapter } from './coinapiAdapter';
import * as path from 'path';
import * as fs from 'fs';

// DEBUG: Log file path at module load time
const absolutePath = path.resolve(__dirname || process.cwd(), 'researchEngine.ts');
const filePath = path.join(__dirname || process.cwd(), 'researchEngine.ts');
console.log('🔍 [RESEARCH_ENGINE] ========================================');
console.log('🔍 [RESEARCH_ENGINE] ResearchEngine Module Loading');
console.log('🔍 [RESEARCH_ENGINE] File Path:', filePath);
console.log('🔍 [RESEARCH_ENGINE] Absolute Path:', absolutePath);
console.log('🔍 [RESEARCH_ENGINE] __dirname:', __dirname);
console.log('🔍 [RESEARCH_ENGINE] process.cwd():', process.cwd());
console.log('🔍 [RESEARCH_ENGINE] File exists check:', fs.existsSync(filePath));
console.log('🔍 [RESEARCH_ENGINE] ========================================');
logger.info({ 
  filePath, 
  absolutePath, 
  __dirname, 
  cwd: process.cwd(),
  fileExists: fs.existsSync(filePath)
}, '[RESEARCH_ENGINE] Module loaded - file path verification');
import { apiUsageTracker } from './apiUsageTracker';
import { featureEngine } from './featureEngine';
import { mlModelService } from './ml/mlModelService';
import { IntoTheBlockConnector } from './dataConnectors/intotheblockConnector';
import { NewsApiConnector } from './dataConnectors/newsApiConnector';
import { loadFeatureConfig, type FeatureConfig } from '../config/featureConfig';
import { analyzeFundingRate, analyzeOpenInterest, analyzeLiquidations, type FundingRateData, type OpenInterestData, type LiquidationsData } from './strategies/fundingOiStrategy';
import { analyzeSentiment, type SentimentData } from './strategies/sentimentStrategy';
import { fetchDerivativesData, analyzeDerivatives } from './strategies/derivativesStrategy';
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
    rsi: number | null;
    rsiSignal: string | null;
    macd: { signal: number; histogram: number; trend: string } | null;
    volume: string | null;
    orderbookImbalance: string | null;
    liquidity: string;
    fundingRate: string;
    openInterest: string;
    liquidations: string;
    trendStrength: string | null;
    volatility: string | null;
    newsSentiment: string;
    onChainFlows?: string;
    priceDivergence?: string;
    _volumeNumber?: number | null;
    _atrValue?: number | null;
    _orderbookImbalanceValue?: number | null;
    _trendStrengthValue?: { ema20: number | null; ema50: number | null; trend: string } | null;
    _apisUsed?: string[];
  };
  // New fields for accuracy-based response
  indicators?: {
    rsi?: number | null;
    macd?: { signal: number; histogram: number; trend: string } | null;
    volume?: number | null; // Actual numerical volume from candle data
    trendStrength?: { ema20?: number | null; ema50?: number | null; ema12?: number | null; ema26?: number | null; trend: string } | null;
    volatility?: number | null; // ATR-based volatility (ATR14 value)
    orderbook?: number | null; // Orderbook imbalance percentage (buyVolume vs sellVolume %)
  };
  entrySignal?: 'LONG' | 'SHORT' | null;
  exitSignal?: number[] | null;
  entryPrice?: number | null;
  recommendation?: 'AUTO' | 'MANUAL' | null;
  // Weighted scoring diagnostics
  perFeatureScore?: Record<string, number>; // Contribution of each feature to confidence
  apisUsed?: string[]; // List of APIs used in this research
  rawConfidence?: number; // Confidence before smoothing
  smoothedConfidence?: number; // Confidence after smoothing
  confluenceFlags?: Record<string, boolean>; // Confluence check results
  volumeConfirmed?: boolean; // Whether volume confirmation passed
  derivativesContradict?: boolean; // Whether derivatives contradict price
}

export class ResearchEngine {
  private recentTrades: Map<string, Trade[]> = new Map();
  private orderbookHistory: Map<string, Orderbook[]> = new Map();
  private spreadHistory: Map<string, number[]> = new Map();
  private volumeHistory: Map<string, number[]> = new Map();
  private depthHistory: Map<string, number[]> = new Map();
  private imbalanceHistory: Map<string, number[]> = new Map();
  
  // ML Model connectors (optional - only if API keys provided)
  private intoTheBlockConnector?: IntoTheBlockConnector;
  private newsApiConnector?: NewsApiConnector;
  
  // Feature configuration and confidence smoothing
  private featureConfig: FeatureConfig;
  private confidenceHistory: Map<string, number[]> = new Map(); // symbol -> confidence history
  
  constructor() {
    // Load feature configuration
    this.featureConfig = loadFeatureConfig();
    
    // Initialize connectors if API keys are available
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
        console.log(`🔍 [DEBUG] [ORDERBOOK] Calling adapter.getOrderbook(${symbol}, 20) from ${exchange}`);
        const orderbook = await adapter.getOrderbook(symbol, 20);
        
        // DEBUG: Log raw result of getOrderbook
        console.log(`🔍 [DEBUG] [ORDERBOOK] getOrderbook response from ${exchange}:`, orderbook ? 'received' : 'null/undefined');
        if (orderbook) {
          console.log(`🔍 [DEBUG] [ORDERBOOK] Top 5 bids:`, JSON.stringify(orderbook.bids?.slice(0, 5) || [], null, 2));
          console.log(`🔍 [DEBUG] [ORDERBOOK] Top 5 asks:`, JSON.stringify(orderbook.asks?.slice(0, 5) || [], null, 2));
          console.log(`🔍 [DEBUG] [ORDERBOOK] Total bids: ${orderbook.bids?.length || 0}, Total asks: ${orderbook.asks?.length || 0}`);
          
          // Calculate buyVolume/sellVolume before aggregation
          const buyVolume = (orderbook.bids || []).reduce((sum, bid) => sum + parseFloat(bid.quantity || '0'), 0);
          const sellVolume = (orderbook.asks || []).reduce((sum, ask) => sum + parseFloat(ask.quantity || '0'), 0);
          console.log(`🔍 [DEBUG] [ORDERBOOK] buyVolume from ${exchange}: ${buyVolume}, sellVolume: ${sellVolume}`);
        } else {
          console.log(`🔍 [DEBUG] [ORDERBOOK] getOrderbook returned null/undefined from ${exchange}`);
        }
        
        if (!orderbook || !orderbook.bids || !orderbook.asks || orderbook.bids.length === 0 || orderbook.asks.length === 0) {
          console.log(`🔍 [DEBUG] [ORDERBOOK] Empty or invalid orderbook from ${exchange} - skipping`);
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

  /**
   * Normalize timeframe for exchange API calls
   * Most exchanges use standard formats: 1m, 5m, 15m, 30m, 1h, 4h, 1d, etc.
   */
  private normalizeTimeframe(timeframe: string, exchange?: ExchangeConnector): string {
    // Standard timeframe formats (works for Binance, Bitget, Bybit, etc.)
    const validTimeframes = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
    const normalized = timeframe.toLowerCase().trim();
    
    if (validTimeframes.includes(normalized)) {
      return normalized;
    }
    
    // Default to 5m if invalid
    console.log(`🔍 [DEBUG] [TIMEFRAME] Invalid timeframe "${timeframe}", defaulting to "5m"`);
    return '5m';
  }

  async runResearch(
    symbol: string, 
    uid: string, 
    adapter?: ExchangeConnector, 
    forceEngine: boolean = false,
    allExchanges?: Array<{ exchange: string; adapter: ExchangeConnector; credentials: any }>,
    timeframe: string = '5m' // Accept timeframe from frontend, default to 5m
  ): Promise<ResearchResult> {
    // Normalize timeframe before use
    const normalizedTimeframe = this.normalizeTimeframe(timeframe, adapter);
    if (normalizedTimeframe !== timeframe) {
      console.log(`🔍 [DEBUG] [TIMEFRAME] Timeframe normalized: "${timeframe}" -> "${normalizedTimeframe}"`);
      timeframe = normalizedTimeframe;
    }
    // DEBUG: Log function entry with file verification
    const exchangeName = adapter?.getExchangeName ? adapter.getExchangeName() : 'No Exchange';
    console.log('🔍 [RESEARCH_ENGINE] ========================================');
    console.log('🔍 [RESEARCH_ENGINE] runResearch() CALLED');
    console.log('🔍 [RESEARCH_ENGINE] File: researchEngine.ts');
    console.log('🔍 [RESEARCH_ENGINE] Symbol:', symbol);
    console.log('🔍 [RESEARCH_ENGINE] Timeframe:', timeframe);
    console.log('🔍 [RESEARCH_ENGINE] Exchange:', exchangeName);
    console.log('🔍 [RESEARCH_ENGINE] Exchange Count:', allExchanges?.length || 0);
    console.log('🔍 [RESEARCH_ENGINE] UID:', uid);
    console.log('🔍 [RESEARCH_ENGINE] ========================================');
    
    // Track all API calls
    const apiCalls: string[] = [];
    
    logger.info({ 
      symbol, 
      timeframe,
      uid, 
      hasAdapter: !!adapter, 
      exchange: exchangeName,
      exchangeCount: allExchanges?.length || 0, 
      forceEngine,
      filePath: absolutePath
    }, '[RESEARCH_ENGINE] Starting research engine - route entry');
    
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
      
      // Calculate base accuracy (will be improved with features later)
      // Using weighted scoring system - will recalculate with features
      let accuracy = 0.5; // Default base accuracy (will be replaced with weighted confidence)

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

        // Accuracy-based rules:
        // - If accuracy > 60%: show entrySignal, exitSignal, entryPrice, stopLoss, takeProfit
        // - If accuracy < 60%: hide entry and exit completely
        // - If accuracy >= 75%: add recommendation = "AUTO"
        const accuracyPercentForSignals = Math.round(accuracy * 100);
        const shouldGenerateSignals = (accuracyPercentForSignals > 60 && currentPrice > 0);
        
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
          } else if (accuracyPercentForSignals <= 60) {
            message = 'Accuracy below or equal to 60% - entry and exit signals hidden. Wait for better market conditions.';
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

      // Updated accuracy-based rules:
      // - If accuracy < 60%: hide entry and exit completely
      // - If accuracy >= 60%: show entry/exit signals
      // - If accuracy >= 75%: add recommendation = "AUTO"
      if (accuracyPercent < 60) {
        mode = 'LOW';
        // Hide entry/sl/tp/exits/signals completely if accuracy < 60%
        entry = null;
        exits = [];
        stopLoss = null;
        takeProfit = null;
        signals = [];
        finalRecommendedTrade = null;
        finalMessage = 'Accuracy below 60% — Entry and exit signals hidden';
      } else if (accuracyPercent >= 60 && accuracyPercent < 75) {
        mode = 'NORMAL';
        blurFields = false;
        // Entry/exit signals are already set above (accuracy > 60%)
        finalRecommendedTrade = null;
      } else if (accuracyPercent >= 75) {
        mode = 'TRADE_SETUP';
        blurFields = false;
        // Entry/exit signals are already set above, and recommendation = "AUTO" will be set in response
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
      
      // Calculate Feature Breakdown with real API data (after RSI and trend are calculated)
      // Pass timeframe to calculateFeatures
      const primaryAdapter = exchangesToUse.length > 0 ? exchangesToUse[0].adapter : adapter;
      
      // STEP 1 - VERIFY DATA FETCH (MANDATORY DEBUG)
      // Normalize symbol for exchange (most exchanges use uppercase)
      const normalizedSymbol = symbol.toUpperCase();
      if (normalizedSymbol !== symbol) {
        console.log(`🔍 [DEBUG] [STEP 1] Symbol normalized: "${symbol}" -> "${normalizedSymbol}"`);
      }
      
      console.log('==================================================');
      console.log('🔍 [DEBUG] [STEP 1] REQUEST RECEIVED');
      console.log('🔍 [DEBUG] [STEP 1] Original Symbol:', symbol);
      console.log('🔍 [DEBUG] [STEP 1] Normalized Symbol:', normalizedSymbol);
      console.log('🔍 [DEBUG] [STEP 1] Timeframe:', timeframe);
      console.log('🔍 [DEBUG] [STEP 1] Adapter name:', primaryAdapter?.getExchangeName ? primaryAdapter.getExchangeName() : 'No adapter');
      console.log('🔍 [DEBUG] [STEP 1] Final timeframe string passed to adapter.getKlines():', timeframe);
      console.log('🔍 [DEBUG] [STEP 1] Has adapter:', !!primaryAdapter);
      console.log('🔍 [DEBUG] [STEP 1] Has getKlines function:', !!(primaryAdapter && typeof primaryAdapter.getKlines === 'function'));
      console.log('🔍 [DEBUG] [STEP 1] Current price:', currentPrice);
      console.log('🔍 [DEBUG] [STEP 1] Has aggregated orderbook:', !!aggregatedOrderbook);
      console.log('==================================================');
      
      const features = await this.calculateFeatures(
        normalizedSymbol, // Use normalized symbol
        rsi14 ?? null,
        trendAnalysis,
        microSignals,
        imbalance,
        currentPrice,
        uid,
        primaryAdapter,
        allExchanges,
        aggregatedOrderbook,
        timeframe // Pass timeframe parameter
      );
      
      // Calculate weighted confidence using features - NO STATIC FALLBACK
      let rawConfidence = 0; // Start at 0, will be calculated from real indicators
      let perFeatureScore: Record<string, number> = {};
      let apisUsed: string[] = [];
      let confluenceFlags: Record<string, boolean> = {};
      let volumeConfirmed = false;
      let derivativesContradict = false;
      try {
        const primaryAdapter = exchangesToUse.length > 0 ? exchangesToUse[0].adapter : adapter;
        const weightedResult = await this.calculateWeightedConfidence(
          symbol,
          imbalance,
          microSignals,
          features,
          uid,
          apiCalls,
          primaryAdapter,
          exchangesToUse.map(e => ({ exchange: e.exchange, adapter: e.adapter, credentials: {} }))
        );
        rawConfidence = weightedResult.rawConfidence;
        perFeatureScore = weightedResult.perFeatureScore;
        apisUsed = weightedResult.apisUsed;
        // Merge APIs from calculateFeatures
        const featureApis = (features as any)?._apisUsed ?? [];
        apisUsed = [...new Set([...apisUsed, ...featureApis])]; // Merge and deduplicate
        confluenceFlags = weightedResult.confluenceFlags;
        volumeConfirmed = weightedResult.volumeConfirmed;
        derivativesContradict = weightedResult.derivativesContradict;
        
        // Ensure accuracy is in valid range (40-90%)
        rawConfidence = Math.max(40, Math.min(90, rawConfidence));
        
        // Apply confidence smoothing
        const smoothedConfidence = this.applyConfidenceSmoothing(symbol, rawConfidence);
        
        // Ensure smoothed confidence is also in valid range
        const finalConfidence = Math.max(40, Math.min(90, smoothedConfidence));
        
        // Convert to accuracy (0-1) for backward compatibility
        accuracy = finalConfidence / 100;
        confidence = finalConfidence;
        
        logger.info({ 
          symbol, 
          rawConfidence, 
          smoothedConfidence: finalConfidence,
          perFeatureScore,
          apisUsed,
          hasConfluence: confluenceFlags.hasConfluence,
          volumeConfirmed,
          derivativesContradict
        }, '[CONFIDENCE] Weighted confidence calculated');
      } catch (err: any) {
        logger.warn({ err: err.message, symbol }, '[CONFIDENCE] Weighted confidence calculation failed');
        // If calculation fails, use minimum valid accuracy (40%) instead of 50%
        accuracy = 0.40;
        confidence = 40;
      }
      
      // Apply confidence adjustments
      // 1. Check for insufficient data (reuse status check from above)
      if (status !== 'ok') {
        confidence = Math.max(0, confidence - this.featureConfig.confidence.insufficientDataPenalty);
        logger.warn({ symbol, confidence, status }, '[CONFIDENCE] Reduced due to insufficient data');
      }
      
      // 2. Volume confirmation check
      if (this.featureConfig.volume.requireVolumeConfirmation && !volumeConfirmed && features?.volume !== 'Stable') {
        confidence = Math.max(0, confidence - 10); // Penalty for unconfirmed volume
        logger.warn({ symbol, confidence }, '[CONFIDENCE] Reduced due to volume not confirmed (RVOL < threshold)');
      }
      
      // 3. Derivatives contradiction penalty (already applied in calculateWeightedConfidence)
      if (derivativesContradict) {
        logger.warn({ symbol, confidence }, '[CONFIDENCE] Derivatives contradict price signal');
      }
      
      // 4. Liquidity guard
      if (microSignals.spread > this.featureConfig.liquidity.maxSpreadPercent) {
        confidence = Math.max(0, confidence - 15); // Penalty for low liquidity
        logger.warn({ symbol, spread: microSignals.spread, confidence }, '[CONFIDENCE] Reduced due to low liquidity (spread too wide)');
      }
      
      // 5. Check for flash events (price moved > X% within Y seconds)
      const priceHistory = this.orderbookHistory.get(symbol);
      if (priceHistory && priceHistory.length >= 2) {
        const recent = priceHistory.slice(-2);
        const prevMid = (parseFloat(recent[0].bids[0]?.price || '0') + parseFloat(recent[0].asks[0]?.price || '0')) / 2;
        const currentMid = (parseFloat(recent[1].bids[0]?.price || '0') + parseFloat(recent[1].asks[0]?.price || '0')) / 2;
        if (prevMid > 0) {
          const priceMove = Math.abs((currentMid - prevMid) / prevMid) * 100;
          if (priceMove > this.featureConfig.confidence.flashEventThreshold) {
            confidence = Math.max(0, confidence - this.featureConfig.confidence.flashEventPenalty);
            logger.warn({ symbol, priceMove, confidence }, '[CONFIDENCE] Reduced due to flash event (large price move)');
          }
        }
      }
      
      // Update accuracy from smoothed confidence
      accuracy = confidence / 100;
      const accuracyPercentFinal = Math.round(accuracy * 100);
      
      // DEBUG: Log after accuracy calculation
      logger.info({ symbol, accuracy, accuracyPercent, confidence }, '[RESEARCH] After accuracy calculation');
      console.log(`[RESEARCH] Accuracy calculated: ${accuracyPercent}%`);
      
      // Build indicators object - ALL indicators MUST be present, even if accuracy < 50%
      // Extract data from features (including internal _ fields)
      const volumeNumber = (features as any)?._volumeNumber ?? null;
      const atrValue = (features as any)?._atrValue ?? null;
      const orderbookImbalanceValue = (features as any)?._orderbookImbalanceValue ?? null;
      const trendStrengthValue = (features as any)?._trendStrengthValue ?? null;
      
      // DEBUG: Log extracted values before building indicators
      console.log(`🔍 [DEBUG] [INDICATORS] Extracted from features:`);
      console.log(`🔍 [DEBUG] [INDICATORS]   rsi14: ${rsi14}, features.rsi: ${features?.rsi}`);
      console.log(`🔍 [DEBUG] [INDICATORS]   features.macd:`, features?.macd);
      console.log(`🔍 [DEBUG] [INDICATORS]   volumeNumber: ${volumeNumber}`);
      console.log(`🔍 [DEBUG] [INDICATORS]   atrValue: ${atrValue}`);
      console.log(`🔍 [DEBUG] [INDICATORS]   orderbookImbalanceValue: ${orderbookImbalanceValue}`);
      console.log(`🔍 [DEBUG] [INDICATORS]   trendStrengthValue:`, trendStrengthValue);
      console.log(`🔍 [DEBUG] [INDICATORS]   trendAnalysis:`, trendAnalysis);
      
      // RSI(14) - use rsi14 if available, otherwise use features.rsi (NO fallback to 50)
      const rsi14Value = rsi14 ?? (features?.rsi !== null && features?.rsi !== undefined ? features.rsi : null);
      
      // MACD - use features.macd if available (NO fallback to {0, 0, 'Neutral'})
      const macdData = features?.macd !== null && features?.macd !== undefined ? {
        signal: features.macd.signal,
        histogram: features.macd.histogram,
        trend: features.macd.trend
      } : null;
      
      // Volume - actual numerical volume from candle data
      const volumeIndicator = volumeNumber !== null ? volumeNumber : null;
      
      // Trend Strength - EMA20/EMA50 (prefer trendStrengthValue from features, fallback to trendAnalysis)
      const trendStrengthIndicator = trendStrengthValue ? {
        ema20: trendStrengthValue.ema20,
        ema50: trendStrengthValue.ema50,
        trend: trendStrengthValue.trend
      } : (trendAnalysis ? {
        ema12: trendAnalysis.ema12,
        ema26: trendAnalysis.ema26,
        trend: trendAnalysis.trend
      } : null);
      
      // ATR-based Volatility - use ATR value from features
      const volatilityIndicator = atrValue !== null ? atrValue : null;
      
      // Orderbook Imbalance - buyVolume vs sellVolume percentage
      const orderbookIndicator = orderbookImbalanceValue !== null ? orderbookImbalanceValue : null;
      
      // DEBUG: Log final indicator values - EXTRACTED LOGS FORMAT
      console.log('═══════════════════════════════════════════════════════════');
      console.log('📊 [EXTRACTED LOGS] 6) FINAL INDICATORS');
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`RSI: ${rsi14Value !== null ? rsi14Value : 'null'} ${rsi14Value === 50 ? '❌ FALLBACK!' : rsi14Value !== null ? '✅' : '(no data)'}`);
      if (macdData) {
        console.log(`MACD: signal=${macdData.signal}, histogram=${macdData.histogram}, trend=${macdData.trend} ${macdData.signal === 0 && macdData.histogram === 0 ? '❌ FALLBACK!' : '✅'}`);
      } else {
        console.log(`MACD: null (no data)`);
      }
      console.log(`Volume: ${volumeIndicator !== null ? volumeIndicator : 'null'} ${volumeIndicator === null && features?.volume === 'Stable' ? '❌ FALLBACK!' : volumeIndicator !== null ? '✅' : '(no data)'}`);
      if (trendStrengthIndicator) {
        console.log(`Trend Strength: ${JSON.stringify(trendStrengthIndicator)} ✅`);
      } else {
        console.log(`Trend Strength: null (no data)`);
      }
      console.log(`Volatility: ${volatilityIndicator !== null ? volatilityIndicator : 'null'} ${volatilityIndicator === 'Low' ? '❌ FALLBACK!' : volatilityIndicator !== null ? '✅' : '(no data)'}`);
      console.log(`Orderbook: ${orderbookIndicator !== null ? orderbookIndicator + '%' : 'null'} ${orderbookIndicator === 0 ? '⚠️  (verify if real)' : orderbookIndicator !== null ? '✅' : '(no data)'}`);
      console.log('═══════════════════════════════════════════════════════════');
      console.log('');
      
      // CRITICAL: Verify no fallback values are present
      if (rsi14Value === 50) {
        console.error('❌ [ERROR] RSI has fallback value 50 - this should not happen!');
      }
      if (macdData && macdData.signal === 0 && macdData.histogram === 0) {
        console.error('❌ [ERROR] MACD has fallback values 0/0 - this should not happen!');
      }
      if (volumeIndicator === null && features?.volume === 'Stable') {
        console.error('❌ [ERROR] Volume has fallback value "Stable" - this should not happen!');
      }
      
      // Build indicators object - ALL indicators MUST always be present
      const indicators = {
        rsi: rsi14Value, // RSI(14) - always present (may be null)
        macd: macdData, // MACD (signal, histogram) - always present (may be null)
        volume: volumeIndicator, // Actual numerical volume from candle data - always present (may be null)
        trendStrength: trendStrengthIndicator, // Trend Strength (EMA20/EMA50 or EMA12/EMA26) - always present (may be null)
        volatility: volatilityIndicator, // ATR-based Volatility (ATR14) - always present (may be null)
        orderbook: orderbookIndicator, // Orderbook Imbalance (buyVolume vs sellVolume %) - always present (may be null)
      };
      
      // Accuracy-based entry/exit signals
      let entrySignal: 'LONG' | 'SHORT' | null = null;
      let exitSignal: number[] | null = null;
      let entryPrice: number | null = null;
      let recommendation: 'AUTO' | 'MANUAL' | null = null;
      
      if (accuracyPercentFinal >= 60) {
        // Show entry/exit signals if accuracy > 60%
        entrySignal = side === 'LONG' ? 'LONG' : side === 'SHORT' ? 'SHORT' : null;
        exitSignal = exits.length > 0 ? exits : null;
        entryPrice = entry;
        
        // Add AUTO recommendation if accuracy >= 75%
        if (accuracyPercentFinal >= 75) {
          recommendation = 'AUTO';
        } else {
          recommendation = 'MANUAL';
        }
      } else {
        // Hide entry/exit completely if accuracy <= 60%
        entrySignal = null;
        exitSignal = null;
        entryPrice = null;
        recommendation = null;
      }
      
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
        perFeatureScore: perFeatureScore,
        apisUsed: apisUsed,
        rawConfidence: rawConfidence,
        smoothedConfidence: confidence,
        confluenceFlags: confluenceFlags,
        volumeConfirmed: volumeConfirmed,
        derivativesContradict: derivativesContradict,
        // New accuracy-based fields
        indicators: indicators,
        entrySignal: entrySignal,
        exitSignal: exitSignal,
        entryPrice: entryPrice,
        recommendation: recommendation,
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
      
      // DEBUG: Log before returning final result
      console.log('🔍 [RESEARCH_ENGINE] ========================================');
      console.log('🔍 [RESEARCH_ENGINE] PREPARING FINAL RESULT');
      console.log('🔍 [RESEARCH_ENGINE] File: researchEngine.ts');
      console.log('🔍 [RESEARCH_ENGINE] Symbol:', result.symbol);
      console.log('🔍 [RESEARCH_ENGINE] Accuracy:', result.accuracy, `(${Math.round(result.accuracy * 100)}%)`);
      console.log('🔍 [RESEARCH_ENGINE] Indicators:', {
        rsi: result.indicators?.rsi,
        macd: result.indicators?.macd ? 'Present' : 'Null',
        volume: result.indicators?.volume,
        trendStrength: result.indicators?.trendStrength ? 'Present' : 'Null',
        volatility: result.indicators?.volatility,
        orderbook: result.indicators?.orderbook
      });
      console.log('🔍 [RESEARCH_ENGINE] Signals:', {
        entrySignal: result.entrySignal,
        exitSignal: result.exitSignal,
        entryPrice: result.entryPrice,
        stopLoss: result.stopLoss,
        takeProfit: result.takeProfit,
        recommendation: result.recommendation
      });
      console.log('🔍 [RESEARCH_ENGINE] APIs Used:', result.apisUsed);
      console.log('🔍 [RESEARCH_ENGINE] APIs Count:', result.apisUsed?.length || 0);
      console.log('🔍 [RESEARCH_ENGINE] ========================================');
      
      logger.info({ 
        symbol, 
        accuracy, 
        mode, 
        hasEntry: entry !== null,
        signalsCount: signals.length,
        apiCallsCount: finalApiCalls.length,
        forceEngine,
        indicators: result.indicators,
        apisUsed: result.apisUsed
      }, '[RESEARCH_ENGINE] Research result generated - final output');

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

      logger.info({ symbol, signal, accuracy, hasAdapter: !!adapter }, '[RESEARCH_ENGINE] Research completed');
      
      // DEBUG: Log before returning
      console.log('🔍 [RESEARCH_ENGINE] ========================================');
      console.log('🔍 [RESEARCH_ENGINE] RETURNING RESULT');
      console.log('🔍 [RESEARCH_ENGINE] File: researchEngine.ts');
      console.log('🔍 [RESEARCH_ENGINE] Result keys:', Object.keys(result || {}));
      console.log('🔍 [RESEARCH_ENGINE] ========================================');
      
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
   * Calculate Feature Breakdown for UI display using REAL API data
   * 
   * API-TO-STRATEGY MAPPING:
   * ========================
   * 1. RSI Strategy:
   *    - Data Source: OHLCV candles
   *    - Primary: Exchange API (Binance/Bitget) → getKlines()
   *    - Fallback 1: CoinAPI Market → getHistoricalOHLCV()
   *    - Fallback 2: CoinAPI Flatfile → getHistoricalOHLCV()
   *    - Strategy: rsiStrategy.analyzeRSI()
   * 
   * 2. MACD Strategy:
   *    - Data Source: OHLCV candles (min 26 periods)
   *    - Primary: Exchange API → getKlines()
   *    - Fallback: CoinAPI (Market/Flatfile) → getHistoricalOHLCV()
   *    - Strategy: macdStrategy.analyzeMACD()
   * 
   * 3. Volume Strategy:
   *    - Data Source: OHLCV candles with volume
   *    - Primary: Exchange API → getKlines()
   *    - Fallback: Internal volume history (microSignals.volume)
   *    - Strategy: volumeStrategy.analyzeVolume()
   *    - Output: RVOL (Relative Volume), Volume signal
   * 
   * 4. Orderbook Imbalance Strategy:
   *    - Data Source: L2 Orderbook snapshot
   *    - Primary: Exchange API (Binance/Bitget) → getOrderbook()
   *    - Fallback: Aggregated orderbook from allExchanges
   *    - Strategy: orderBookImbalanceStrategy.analyzeOrderBook()
   *    - Output: Imbalance %, Buy/Sell pressure
   * 
   * 5. Liquidity Strategy:
   *    - Data Source: L2 Orderbook snapshot
   *    - Primary: Exchange API → getOrderbook()
   *    - Fallback: microSignals.spread
   *    - Strategy: liquidityStrategy.analyzeLiquidity()
   *    - Output: Spread %, Depth, Liquidity score
   * 
   * 6. Derivatives Strategy (Funding Rate, Open Interest, Liquidations):
   *    - Data Source: Futures market data
   *    - Primary: Exchange API (Binance/Bitget Futures) → getFundingRate(), getOpenInterest(), getLiquidations()
   *    - Supplement: CryptoQuant → getExchangeFlow() (for aggregated metrics)
   *    - Strategy: derivativesStrategy.fetchDerivativesData() + analyzeDerivatives()
   *    - Output: Funding rate signal, OI change, Liquidation ratios
   * 
   * 7. Sentiment Strategy:
   *    - Data Source: Social media & news
   *    - Primary: LunarCrush → getSentiment() / getCoinData()
   *    - Fallback: Neutral (if API unavailable)
   *    - Strategy: sentimentStrategy.analyzeSentiment()
   *    - Output: Sentiment score (-1 to +1), Bullish/Bearish/Neutral
   * 
   * 8. On-Chain Flows:
   *    - Data Source: Blockchain analytics
   *    - Primary: CryptoQuant → getExchangeFlow(), getReserves()
   *    - Fallback: N/A (marked as unavailable)
   *    - Output: Exchange inflow/outflow, Reserve changes
   * 
   * 9. Price Divergence:
   *    - Data Source: Multi-exchange price comparison
   *    - Primary: CoinAPI Market → getMarketData() (cross-exchange median)
   *    - Fallback: Compare prices from allExchanges
   *    - Output: Price deviation %, Consistency score
   * 
   * 10. Trend Analysis (EMA):
   *    - Data Source: Internal orderbook history (26+ snapshots)
   *    - Strategy: Internal EMA calculation
   *    - Output: EMA12, EMA26, Trend direction
   * 
   * 11. Volatility (ATR):
   *    - Data Source: Internal orderbook history (20+ snapshots)
   *    - Strategy: Internal ATR calculation
   *    - Output: Volatility score (High/Medium/Low)
   */
  private async calculateFeatures(
    symbol: string,
    rsi14: number | null,
    trendAnalysis: { ema12: number | null; ema26: number | null; trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' } | null,
    microSignals: ResearchResult['microSignals'],
    imbalance: number,
    currentPrice: number,
    uid?: string,
    adapter?: ExchangeConnector,
    allExchanges?: Array<{ exchange: string; adapter: ExchangeConnector; credentials: any }>,
    aggregatedOrderbook?: Orderbook | null,
    timeframe: string = '5m' // Add timeframe parameter
  ): Promise<ResearchResult['features']> {
    // STEP 3 - DEBUG: Log function entry with all parameters
    console.log('==================================================');
    console.log('🔍 [DEBUG] [STEP 3] FEATURE ENGINE START');
    console.log('🔍 [DEBUG] [STEP 3] calculateFeatures() called');
    console.log('🔍 [DEBUG] [STEP 3]   symbol:', symbol);
    console.log('🔍 [DEBUG] [STEP 3]   timeframe:', timeframe);
    console.log('🔍 [DEBUG] [STEP 3]   currentPrice:', currentPrice);
    console.log('🔍 [DEBUG] [STEP 3]   hasAdapter:', !!adapter);
    console.log('🔍 [DEBUG] [STEP 3]   adapter.getKlines:', adapter && typeof adapter.getKlines === 'function' ? 'available' : 'not available');
    console.log('🔍 [DEBUG] [STEP 3]   hasAggregatedOrderbook:', !!aggregatedOrderbook);
    console.log('🔍 [DEBUG] [STEP 3]   rsi14:', rsi14);
    console.log('🔍 [DEBUG] [STEP 3]   trendAnalysis:', trendAnalysis);
    console.log('==================================================');
    
    const { featureEngine } = await import('./featureEngine');
    const featureApisUsed: string[] = []; // Track APIs used in this function
    
    // 1. RSI - Use strategy module with proper signal classification
    // NO FALLBACK VALUES - only calculate from real candle data
    let rsiValue: number | null = null;
    let rsiSignal: string | null = null;
    try {
      const rsiStrategy = await import('./strategies/rsiStrategy');
      const { analyzeRSI } = rsiStrategy;
      interface CandleData {
        close: number;
        high?: number;
        low?: number;
        open?: number;
        volume?: number;
        timestamp?: number;
      }
      let candles: CandleData[] = [];
      
      // Try to get OHLCV from exchange first - MINIMUM 100 CANDLES
      if (adapter && typeof adapter.getKlines === 'function') {
        try {
          const exchangeName = adapter.getExchangeName ? adapter.getExchangeName() : 'Exchange';
          featureApisUsed.push(exchangeName);
          console.log(`🔍 [DEBUG] [RSI] Calling adapter.getKlines(${symbol}, ${timeframe}, 100) from ${exchangeName}`);
          const klines = await adapter.getKlines(symbol, timeframe, 100);
          
          // DEBUG: Log raw result of getKlines - EXTRACTED LOGS FORMAT
          console.log('═══════════════════════════════════════════════════════════');
          console.log('📊 [EXTRACTED LOGS] 1) getKlines CANDLE COUNT');
          console.log('═══════════════════════════════════════════════════════════');
          console.log(`Candle Count: ${klines?.length || 0}`);
          console.log('');
          
          if (klines && klines.length > 0) {
            console.log('═══════════════════════════════════════════════════════════');
            console.log('📊 [EXTRACTED LOGS] 2) FIRST 3 & LAST 3 CANDLES');
            console.log('═══════════════════════════════════════════════════════════');
            console.log('First 3 candles:');
            console.log(JSON.stringify(klines.slice(0, 3), null, 2));
            console.log('');
            console.log('Last 3 candles:');
            console.log(JSON.stringify(klines.slice(-3), null, 2));
            console.log('');
          } else {
            console.log(`⚠️  getKlines returned empty or null`);
            console.log('');
          }
          
          if (klines && klines.length >= 14) {
            candles = klines.map((k: any) => ({
              close: parseFloat(k[4] || k.close || 0),
              high: parseFloat(k[2] || k.high || k[4] || k.close || 0),
              low: parseFloat(k[3] || k.low || k[4] || k.close || 0),
              open: parseFloat(k[1] || k.open || k[4] || k.close || 0),
              volume: parseFloat(k[5] || k.volume || 0),
            })).filter((c: CandleData) => c.close > 0);
            
            // STEP 3 - DEBUG: Log parsed candles before RSI calculation - EXTRACTED LOGS FORMAT
            if (candles.length > 0) {
              const closeValues = candles.map(c => c.close);
              const highValues = candles.map(c => c.high);
              const lowValues = candles.map(c => c.low);
              const volumeValues = candles.map(c => c.volume);
              
              console.log('═══════════════════════════════════════════════════════════');
              console.log('📊 [EXTRACTED LOGS] 3) PARSED ARRAYS LENGTHS');
              console.log('═══════════════════════════════════════════════════════════');
              console.log(`close[] length: ${closeValues.length}`);
              console.log(`high[] length: ${highValues.length}`);
              console.log(`low[] length: ${lowValues.length}`);
              console.log(`volume[] length: ${volumeValues.length}`);
              console.log('');
            } else {
              console.log('⚠️  candles array is EMPTY after parsing');
              console.log('');
            }
            
            // STEP 4 - DEBUG: Log RSI candle count - EXTRACTED LOGS FORMAT
            console.log('═══════════════════════════════════════════════════════════');
            console.log('📊 [EXTRACTED LOGS] 4) INDICATOR CANDLE COUNTS');
            console.log('═══════════════════════════════════════════════════════════');
            console.log(`RSI Candle Count: ${candles.length}`);
            
            if (candles.length >= 14) {
              console.log(`🔍 [DEBUG] [RSI] Calculating RSI... (have ${candles.length} candles, need 14)`);
              const rsiResult = analyzeRSI(candles, 14);
              rsiValue = rsiResult.value;
              rsiSignal = rsiResult.signal;
              console.log(`🔍 [DEBUG] [RSI] RSI calculation result: value=${rsiValue}, signal=${rsiSignal}`);
              logger.info({ symbol, rsiValue, rsiSignal, source: 'exchange' }, '[FEATURES] RSI calculated from exchange OHLCV');
            } else {
              console.log(`🔍 [DEBUG] [RSI] Not enough candles for RSI: have ${candles.length}, need 14`);
              logger.warn({ symbol, candlesLength: candles.length }, '[FEATURES] Not enough candles for RSI from exchange (need 14)');
            }
          } else {
            console.log(`🔍 [DEBUG] [RSI] getKlines returned insufficient data: length=${klines?.length || 0}, need 14`);
          }
        } catch (err: any) {
          console.log(`🔍 [DEBUG] [RSI] API error: ${err.message}`);
          console.log(`🔍 [DEBUG] [RSI] API error stack:`, err.stack);
          logger.debug({ err: err.message, symbol }, '[FEATURES] Exchange OHLCV fetch failed, trying CoinAPI');
        }
      } else {
        console.log(`🔍 [DEBUG] [RSI] No adapter or getKlines function not available`);
      }
      
      // Try CoinAPI if exchange fails - NO FALLBACK VALUES
      if (candles.length < 14 && uid) {
        try {
          const integrations: Record<string, { apiKey: string; secretKey?: string }> = await firestoreAdapter.getEnabledIntegrations(uid).catch(() => ({}));
          // Try flatfile first (historical), then market API
          const coinapiFlatfile = integrations.coinapi_flatfile ?? { apiKey: "" };
          const coinapiMarket = integrations.coinapi_market ?? { apiKey: "" };
          
          if (coinapiFlatfile?.apiKey && typeof coinapiFlatfile.apiKey === 'string' && coinapiFlatfile.apiKey.trim().length >= 20) {
            featureApisUsed.push('CoinAPI Flatfile');
            const flatfileAdapter = new CoinAPIAdapter(coinapiFlatfile.apiKey, 'flatfile');
            const historicalOHLCV = await flatfileAdapter.getHistoricalOHLCV(symbol, '1H', 100).catch(() => []);
            if (historicalOHLCV && historicalOHLCV.length >= 14) {
              candles = historicalOHLCV.map((d) => ({
                close: d.close || 0,
                high: d.high || d.close || 0,
                low: d.low || d.close || 0,
                open: d.open || d.close || 0,
                volume: d.volume || 0,
              })).filter((c: CandleData) => c.close > 0);
              
              if (candles.length >= 14) {
                const rsiResult = analyzeRSI(candles, 14);
                rsiValue = rsiResult.value;
                rsiSignal = rsiResult.signal;
                logger.info({ symbol, rsiValue, rsiSignal, source: 'coinapi_flatfile' }, '[FEATURES] RSI calculated from CoinAPI Flatfile OHLCV');
              }
            }
          }
          
          // Try market API if flatfile didn't work
          if (candles.length < 14 && coinapiMarket?.apiKey && typeof coinapiMarket.apiKey === 'string' && coinapiMarket.apiKey.trim().length >= 20) {
            featureApisUsed.push('CoinAPI Market');
            const marketAdapter = new CoinAPIAdapter(coinapiMarket.apiKey, 'market');
            const historicalOHLCV = await marketAdapter.getHistoricalOHLCV(symbol, '1H', 100).catch(() => []);
            if (historicalOHLCV && historicalOHLCV.length >= 14) {
              candles = historicalOHLCV.map((d) => ({
                close: d.close || 0,
                high: d.high || d.close || 0,
                low: d.low || d.close || 0,
                open: d.open || d.close || 0,
                volume: d.volume || 0,
              })).filter((c: CandleData) => c.close > 0);
              
              if (candles.length >= 14) {
                const rsiResult = analyzeRSI(candles, 14);
                rsiValue = rsiResult.value;
                rsiSignal = rsiResult.signal;
                logger.info({ symbol, rsiValue, rsiSignal, source: 'coinapi_market' }, '[FEATURES] RSI calculated from CoinAPI Market OHLCV');
              }
            }
          }
        } catch (err: any) {
          logger.debug({ err: err.message, symbol }, '[FEATURES] CoinAPI OHLCV fetch failed');
        }
      }
      
      // If still no RSI value, log warning but don't use fallback
      if (rsiValue === null) {
        logger.warn({ symbol }, '[FEATURES] RSI could not be calculated - no sufficient candle data available');
      }
    } catch (err: any) {
      logger.warn({ err: err.message, symbol }, '[FEATURES] RSI calculation failed - no fallback value used');
    }
    
    // 2. MACD - Use strategy module with proper signal classification
    // NO FALLBACK VALUES - only calculate from real candle data
    let macdData: { signal: number; histogram: number; trend: string } | null = null;
    try {
      const macdStrategy = await import('./strategies/macdStrategy');
      const { analyzeMACD } = macdStrategy;
      interface CandleData {
        close: number;
        high?: number;
        low?: number;
        open?: number;
        volume?: number;
        timestamp?: number;
      }
      let candles: CandleData[] = [];
      
      // Try exchange first - MINIMUM 100 CANDLES
      if (adapter && typeof adapter.getKlines === 'function') {
        try {
          console.log(`🔍 [DEBUG] [MACD] Calling adapter.getKlines(${symbol}, ${timeframe}, 100)`);
          const klines = await adapter.getKlines(symbol, timeframe, 100);
          
          // DEBUG: Log raw result of getKlines
          console.log(`🔍 [DEBUG] [MACD] getKlines response length: ${klines?.length || 0}`);
          if (klines && klines.length > 0) {
            console.log(`🔍 [DEBUG] [MACD] First 3 candles:`, JSON.stringify(klines.slice(0, 3), null, 2));
            console.log(`🔍 [DEBUG] [MACD] Last 3 candles:`, JSON.stringify(klines.slice(-3), null, 2));
          } else {
            console.log(`🔍 [DEBUG] [MACD] getKlines returned empty or null`);
          }
          
          if (klines && klines.length >= 26) {
            candles = klines.map((k: any) => ({
              close: parseFloat(k[4] || k.close || 0),
              high: parseFloat(k[2] || k.high || k[4] || k.close || 0),
              low: parseFloat(k[3] || k.low || k[4] || k.close || 0),
              open: parseFloat(k[1] || k.open || k[4] || k.close || 0),
              volume: parseFloat(k[5] || k.volume || 0),
            })).filter((c: CandleData) => c.close > 0);
            
            // DEBUG: Log parsed candles before MACD calculation
            console.log(`🔍 [DEBUG] [MACD] Parsed candles array length: ${candles.length}`);
            if (candles.length > 0) {
              const closeValues = candles.map(c => c.close);
              console.log(`🔍 [DEBUG] [MACD] close[] length: ${closeValues.length}, empty: ${closeValues.length === 0}, undefined check: ${closeValues.some(v => v === undefined)}`);
            } else {
              console.log(`🔍 [DEBUG] [MACD] candles array is EMPTY after parsing`);
            }
            
            logger.debug({ symbol, candlesCount: candles.length, source: 'exchange' }, '[FEATURES] Fetching MACD from exchange');
          } else {
            console.log(`🔍 [DEBUG] [MACD] getKlines returned insufficient data: length=${klines?.length || 0}, need 26`);
          }
        } catch (err: any) {
          console.log(`🔍 [DEBUG] [MACD] API error: ${err.message}`);
          console.log(`🔍 [DEBUG] [MACD] API error stack:`, err.stack);
          logger.debug({ err: err.message, symbol }, '[FEATURES] Exchange klines failed for MACD');
        }
      } else {
        console.log(`🔍 [DEBUG] [MACD] No adapter or getKlines function not available`);
      }
      
      // Fallback to CoinAPI
      if (candles.length < 26 && uid) {
        try {
          const integrations: Record<string, { apiKey: string; secretKey?: string }> = await firestoreAdapter.getEnabledIntegrations(uid).catch(() => ({}));
          const coinapiFlatfile = integrations.coinapi_flatfile ?? { apiKey: "" };
          const coinapiMarket = integrations.coinapi_market ?? { apiKey: "" };
          
          if (coinapiFlatfile?.apiKey && typeof coinapiFlatfile.apiKey === 'string' && coinapiFlatfile.apiKey.trim().length >= 20) {
            const flatfileAdapter = new CoinAPIAdapter(coinapiFlatfile.apiKey, 'flatfile');
            const historicalOHLCV = await flatfileAdapter.getHistoricalOHLCV(symbol, '1H', 100).catch(() => []);
            if (historicalOHLCV && historicalOHLCV.length >= 26) {
              candles = historicalOHLCV.map((d) => ({
                close: d.close || 0,
                high: d.high || d.close || 0,
                low: d.low || d.close || 0,
                open: d.open || d.close || 0,
                volume: d.volume || 0,
              })).filter((c: CandleData) => c.close > 0);
              
              logger.debug({ symbol, candlesCount: candles.length, source: 'coinapi' }, '[FEATURES] Fetching MACD from CoinAPI');
            }
          }
        } catch (err: any) {
          logger.debug({ err: err.message, symbol }, '[FEATURES] CoinAPI historical data failed for MACD');
        }
      }
      
      // STEP 5 - DEBUG: Log MACD candle count - EXTRACTED LOGS FORMAT
      console.log(`MACD Candle Count: ${candles.length}`);
      
      // Calculate MACD using strategy module if we have enough data - NO FALLBACK
      if (candles.length >= 26) {
        console.log(`🔍 [DEBUG] [MACD] Calculating MACD... (have ${candles.length} candles, need 26)`);
        try {
          const macdResult = analyzeMACD(candles, 12, 26, 9);
          macdData = {
            signal: macdResult.signal,
            histogram: macdResult.histogram,
            trend: macdResult.trend,
          };
          console.log(`🔍 [DEBUG] [MACD] MACD calculation result: signal=${macdData.signal}, histogram=${macdData.histogram}, trend=${macdData.trend}`);
          logger.info({ symbol, macdTrend: macdResult.trend, signal: macdResult.signal, histogram: macdResult.histogram }, '[FEATURES] MACD calculated');
        } catch (macdErr: any) {
          console.log(`🔍 [DEBUG] [MACD] MACD calculation exception: ${macdErr.message}`);
          console.log(`🔍 [DEBUG] [MACD] MACD calculation stack:`, macdErr.stack);
          logger.error({ err: macdErr.message, symbol }, '[FEATURES] MACD calculation exception - returning null');
          macdData = null; // Explicitly set to null on error
        }
      } else {
        console.log(`🔍 [DEBUG] [MACD] Not enough candles for MACD: have ${candles.length}, need 26`);
        logger.warn({ symbol, candlesCount: candles.length }, '[FEATURES] Not enough candles for MACD (need 26) - no fallback value used');
      }
    } catch (err: any) {
      logger.error({ err: err.message, stack: err.stack, symbol }, '[FEATURES] MACD calculation failed - no fallback value used');
    }
    
    // 3. Volume Analysis - Use strategy module with proper signal classification
    // NO FALLBACK VALUES - only calculate from real candle data
    let volumeAnalysis: string | null = null;
    let volumeNumber: number | null = null; // Store actual numerical volume for indicators
    try {
      const volumeStrategy = await import('./strategies/volumeStrategy');
      const { analyzeVolume } = volumeStrategy;
      interface CandleData {
        close: number;
        high?: number;
        low?: number;
        open?: number;
        volume?: number;
        timestamp?: number;
      }
      let candles: CandleData[] = [];
      
      // Try to get OHLCV from exchange first - MINIMUM 100 CANDLES
      if (adapter && typeof adapter.getKlines === 'function') {
        try {
          const exchangeName = adapter.getExchangeName ? adapter.getExchangeName() : 'Exchange';
          if (!featureApisUsed.includes(exchangeName)) {
            featureApisUsed.push(exchangeName);
          }
          console.log(`🔍 [DEBUG] [VOLUME] Calling adapter.getKlines(${symbol}, ${timeframe}, 100) from ${exchangeName}`);
          logger.info({ symbol, timeframe, exchange: exchangeName }, '[FEATURES] Fetching candles for Volume');
          const klines = await adapter.getKlines(symbol, timeframe, 100);
          
          // DEBUG: Log raw result of getKlines
          console.log(`🔍 [DEBUG] [VOLUME] getKlines response length: ${klines?.length || 0}`);
          if (klines && klines.length > 0) {
            console.log(`🔍 [DEBUG] [VOLUME] First 3 candles:`, JSON.stringify(klines.slice(0, 3), null, 2));
            console.log(`🔍 [DEBUG] [VOLUME] Last 3 candles:`, JSON.stringify(klines.slice(-3), null, 2));
          } else {
            console.log(`🔍 [DEBUG] [VOLUME] getKlines returned empty or null`);
          }
          logger.info({ symbol, timeframe, candlesCount: klines?.length || 0 }, '[FEATURES] After fetching candles for Volume');
          
          if (klines && klines.length >= 20) {
            candles = klines.map((k: any) => ({
              close: parseFloat(k[4] || k.close || 0),
              high: parseFloat(k[2] || k.high || k[4] || k.close || 0),
              low: parseFloat(k[3] || k.low || k[4] || k.close || 0),
              open: parseFloat(k[1] || k.open || k[4] || k.close || 0),
              volume: parseFloat(k[5] || k.volume || 0),
            })).filter((c: CandleData) => c.close > 0 && c.volume && c.volume > 0);
            
            // DEBUG: Log parsed candles before Volume calculation
            console.log(`🔍 [DEBUG] [VOLUME] Parsed candles array length: ${candles.length}`);
            if (candles.length > 0) {
              const volumeValues = candles.map(c => c.volume);
              console.log(`🔍 [DEBUG] [VOLUME] volume[] length: ${volumeValues.length}, empty: ${volumeValues.length === 0}, undefined check: ${volumeValues.some(v => v === undefined)}`);
              console.log(`🔍 [DEBUG] [VOLUME] First 3 volume values:`, volumeValues.slice(0, 3));
              console.log(`🔍 [DEBUG] [VOLUME] Last 3 volume values:`, volumeValues.slice(-3));
            } else {
              console.log(`🔍 [DEBUG] [VOLUME] candles array is EMPTY after parsing`);
            }
            
            if (candles.length >= 20) {
              console.log(`🔍 [DEBUG] [VOLUME] Calculating Volume... (have ${candles.length} candles, need 20)`);
              try {
                const volumeResult = analyzeVolume(candles, 20);
                volumeAnalysis = volumeResult.signal;
                
                // Calculate total volume from candles for indicators (actual numerical volume)
                volumeNumber = candles.reduce((sum, c) => sum + (c.volume || 0), 0);
                
                console.log(`🔍 [DEBUG] [VOLUME] Volume calculation result: signal=${volumeAnalysis}, volumeNumber=${volumeNumber}`);
                logger.info({ symbol, volumeSignal: volumeResult.signal, rvol: volumeResult.relativeVolume, totalVolume: volumeNumber, source: 'exchange' }, '[FEATURES] Volume analysis from exchange - REAL volume number calculated');
                console.log(`[FEATURES] Volume number from candles: ${volumeNumber}`);
              } catch (volErr: any) {
                console.log(`🔍 [DEBUG] [VOLUME] Volume calculation exception: ${volErr.message}`);
                console.log(`🔍 [DEBUG] [VOLUME] Volume calculation stack:`, volErr.stack);
                logger.error({ err: volErr.message, symbol }, '[FEATURES] Volume calculation exception - returning null');
                volumeAnalysis = null;
                volumeNumber = null;
              }
            } else {
              console.log(`🔍 [DEBUG] [VOLUME] Not enough candles for Volume: have ${candles.length}, need 20`);
            }
          } else {
            console.log(`🔍 [DEBUG] [VOLUME] getKlines returned insufficient data: length=${klines?.length || 0}, need 20`);
          }
        } catch (err: any) {
          console.log(`🔍 [DEBUG] [VOLUME] API error: ${err.message}`);
          console.log(`🔍 [DEBUG] [VOLUME] API error stack:`, err.stack);
          logger.warn({ err: err.message, symbol }, '[FEATURES] Exchange klines failed for volume analysis');
        }
      } else {
        console.log(`🔍 [DEBUG] [VOLUME] No adapter or getKlines function not available`);
      }
      
      // If still no volume analysis, log warning but don't use fallback
      if (volumeAnalysis === null) {
        logger.warn({ symbol, candlesLength: candles.length }, '[FEATURES] Volume analysis could not be calculated - no sufficient candle data available');
      }
    } catch (err: any) {
      logger.warn({ err: err.message, symbol }, '[FEATURES] Volume analysis failed - no fallback value used');
    }
    
    // 4. Orderbook Imbalance - Calculate using formula: (buyVolume - sellVolume) / (buyVolume + sellVolume) * 100
    // NO FALLBACK VALUES - only calculate from real orderbook data
    let orderbookImbalanceStr: string | null = null;
    let orderbookImbalanceValue: number | null = null;
    try {
      console.log(`🔍 [DEBUG] [ORDERBOOK] Calculating Orderbook Imbalance...`);
      // Use aggregated orderbook if available - NO FALLBACK
      if (aggregatedOrderbook) {
        const bids = aggregatedOrderbook.bids || [];
        const asks = aggregatedOrderbook.asks || [];
        
        // DEBUG: Log top 5 bids/asks - EXTRACTED LOGS FORMAT
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📊 [EXTRACTED LOGS] 5) ORDERBOOK TOP 5 BIDS/ASKS');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('Top 5 bids:');
        console.log(JSON.stringify(bids.slice(0, 5), null, 2));
        console.log('');
        console.log('Top 5 asks:');
        console.log(JSON.stringify(asks.slice(0, 5), null, 2));
        console.log('');
        
        // Calculate buy volume (bids) and sell volume (asks)
        const buyVolume = bids.reduce((sum, bid) => sum + parseFloat(bid.quantity || '0'), 0);
        const sellVolume = asks.reduce((sum, ask) => sum + parseFloat(ask.quantity || '0'), 0);
        
        // DEBUG: Log buyVolume/sellVolume before imbalance calculation
        console.log(`🔍 [DEBUG] [ORDERBOOK] buyVolume: ${buyVolume}, sellVolume: ${sellVolume}`);
        console.log(`🔍 [DEBUG] [ORDERBOOK] buyVolume + sellVolume: ${buyVolume + sellVolume}`);
        
        // Calculate imbalance using formula: (buyVolume - sellVolume) / (buyVolume + sellVolume) * 100
        if (buyVolume + sellVolume > 0) {
          orderbookImbalanceValue = ((buyVolume - sellVolume) / (buyVolume + sellVolume)) * 100;
          
          const direction = orderbookImbalanceValue > 0 ? 'Buy Pressure' : 'Sell Pressure';
          const signal = Math.abs(orderbookImbalanceValue) > 10 ? (orderbookImbalanceValue > 0 ? 'Bullish' : 'Bearish') : 'Neutral';
          orderbookImbalanceStr = `${signal} (${Math.abs(orderbookImbalanceValue).toFixed(1)}% ${direction})`;
          
          console.log(`🔍 [DEBUG] [ORDERBOOK] Orderbook imbalance calculation result: value=${orderbookImbalanceValue}, signal=${signal}`);
          logger.info({ symbol, buyVolume, sellVolume, imbalance: orderbookImbalanceValue, signal }, '[FEATURES] Orderbook imbalance calculated using formula');
        } else {
          console.log(`🔍 [DEBUG] [ORDERBOOK] Cannot calculate imbalance - no volume in orderbook (buyVolume + sellVolume = 0)`);
          logger.warn({ symbol }, '[FEATURES] Orderbook imbalance could not be calculated - no volume in orderbook');
        }
      } else {
        console.log(`🔍 [DEBUG] [ORDERBOOK] No aggregated orderbook data available`);
        logger.warn({ symbol }, '[FEATURES] Orderbook imbalance could not be calculated - no orderbook data available');
      }
    } catch (err: any) {
      console.log(`🔍 [DEBUG] [ORDERBOOK] Orderbook imbalance calculation exception: ${err.message}`);
      console.log(`🔍 [DEBUG] [ORDERBOOK] Orderbook imbalance calculation stack:`, err.stack);
      logger.warn({ err: err.message, symbol }, '[FEATURES] Orderbook imbalance calculation failed - no fallback value used');
      orderbookImbalanceValue = null; // Explicitly set to null on error
    }
    
    // 5. Liquidity Analysis - Use strategy module with proper signal classification
    let liquidityStr = 'Low';
    try {
      const liquidityStrategy = await import('./strategies/liquidityStrategy');
      const { analyzeLiquidity } = liquidityStrategy;
      
      // Use aggregated orderbook if available
      if (aggregatedOrderbook) {
        const liquidityResult = analyzeLiquidity(aggregatedOrderbook, 5);
        liquidityStr = `${liquidityResult.signal} (${liquidityResult.spreadPercent.toFixed(2)}% spread)`;
        logger.info({ symbol, signal: liquidityResult.signal, spreadPercent: liquidityResult.spreadPercent }, '[FEATURES] Liquidity calculated');
      } else {
        // Fallback: use microSignals spread if orderbook not available
        const spreadPercent = microSignals.spread || 0;
        if (spreadPercent < 0.15) {
          liquidityStr = `High (${spreadPercent.toFixed(2)}% spread)`;
        } else if (spreadPercent >= 0.15 && spreadPercent <= 0.4) {
          liquidityStr = `Medium (${spreadPercent.toFixed(2)}% spread)`;
        } else {
          liquidityStr = `Low (${spreadPercent.toFixed(2)}% spread)`;
        }
      }
    } catch (err: any) {
      logger.warn({ err: err.message, symbol }, '[FEATURES] Liquidity calculation failed');
      // Fallback
      const spreadPercent = microSignals.spread || 0;
      liquidityStr = spreadPercent < 0.15 ? 'High' : spreadPercent <= 0.4 ? 'Medium' : 'Low';
    }
    
    // 6. Derivatives (Funding Rate, Open Interest, Liquidations) - Use Exchange APIs (primary) + CryptoQuant (supplement)
    // API MAPPING: Exchange Futures API → derivativesStrategy → Funding/OI/Liquidations signals
    let fundingRateStr = 'N/A';
    let openInterestStr = 'N/A';
    let liquidationsStr = 'N/A';
    try {
      // Use derivativesStrategy to fetch and analyze
      const integrations: Record<string, { apiKey: string; secretKey?: string }> = uid 
        ? await firestoreAdapter.getEnabledIntegrations(uid).catch(() => ({}))
        : {};
      
      const cq = integrations.cryptoquant ?? { apiKey: "" };
      const cryptoquantAdapter = (cq?.apiKey && typeof cq.apiKey === 'string' && cq.apiKey.trim().length >= 20)
        ? new CryptoQuantAdapter(cq.apiKey)
        : undefined;
      
      // Fetch derivatives data using strategy
      const derivativesData = await fetchDerivativesData(symbol, adapter, cryptoquantAdapter);
      const derivativesResult = analyzeDerivatives(derivativesData);
      
      // Format for display
      if (derivativesResult.fundingRate.value !== 0) {
        const frPercent = derivativesResult.fundingRate.value * 100;
        fundingRateStr = frPercent > 0 
          ? `Positive (${frPercent.toFixed(4)}%)` 
          : `Negative (${frPercent.toFixed(4)}%)`;
        logger.info({ symbol, fundingRate: frPercent, source: derivativesData.source }, '[FEATURES] Funding rate from derivatives strategy');
      }
      
      if (derivativesResult.openInterest.change24h !== 0) {
        const change = derivativesResult.openInterest.change24h * 100;
        openInterestStr = change > 0 
          ? `Increasing (+${change.toFixed(1)}%)` 
          : `Decreasing (${change.toFixed(1)}%)`;
        logger.info({ symbol, openInterestChange: change, source: derivativesData.source }, '[FEATURES] Open interest from derivatives strategy');
      }
      
      if (derivativesResult.liquidations && (derivativesResult.liquidations as any).totalLiquidation24h > 0) {
        liquidationsStr = `Long: ${derivativesResult.liquidations.longPct.toFixed(1)}% | Short: ${derivativesResult.liquidations.shortPct.toFixed(1)}%`;
        logger.info({ symbol, liquidations: liquidationsStr, source: derivativesData.source }, '[FEATURES] Liquidations from derivatives strategy');
      }
    } catch (err: any) {
      logger.warn({ err: err.message, symbol }, '[FEATURES] Derivatives data fetch failed');
    }
    
    // 7. On-Chain Flows (Exchange Reserves) - Use CryptoQuant
    // API MAPPING: CryptoQuant → getReserves() → Reserve change signal
    // Note: This is fetched in calculateWeightedConfidence for scoring, but we can add it here for display
    let onChainFlowsStr = 'N/A';
    try {
      if (uid) {
        const integrations: Record<string, { apiKey: string; secretKey?: string }> = await firestoreAdapter.getEnabledIntegrations(uid).catch(() => ({}));
        const cq = integrations.cryptoquant ?? { apiKey: "" };
        if (cq?.apiKey && typeof cq.apiKey === 'string' && cq.apiKey.trim().length >= 20) {
          const cryptoquantAdapter = new CryptoQuantAdapter(cq.apiKey);
          if (!cryptoquantAdapter.disabled) {
            const reservesData = await cryptoquantAdapter.getReserves(symbol).catch(() => null);
            if (reservesData?.reserveChange24h !== undefined) {
              const change = reservesData.reserveChange24h * 100;
              onChainFlowsStr = change > 0 
                ? `Reserves Increasing (+${change.toFixed(1)}%) - Bearish` 
                : `Reserves Decreasing (${change.toFixed(1)}%) - Bullish`;
              logger.info({ symbol, reserveChange: change }, '[FEATURES] Exchange reserves from CryptoQuant');
            }
          }
        }
      }
    } catch (err: any) {
      logger.debug({ err: err.message, symbol }, '[FEATURES] On-chain flows fetch failed');
    }
    
    // 8. Price Divergence - Compare prices across exchanges
    // API MAPPING: CoinAPI Market (cross-exchange) OR allExchanges → Price deviation calculation
    let priceDivergenceStr = 'N/A';
    try {
      if (allExchanges && allExchanges.length > 1) {
        const prices: number[] = [];
        for (const { adapter: exAdapter } of allExchanges) {
          try {
            const ticker = await exAdapter.getTicker(symbol).catch(() => null);
            if (ticker) {
              const price = parseFloat(ticker.lastPrice || ticker.price || ticker.last || '0');
              if (price > 0) {
                prices.push(price);
              }
            }
          } catch (err: any) {
            // Skip failed exchanges
          }
        }
        
        if (prices.length > 1) {
          const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
          const maxDeviation = Math.max(...prices.map(p => Math.abs(p - avgPrice) / avgPrice));
          const deviationPercent = maxDeviation * 100;
          
          if (deviationPercent < 0.1) {
            priceDivergenceStr = `Low Divergence (${deviationPercent.toFixed(2)}%) - Consistent`;
          } else if (deviationPercent < 0.5) {
            priceDivergenceStr = `Moderate Divergence (${deviationPercent.toFixed(2)}%)`;
          } else {
            priceDivergenceStr = `High Divergence (${deviationPercent.toFixed(2)}%) - Arbitrage Opportunity`;
          }
          logger.info({ symbol, prices, avgPrice, maxDeviation, deviationPercent }, '[FEATURES] Price divergence calculated');
        }
      } else if (uid) {
        // Fallback: Try CoinAPI for cross-exchange comparison
        try {
          const integrations: Record<string, { apiKey: string; secretKey?: string }> = await firestoreAdapter.getEnabledIntegrations(uid).catch(() => ({}));
          const coinapiMarket = integrations.coinapi_market ?? { apiKey: "" };
          if (coinapiMarket?.apiKey && typeof coinapiMarket.apiKey === 'string' && coinapiMarket.apiKey.trim().length >= 20) {
            const marketAdapter = new CoinAPIAdapter(coinapiMarket.apiKey, 'market');
            const marketData = await marketAdapter.getMarketData(symbol).catch(() => null);
            if (marketData?.price && adapter) {
              try {
                const exchangeTicker = await adapter.getTicker(symbol).catch(() => null);
                if (exchangeTicker) {
                  const exchangePrice = parseFloat(exchangeTicker.lastPrice || exchangeTicker.price || exchangeTicker.last || '0');
                  if (exchangePrice > 0) {
                    const deviation = Math.abs(exchangePrice - marketData.price) / marketData.price;
                    const deviationPercent = deviation * 100;
                    priceDivergenceStr = `CoinAPI vs Exchange: ${deviationPercent.toFixed(2)}% deviation`;
                    logger.info({ symbol, coinapiPrice: marketData.price, exchangePrice, deviationPercent }, '[FEATURES] Price divergence from CoinAPI');
                  }
                }
              } catch (err: any) {
                // Skip
              }
            }
          }
        } catch (err: any) {
          logger.debug({ err: err.message, symbol }, '[FEATURES] CoinAPI divergence check failed');
        }
      }
    } catch (err: any) {
      logger.debug({ err: err.message, symbol }, '[FEATURES] Price divergence calculation failed');
    }
    
    // 9. Trend Strength - Calculate from EMA20 and EMA50 (not EMA12/EMA26)
    let trendStrengthStr: string | null = null;
    let trendStrengthValue: { ema20: number | null; ema50: number | null; trend: string } | null = null;
    try {
      interface CandleData {
        close: number;
        high?: number;
        low?: number;
        open?: number;
        volume?: number;
        timestamp?: number;
      }
      let candles: CandleData[] = [];
      
      // Fetch candles for EMA20/EMA50 calculation - MINIMUM 100 CANDLES
      if (adapter && typeof adapter.getKlines === 'function') {
        try {
          console.log(`🔍 [DEBUG] [TREND] Calling adapter.getKlines(${symbol}, ${timeframe}, 100)`);
          const klines = await adapter.getKlines(symbol, timeframe, 100);
          
          // DEBUG: Log raw result of getKlines
          console.log(`🔍 [DEBUG] [TREND] getKlines response length: ${klines?.length || 0}`);
          if (klines && klines.length > 0) {
            console.log(`🔍 [DEBUG] [TREND] First 3 candles:`, JSON.stringify(klines.slice(0, 3), null, 2));
            console.log(`🔍 [DEBUG] [TREND] Last 3 candles:`, JSON.stringify(klines.slice(-3), null, 2));
          } else {
            console.log(`🔍 [DEBUG] [TREND] getKlines returned empty or null`);
          }
          
          if (klines && klines.length >= 50) {
            candles = klines.map((k: any) => ({
              close: parseFloat(k[4] || k.close || 0),
              high: parseFloat(k[2] || k.high || k[4] || k.close || 0),
              low: parseFloat(k[3] || k.low || k[4] || k.close || 0),
              open: parseFloat(k[1] || k.open || k[4] || k.close || 0),
              volume: parseFloat(k[5] || k.volume || 0),
            })).filter((c: CandleData) => c.close > 0);
            
            // EXTRACTED LOGS FORMAT - Trend Strength candle count
            console.log(`Trend Strength Candle Count: ${candles.length}`);
            
            // DEBUG: Log parsed candles before Trend calculation
            console.log(`🔍 [DEBUG] [TREND] Parsed candles array length: ${candles.length}`);
            if (candles.length > 0) {
              const closeValues = candles.map(c => c.close);
              console.log(`🔍 [DEBUG] [TREND] close[] length: ${closeValues.length}, empty: ${closeValues.length === 0}, undefined check: ${closeValues.some(v => v === undefined)}`);
            } else {
              console.log(`🔍 [DEBUG] [TREND] candles array is EMPTY after parsing`);
            }
            
            if (candles.length >= 50) {
              console.log(`🔍 [DEBUG] [TREND] Calculating Trend Strength... (have ${candles.length} candles, need 50)`);
              try {
                const { featureEngine } = await import('./featureEngine');
                const prices = candles.map(c => c.close);
                const ema20 = featureEngine.calculateEMA(prices, 20);
                const ema50 = featureEngine.calculateEMA(prices, 50);
                
                console.log(`🔍 [DEBUG] [TREND] EMA20: ${ema20}, EMA50: ${ema50}`);
                
                if (ema20 !== null && ema50 !== null) {
                  const emaDiff = Math.abs(ema20 - ema50) / ema50 * 100;
                  let trend = 'NEUTRAL';
                  if (ema20 > ema50) {
                    trend = 'BULLISH';
                    if (emaDiff > 2) trendStrengthStr = 'Strong Bullish';
                    else if (emaDiff > 0.5) trendStrengthStr = 'Medium Bullish';
                    else trendStrengthStr = 'Weak Bullish';
                  } else if (ema20 < ema50) {
                    trend = 'BEARISH';
                    if (emaDiff > 2) trendStrengthStr = 'Strong Bearish';
                    else if (emaDiff > 0.5) trendStrengthStr = 'Medium Bearish';
                    else trendStrengthStr = 'Weak Bearish';
                  } else {
                    trendStrengthStr = 'Neutral';
                  }
                  
                  trendStrengthValue = { ema20, ema50, trend };
                  console.log(`🔍 [DEBUG] [TREND] Trend Strength calculation result: ema20=${ema20}, ema50=${ema50}, trend=${trend}, trendStrengthStr=${trendStrengthStr}`);
                  logger.info({ symbol, ema20, ema50, trend, trendStrengthStr }, '[FEATURES] Trend strength calculated from EMA20/EMA50');
                } else {
                  console.log(`🔍 [DEBUG] [TREND] EMA calculation returned null values`);
                }
              } catch (trendErr: any) {
                console.log(`🔍 [DEBUG] [TREND] Trend Strength calculation exception: ${trendErr.message}`);
                console.log(`🔍 [DEBUG] [TREND] Trend Strength calculation stack:`, trendErr.stack);
                logger.error({ err: trendErr.message, symbol }, '[FEATURES] Trend Strength calculation exception - returning null');
                trendStrengthValue = null;
              }
            } else {
              console.log(`🔍 [DEBUG] [TREND] Not enough candles for Trend Strength: have ${candles.length}, need 50`);
            }
          } else {
            console.log(`🔍 [DEBUG] [TREND] getKlines returned insufficient data: length=${klines?.length || 0}, need 50`);
          }
        } catch (err: any) {
          console.log(`🔍 [DEBUG] [TREND] API error: ${err.message}`);
          console.log(`🔍 [DEBUG] [TREND] API error stack:`, err.stack);
          logger.debug({ err: err.message, symbol }, '[FEATURES] Failed to fetch candles for trend strength');
        }
      } else {
        console.log(`🔍 [DEBUG] [TREND] No adapter or getKlines function not available`);
      }
      
      // Fallback to CoinAPI if exchange fails
      if (!trendStrengthValue && candles.length < 50 && uid) {
        try {
          const integrations: Record<string, { apiKey: string; secretKey?: string }> = await firestoreAdapter.getEnabledIntegrations(uid).catch(() => ({}));
          const coinapiFlatfile = integrations.coinapi_flatfile ?? { apiKey: "" };
          const coinapiMarket = integrations.coinapi_market ?? { apiKey: "" };
          
          if (coinapiFlatfile?.apiKey && typeof coinapiFlatfile.apiKey === 'string' && coinapiFlatfile.apiKey.trim().length >= 20) {
            const flatfileAdapter = new CoinAPIAdapter(coinapiFlatfile.apiKey, 'flatfile');
            const historicalOHLCV = await flatfileAdapter.getHistoricalOHLCV(symbol, '1H', 100).catch(() => []);
            if (historicalOHLCV && historicalOHLCV.length >= 50) {
              candles = historicalOHLCV.map((d) => ({
                close: d.close || 0,
                high: d.high || d.close || 0,
                low: d.low || d.close || 0,
                open: d.open || d.close || 0,
                volume: d.volume || 0,
              })).filter((c: CandleData) => c.close > 0);
              
              if (candles.length >= 50) {
                const { featureEngine } = await import('./featureEngine');
                const prices = candles.map(c => c.close);
                const ema20 = featureEngine.calculateEMA(prices, 20);
                const ema50 = featureEngine.calculateEMA(prices, 50);
                
                if (ema20 !== null && ema50 !== null) {
                  const emaDiff = Math.abs(ema20 - ema50) / ema50 * 100;
                  let trend = 'NEUTRAL';
                  if (ema20 > ema50) {
                    trend = 'BULLISH';
                    if (emaDiff > 2) trendStrengthStr = 'Strong Bullish';
                    else if (emaDiff > 0.5) trendStrengthStr = 'Medium Bullish';
                    else trendStrengthStr = 'Weak Bullish';
                  } else if (ema20 < ema50) {
                    trend = 'BEARISH';
                    if (emaDiff > 2) trendStrengthStr = 'Strong Bearish';
                    else if (emaDiff > 0.5) trendStrengthStr = 'Medium Bearish';
                    else trendStrengthStr = 'Weak Bearish';
                  } else {
                    trendStrengthStr = 'Neutral';
                  }
                  
                  trendStrengthValue = { ema20, ema50, trend };
                  logger.info({ symbol, ema20, ema50, trend, trendStrengthStr, source: 'coinapi' }, '[FEATURES] Trend strength calculated from CoinAPI');
                }
              }
            }
          }
        } catch (err: any) {
          logger.debug({ err: err.message, symbol }, '[FEATURES] CoinAPI trend strength calculation failed');
        }
      }
      
      if (!trendStrengthValue) {
        logger.warn({ symbol }, '[FEATURES] Trend strength could not be calculated - no sufficient candle data');
      }
    } catch (err: any) {
      logger.warn({ err: err.message, symbol }, '[FEATURES] Trend strength calculation failed');
    }
    
    // 10. Volatility - Calculate using ATR(14) from real candle data
    // Declare at function scope
    let volatilityScore: string | null = null;
    let volatilityValue: number | null = null;
    try {
      interface CandleData {
        close: number;
        high?: number;
        low?: number;
        open?: number;
        volume?: number;
        timestamp?: number;
      }
      let candles: CandleData[] = [];
      
      // Fetch candles for ATR calculation - MINIMUM 100 CANDLES
      if (adapter && typeof adapter.getKlines === 'function') {
        try {
          console.log(`🔍 [DEBUG] [ATR] Calling adapter.getKlines(${symbol}, ${timeframe}, 100)`);
          const klines = await adapter.getKlines(symbol, timeframe, 100);
          
          // DEBUG: Log raw result of getKlines
          console.log(`🔍 [DEBUG] [ATR] getKlines response length: ${klines?.length || 0}`);
          if (klines && klines.length > 0) {
            console.log(`🔍 [DEBUG] [ATR] First 3 candles:`, JSON.stringify(klines.slice(0, 3), null, 2));
            console.log(`🔍 [DEBUG] [ATR] Last 3 candles:`, JSON.stringify(klines.slice(-3), null, 2));
          } else {
            console.log(`🔍 [DEBUG] [ATR] getKlines returned empty or null`);
          }
          
          if (klines && klines.length >= 15) {
            candles = klines.map((k: any) => ({
              close: parseFloat(k[4] || k.close || 0),
              high: parseFloat(k[2] || k.high || k[4] || k.close || 0),
              low: parseFloat(k[3] || k.low || k[4] || k.close || 0),
              open: parseFloat(k[1] || k.open || k[4] || k.close || 0),
              volume: parseFloat(k[5] || k.volume || 0),
            })).filter((c: CandleData) => c.close > 0 && c.high && c.low);
            
            // DEBUG: Log parsed candles before ATR calculation
            console.log(`🔍 [DEBUG] [ATR] Parsed candles array length: ${candles.length}`);
            if (candles.length > 0) {
              const highValues = candles.map(c => c.high!);
              const lowValues = candles.map(c => c.low!);
              const closeValues = candles.map(c => c.close);
              console.log(`🔍 [DEBUG] [ATR] high[] length: ${highValues.length}, empty: ${highValues.length === 0}`);
              console.log(`🔍 [DEBUG] [ATR] low[] length: ${lowValues.length}, empty: ${lowValues.length === 0}`);
              console.log(`🔍 [DEBUG] [ATR] close[] length: ${closeValues.length}, empty: ${closeValues.length === 0}`);
            } else {
              console.log(`🔍 [DEBUG] [ATR] candles array is EMPTY after parsing`);
            }
            
            // STEP 6 - DEBUG: Log ATR candle count - EXTRACTED LOGS FORMAT
            console.log(`ATR Candle Count: ${candles.length}`);
            console.log('');
            
            if (candles.length >= 15) {
              console.log(`🔍 [DEBUG] [ATR] Calculating ATR... (have ${candles.length} candles, need 15)`);
              try {
                const highs = candles.map(c => c.high!);
                const lows = candles.map(c => c.low!);
                const closes = candles.map(c => c.close);
                
                // Calculate ATR(14) manually
                const period = 14;
                const trueRanges: number[] = [];
                for (let i = 1; i < closes.length; i++) {
                  const tr = Math.max(
                    highs[i] - lows[i],
                    Math.abs(highs[i] - closes[i - 1]),
                    Math.abs(lows[i] - closes[i - 1])
                  );
                  trueRanges.push(tr);
                }
                const atr = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
                volatilityValue = atr;
                
                // Classify volatility based on ATR as percentage of current price
                if (currentPrice > 0) {
                  const atrPercent = (atr / currentPrice) * 100;
                  if (atrPercent > 5) volatilityScore = 'High';
                  else if (atrPercent > 2) volatilityScore = 'Medium';
                  else volatilityScore = 'Low';
                } else {
                  volatilityScore = atr > 0.05 ? 'High' : atr > 0.02 ? 'Medium' : 'Low';
                }
                
                console.log(`🔍 [DEBUG] [ATR] ATR calculation result: atr=${atr}, volatilityValue=${volatilityValue}, volatilityScore=${volatilityScore}`);
                logger.info({ symbol, atr, volatilityValue, volatilityScore }, '[FEATURES] Volatility calculated using ATR(14)');
              } catch (atrErr: any) {
                console.log(`🔍 [DEBUG] [ATR] ATR calculation exception: ${atrErr.message}`);
                console.log(`🔍 [DEBUG] [ATR] ATR calculation stack:`, atrErr.stack);
                logger.error({ err: atrErr.message, symbol }, '[FEATURES] ATR calculation exception - returning null');
                volatilityValue = null;
                volatilityScore = null;
              }
            } else {
              console.log(`🔍 [DEBUG] [ATR] Not enough candles for ATR: have ${candles.length}, need 15`);
            }
          } else {
            console.log(`🔍 [DEBUG] [ATR] getKlines returned insufficient data: length=${klines?.length || 0}, need 15`);
          }
        } catch (err: any) {
          console.log(`🔍 [DEBUG] [ATR] API error: ${err.message}`);
          console.log(`🔍 [DEBUG] [ATR] API error stack:`, err.stack);
          logger.debug({ err: err.message, symbol }, '[FEATURES] Failed to fetch candles for ATR');
        }
      } else {
        console.log(`🔍 [DEBUG] [ATR] No adapter or getKlines function not available`);
      }
      
      // Fallback to CoinAPI if exchange fails
      if (!volatilityValue && candles.length < 15 && uid) {
        try {
          const integrations: Record<string, { apiKey: string; secretKey?: string }> = await firestoreAdapter.getEnabledIntegrations(uid).catch(() => ({}));
          const coinapiFlatfile = integrations.coinapi_flatfile ?? { apiKey: "" };
          
          if (coinapiFlatfile?.apiKey && typeof coinapiFlatfile.apiKey === 'string' && coinapiFlatfile.apiKey.trim().length >= 20) {
            const flatfileAdapter = new CoinAPIAdapter(coinapiFlatfile.apiKey, 'flatfile');
            const historicalOHLCV = await flatfileAdapter.getHistoricalOHLCV(symbol, '1H', 100).catch(() => []);
            if (historicalOHLCV && historicalOHLCV.length >= 15) {
              candles = historicalOHLCV.map((d) => ({
                close: d.close || 0,
                high: d.high || d.close || 0,
                low: d.low || d.close || 0,
                open: d.open || d.close || 0,
                volume: d.volume || 0,
              })).filter((c: CandleData) => c.close > 0 && c.high && c.low);
              
              if (candles.length >= 15) {
                const highs = candles.map(c => c.high!);
                const lows = candles.map(c => c.low!);
                const closes = candles.map(c => c.close);
                
                // Calculate ATR(14) manually
                const period = 14;
                const trueRanges: number[] = [];
                for (let i = 1; i < closes.length; i++) {
                  const tr = Math.max(
                    highs[i] - lows[i],
                    Math.abs(highs[i] - closes[i - 1]),
                    Math.abs(lows[i] - closes[i - 1])
                  );
                  trueRanges.push(tr);
                }
                const atr = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
                volatilityValue = atr;
                
                if (currentPrice > 0) {
                  const atrPercent = (atr / currentPrice) * 100;
                  if (atrPercent > 5) volatilityScore = 'High';
                  else if (atrPercent > 2) volatilityScore = 'Medium';
                  else volatilityScore = 'Low';
                } else {
                  volatilityScore = atr > 0.05 ? 'High' : atr > 0.02 ? 'Medium' : 'Low';
                }
                
                logger.info({ symbol, atr, volatilityValue, volatilityScore, source: 'coinapi' }, '[FEATURES] Volatility calculated from CoinAPI using ATR(14)');
              }
            }
          }
        } catch (err: any) {
          logger.debug({ err: err.message, symbol }, '[FEATURES] CoinAPI ATR calculation failed');
        }
      }
      
      if (!volatilityValue) {
        logger.warn({ symbol }, '[FEATURES] Volatility could not be calculated - no sufficient candle data');
      }
    } catch (err: any) {
      logger.warn({ err: err.message, symbol }, '[FEATURES] Volatility calculation failed');
    }
    
    // 11. News Sentiment - Use LunarCrush
    let newsSentimentStr = 'Neutral';
    try {
      if (uid) {
        const integrations: Record<string, { apiKey: string; secretKey?: string }> = await firestoreAdapter.getEnabledIntegrations(uid).catch(() => ({}));
        const lc = integrations.lunarcrush ?? { apiKey: "" };
        if (lc && lc.apiKey && typeof lc.apiKey === 'string' && lc.apiKey.trim().length >= 20) {
          featureApisUsed.push('LunarCrush');
          const { LunarCrushAdapter } = await import('./lunarcrushAdapter');
          const lunarcrushAdapter = new LunarCrushAdapter(lc.apiKey);
          const sentimentData = await lunarcrushAdapter.getCoinData(symbol).catch(() => null);
          if (sentimentData?.sentiment !== undefined) {
            const sentiment = sentimentData.sentiment;
            if (sentiment > 0.3) newsSentimentStr = 'Bullish';
            else if (sentiment < -0.3) newsSentimentStr = 'Bearish';
            else if (sentiment > 0.1) newsSentimentStr = 'Slightly Bullish';
            else if (sentiment < -0.1) newsSentimentStr = 'Slightly Bearish';
            logger.info({ symbol, sentiment, newsSentimentStr }, '[FEATURES] News sentiment from LunarCrush');
          } else {
            logger.debug({ symbol }, '[FEATURES] LunarCrush sentiment data not available');
          }
        }
      }
    } catch (err: any) {
      logger.warn({ err: err.message, symbol }, '[FEATURES] News sentiment fetch failed');
    }
    
    // NO FALLBACK VALUES - return null if calculation fails
    return {
      rsi: rsiValue ?? null, // NO fallback to 0 or 50
      rsiSignal: rsiSignal ?? null, // NO fallback to 'N/A'
      macd: macdData ?? null, // NO fallback to {0, 0, 'Neutral'}
      volume: volumeAnalysis ?? null, // NO fallback to 'N/A' or 'Stable'
      orderbookImbalance: orderbookImbalanceStr ?? null, // NO fallback to 'N/A'
      liquidity: liquidityStr, // Keep for backward compatibility
      fundingRate: fundingRateStr, // Keep for backward compatibility
      openInterest: openInterestStr, // Keep for backward compatibility
      liquidations: liquidationsStr, // Keep for backward compatibility
      trendStrength: trendStrengthStr ?? null, // NO fallback to 'N/A' or 'Weak'
      volatility: volatilityScore ?? null, // NO fallback to 'N/A' or 'Low'
      newsSentiment: newsSentimentStr, // Keep for backward compatibility
      // Additional fields for completeness
      onChainFlows: onChainFlowsStr,
      priceDivergence: priceDivergenceStr,
      // Additional data for indicators (internal use - these are extracted in runResearch)
      _volumeNumber: volumeNumber ?? null,
      _atrValue: volatilityValue ?? null,
      _orderbookImbalanceValue: orderbookImbalanceValue ?? null,
      _trendStrengthValue: trendStrengthValue ?? null,
      // Track APIs used in calculateFeatures
      _apisUsed: featureApisUsed, // APIs called in this function
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

  /**
   * Calculate weighted confidence score using feature-based scoring with full API integration
   * Returns: { rawConfidence: number, perFeatureScore: Record<string, number>, apisUsed: string[], confluenceFlags: Record<string, boolean> }
   */
  private async calculateWeightedConfidence(
    symbol: string,
    imbalance: number,
    microSignals: ResearchResult['microSignals'],
    features?: ResearchResult['features'],
    uid?: string,
    apiCalls?: string[],
    adapter?: ExchangeConnector,
    allExchanges?: Array<{ exchange: string; adapter: ExchangeConnector; credentials: any }>
  ): Promise<{ 
    rawConfidence: number; 
    perFeatureScore: Record<string, number>; 
    apisUsed: string[];
    confluenceFlags: Record<string, boolean>;
    volumeConfirmed: boolean;
    derivativesContradict: boolean;
  }> {
    const weights = this.featureConfig.weights;
    const perFeatureScore: Record<string, number> = {};
    const apisUsed: string[] = [];
    const confluenceFlags: Record<string, boolean> = {};
    let rawConfidence = 0;
    let volumeConfirmed = false;
    let derivativesContradict = false;

    // Helper to normalize feature score to 0-1
    const normalizeScore = (value: number, min: number, max: number): number => {
      if (max === min) return 0.5;
      return Math.max(0, Math.min(1, (value - min) / (max - min)));
    };

    // Track major and minor signals for confluence
    const majorSignals: string[] = [];
    const minorSignals: string[] = [];

    // 1. Price Indicators (30% total: RSI 8%, MACD 8%, Volume 6%, ATR/Volatility 8%)
    if (features) {
      // RSI (8%)
      if (features.rsi > 0 && features.rsi !== 50) {
        const rsiScore = features.rsi < 30 ? 1.0 : features.rsi > 70 ? 0.0 : normalizeScore(features.rsi, 30, 70);
        const rsiContribution = rsiScore * (weights.rsi / 100);
        rawConfidence += rsiContribution;
        perFeatureScore.rsi = rsiContribution;
        
        // Track for confluence
        if (features.rsi < 30 || features.rsi > 70) {
          majorSignals.push('rsi');
          confluenceFlags.rsi = true;
        }
        logger.info({ symbol, rsi: features.rsi, contribution: rsiContribution }, '[CONFIDENCE] RSI contribution');
      }

      // MACD (8%)
      if (features.macd.trend !== 'NEUTRAL' && features.macd.trend !== 'Neutral') {
        const macdScore = features.macd.trend === 'BULLISH' || features.macd.trend === 'Bullish' 
          ? 0.5 + Math.min(0.5, Math.abs(features.macd.histogram) * 100)
          : 0.5 - Math.min(0.5, Math.abs(features.macd.histogram) * 100);
        const macdContribution = Math.max(0, Math.min(1, macdScore)) * (weights.macd / 100);
        rawConfidence += macdContribution;
        perFeatureScore.macd = macdContribution;
        
        // Track for confluence
        if (Math.abs(features.macd.histogram) > 0.001) {
          majorSignals.push('macd');
          confluenceFlags.macd = true;
        }
        logger.info({ symbol, macdTrend: features.macd.trend, contribution: macdContribution }, '[CONFIDENCE] MACD contribution');
      }

      // Volume (6%) - with RVOL confirmation
      if (features.volume !== 'Stable') {
        // Calculate RVOL if we have volume history
        const volumeHistory = this.volumeHistory.get(symbol) || [];
        let rvol = 1.0;
        if (volumeHistory.length >= 20) {
          const avgVolume = volumeHistory.slice(-20).reduce((a, b) => a + b, 0) / 20;
          rvol = avgVolume > 0 ? microSignals.volume / avgVolume : 1.0;
        }
        
        // Volume confirmation check
        volumeConfirmed = rvol >= this.featureConfig.volume.rvolThreshold;
        
        const volumeScore = (features.volume === 'Bullish' || features.volume === 'Increasing') && volumeConfirmed
          ? 0.8
          : (features.volume === 'Bullish' || features.volume === 'Increasing')
            ? 0.5 // Reduced if not confirmed
            : 0.3;
        const volumeContribution = volumeScore * (weights.volume / 100);
        rawConfidence += volumeContribution;
        perFeatureScore.volume = volumeContribution;
        
        if (volumeConfirmed && (features.volume === 'Bullish' || features.volume === 'Increasing')) {
          majorSignals.push('volume');
          confluenceFlags.volume = true;
        }
        logger.info({ symbol, volume: features.volume, rvol, volumeConfirmed, contribution: volumeContribution }, '[CONFIDENCE] Volume contribution');
      }

      // ATR/Volatility (8%)
      const volatilityScore = features.volatility === 'High' ? 0.3 : features.volatility === 'Medium' ? 0.6 : 0.8;
      const volatilityContribution = volatilityScore * (weights.atrVolatility / 100);
      rawConfidence += volatilityContribution;
      perFeatureScore.volatility = volatilityContribution;
    }

    // 2. Orderbook Imbalance & Liquidity (20% total: Imbalance 12%, Liquidity 8%)
    const imbalanceStrength = Math.abs(imbalance);
    const imbalanceScore = Math.min(1.0, imbalanceStrength * 2); // Normalize to 0-1
    const imbalanceContribution = imbalanceScore * (weights.orderbookImbalance / 100);
    rawConfidence += imbalanceContribution;
    perFeatureScore.orderbookImbalance = imbalanceContribution;
    
    if (imbalanceStrength > 0.33) {
      majorSignals.push('orderbookImbalance');
      confluenceFlags.orderbookImbalance = true;
    }
    logger.info({ symbol, imbalanceStrength, contribution: imbalanceContribution }, '[CONFIDENCE] Orderbook imbalance contribution');

    // Liquidity/Spread (8%) - with liquidity guard
    const spreadScore = microSignals.spread > 0 
      ? Math.max(0, Math.min(1, 1 - (microSignals.spread / 0.4))) // Tighter spread = higher score
      : 0.5;
    
    // Liquidity guard: reduce score if spread too wide
    const liquidityScore = microSignals.spread > this.featureConfig.liquidity.maxSpreadPercent
      ? spreadScore * this.featureConfig.liquidity.minLiquidityScore
      : spreadScore;
    
    const liquidityContribution = liquidityScore * (weights.liquiditySpread / 100);
    rawConfidence += liquidityContribution;
    perFeatureScore.liquidity = liquidityContribution;
    logger.info({ symbol, spread: microSignals.spread, liquidityScore, contribution: liquidityContribution }, '[CONFIDENCE] Liquidity contribution');

    // 3. Derivatives (20% total: Funding Rate 7%, Open Interest 7%, Liquidations 6%)
    // Use derivativesStrategy for proper integration
    let derivativesResult: any = null;
    if (uid && adapter) {
      try {
        const integrations = await firestoreAdapter.getEnabledIntegrations(uid).catch(() => ({})) as Record<string, { apiKey: string; secretKey?: string }>;
        const cq = integrations?.cryptoquant ?? { apiKey: "" };
        const cryptoquantAdapter = (cq?.apiKey && typeof cq.apiKey === 'string' && cq.apiKey.trim().length >= 20)
          ? new CryptoQuantAdapter(cq.apiKey)
          : undefined;
        
        const derivativesData = await fetchDerivativesData(symbol, adapter, cryptoquantAdapter);
        derivativesResult = analyzeDerivatives(derivativesData);
        
        if (derivativesData.source !== 'cryptoquant') {
          apisUsed.push(adapter.getExchangeName());
        }
        if (cryptoquantAdapter && !cryptoquantAdapter.disabled) {
          apisUsed.push('cryptoquant');
        }
        
        // Funding Rate (7%)
        if (derivativesResult.fundingRate.value !== 0) {
          const fundingContribution = derivativesResult.fundingRate.score * (weights.fundingRate / 100);
          rawConfidence += fundingContribution;
          perFeatureScore.fundingRate = fundingContribution;
          minorSignals.push('fundingRate');
          logger.info({ symbol, fundingRate: derivativesResult.fundingRate.value, contribution: fundingContribution }, '[CONFIDENCE] Funding rate contribution');
        }

        // Open Interest (7%)
        if (derivativesResult.openInterest.change24h !== 0) {
          const oiContribution = derivativesResult.openInterest.score * (weights.openInterest / 100);
          rawConfidence += oiContribution;
          perFeatureScore.openInterest = oiContribution;
          minorSignals.push('openInterest');
          logger.info({ symbol, oiChange: derivativesResult.openInterest.change24h, contribution: oiContribution }, '[CONFIDENCE] Open interest contribution');
        }

        // Liquidations (6%)
        if (derivativesResult.liquidations && (derivativesResult.liquidations as any).totalLiquidation24h > 0) {
          const liqContribution = derivativesResult.liquidations.score * (weights.liquidations / 100);
          rawConfidence += liqContribution;
          perFeatureScore.liquidations = liqContribution;
          minorSignals.push('liquidations');
          logger.info({ symbol, liquidations: derivativesResult.liquidations, contribution: liqContribution }, '[CONFIDENCE] Liquidations contribution');
        }
        
        // Derivatives guard: check if derivatives contradict price signals
        const priceSignal = imbalance > 0 ? 'bullish' : imbalance < 0 ? 'bearish' : 'neutral';
        const derivativesSignal = derivativesResult.overallSignal.toLowerCase();
        if (priceSignal !== 'neutral' && derivativesSignal !== 'neutral' && priceSignal !== derivativesSignal) {
          derivativesContradict = true;
          // Apply penalty
          const penalty = this.featureConfig.derivatives.contradictPenalty;
          rawConfidence = Math.max(0, rawConfidence - penalty);
          logger.warn({ symbol, priceSignal, derivativesSignal, penalty }, '[CONFIDENCE] Derivatives contradict price signal - applying penalty');
        }
      } catch (err: any) {
        logger.debug({ err, symbol }, '[CONFIDENCE] Derivatives fetch failed');
      }
    }

    // 4. On-chain / Exchange Flows (10%)
    if (uid) {
      try {
        const integrations = await firestoreAdapter.getEnabledIntegrations(uid).catch(() => ({})) as Record<string, { apiKey: string; secretKey?: string }>;
        const cq = integrations?.cryptoquant ?? { apiKey: "" };
        if (cq?.apiKey && typeof cq.apiKey === 'string' && cq.apiKey.trim().length >= 20) {
          const cryptoquantAdapter = new CryptoQuantAdapter(cq.apiKey);
          if (!cryptoquantAdapter.disabled) {
            apisUsed.push('cryptoquant');
            try {
              const flowData = await cryptoquantAdapter.getExchangeFlow(symbol).catch(() => null);
              if (flowData?.exchangeFlow !== undefined) {
                const flowScore = flowData.exchangeFlow > 0 ? 0.7 : 0.3;
                const flowContribution = flowScore * (weights.onChainFlows / 100);
                rawConfidence += flowContribution;
                perFeatureScore.onChainFlows = flowContribution;
                minorSignals.push('onChainFlows');
                logger.info({ symbol, exchangeFlow: flowData.exchangeFlow, contribution: flowContribution }, '[CONFIDENCE] On-chain flows contribution');
              }
              
              // Also get reserves for additional signal
              const reservesData = await cryptoquantAdapter.getReserves(symbol).catch(() => null);
              if (reservesData?.reserveChange24h !== undefined) {
                // Reserve increase = bearish (more supply on exchange)
                const reserveScore = reservesData.reserveChange24h > 0 ? 0.3 : 0.7;
                const reserveContribution = reserveScore * (weights.onChainFlows / 100) * 0.3; // 30% of onChainFlows weight
                rawConfidence += reserveContribution;
                perFeatureScore.reserves = reserveContribution;
                logger.info({ symbol, reserveChange: reservesData.reserveChange24h, contribution: reserveContribution }, '[CONFIDENCE] Exchange reserves contribution');
              }
            } catch (err: any) {
              logger.debug({ err, symbol }, 'CryptoQuant flow/reserves fetch failed');
            }
          }
        }
      } catch (err: any) {
        logger.debug({ err, symbol }, 'On-chain flows fetch failed');
      }
    }

    // 5. News / Sentiment (10%) - Use LunarCrush
    if (features && features.newsSentiment !== 'Neutral') {
      const sentimentScore = features.newsSentiment === 'Bullish' ? 0.7 
        : features.newsSentiment === 'Bearish' ? 0.3 
        : 0.5;
      const sentimentContribution = sentimentScore * (weights.newsSentiment / 100);
      rawConfidence += sentimentContribution;
      perFeatureScore.newsSentiment = sentimentContribution;
      minorSignals.push('newsSentiment');
      logger.info({ symbol, sentiment: features.newsSentiment, contribution: sentimentContribution }, '[CONFIDENCE] News sentiment contribution');
    }

    // 6. Cross-exchange price divergence (10%)
    // Compare prices across exchanges if multiple available
    let divergenceScore = 0.5; // Default neutral
    if (allExchanges && allExchanges.length > 1) {
      try {
        const prices: number[] = [];
        for (const { adapter: exAdapter } of allExchanges) {
          try {
            const ticker = await exAdapter.getTicker(symbol).catch(() => null);
            if (ticker) {
              const price = parseFloat(ticker.lastPrice || ticker.price || ticker.last || '0');
              if (price > 0) {
                prices.push(price);
                apisUsed.push(exAdapter.getExchangeName());
              }
            }
          } catch (err: any) {
            // Skip failed exchanges
          }
        }
        
        if (prices.length > 1) {
          const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
          const maxDeviation = Math.max(...prices.map(p => Math.abs(p - avgPrice) / avgPrice));
          // Lower deviation = higher score (more consistent pricing)
          divergenceScore = Math.max(0.3, 1 - (maxDeviation * 10));
          logger.info({ symbol, prices, avgPrice, maxDeviation, divergenceScore }, '[CONFIDENCE] Price divergence calculated');
        }
      } catch (err: any) {
        logger.debug({ err, symbol }, 'Price divergence calculation failed');
      }
    } else if (uid) {
      // Fallback: Try CoinAPI for cross-exchange comparison
      try {
        const integrations = await firestoreAdapter.getEnabledIntegrations(uid).catch(() => ({})) as Record<string, { apiKey: string; secretKey?: string }>;
        const coinapiMarket = integrations?.coinapi_market ?? { apiKey: "" };
        if (coinapiMarket?.apiKey && typeof coinapiMarket.apiKey === 'string' && coinapiMarket.apiKey.trim().length >= 20) {
          const marketAdapter = new CoinAPIAdapter(coinapiMarket.apiKey, 'market');
          const marketData = await marketAdapter.getMarketData(symbol).catch(() => null);
          if (marketData?.price) {
            apisUsed.push('coinapi_market');
            // Compare with exchange price if available
            if (adapter) {
              try {
                const exchangeTicker = await adapter.getTicker(symbol).catch(() => null);
                if (exchangeTicker) {
                  const exchangePrice = parseFloat(exchangeTicker.lastPrice || exchangeTicker.price || exchangeTicker.last || '0');
                  if (exchangePrice > 0) {
                    const deviation = Math.abs(exchangePrice - marketData.price) / marketData.price;
                    divergenceScore = Math.max(0.3, 1 - (deviation * 10));
                    logger.info({ symbol, coinapiPrice: marketData.price, exchangePrice, deviation, divergenceScore }, '[CONFIDENCE] Price divergence from CoinAPI');
                  }
                }
              } catch (err: any) {
                // Skip
              }
            }
          }
        }
      } catch (err: any) {
        logger.debug({ err, symbol }, 'CoinAPI divergence check failed');
      }
    }
    
    const divergenceContribution = divergenceScore * (weights.priceDivergence / 100);
    rawConfidence += divergenceContribution;
    perFeatureScore.priceDivergence = divergenceContribution;
    logger.info({ symbol, divergenceScore, contribution: divergenceContribution }, '[CONFIDENCE] Price divergence contribution');

    // Normalize to 0-100
    rawConfidence = Math.max(0, Math.min(100, rawConfidence * 100));

    // Check confluence
    const hasConfluence = this.checkConfluence(majorSignals, minorSignals, features);
    confluenceFlags.hasConfluence = hasConfluence;

    logger.info({ 
      symbol, 
      rawConfidence, 
      majorSignals: majorSignals.length,
      minorSignals: minorSignals.length,
      hasConfluence,
      volumeConfirmed,
      derivativesContradict,
      apisUsed 
    }, '[CONFIDENCE] Weighted confidence calculated');

    return { rawConfidence, perFeatureScore, apisUsed, confluenceFlags, volumeConfirmed, derivativesContradict };
  }

  /**
   * Check confluence rules: require at least 2 major signals OR 1 major + 2 minor
   */
  private checkConfluence(
    majorSignals: string[],
    minorSignals: string[],
    features?: ResearchResult['features']
  ): boolean {
    if (!this.featureConfig.confluence.enabled) {
      return true; // Confluence check disabled
    }

    const majorCount = majorSignals.length;
    const minorCount = minorSignals.length;

    // Rule 1: At least minMajorSignals major signals
    if (majorCount >= this.featureConfig.confluence.minMajorSignals) {
      return true;
    }

    // Rule 2: 1 major + at least minMinorSignals minor
    if (majorCount >= 1 && minorCount >= this.featureConfig.confluence.minMinorSignals) {
      return true;
    }

    return false;
  }

  /**
   * Apply EMA smoothing to confidence score
   */
  private applyConfidenceSmoothing(symbol: string, rawConfidence: number): number {
    if (!this.featureConfig.smoothing.enabled) {
      return rawConfidence;
    }

    const history = this.confidenceHistory.get(symbol) || [];
    history.push(rawConfidence);
    
    // Keep only last N runs
    const window = this.featureConfig.smoothing.window;
    if (history.length > window) {
      history.shift();
    }
    this.confidenceHistory.set(symbol, history);

    // Calculate EMA
    const alpha = this.featureConfig.smoothing.alpha;
    if (history.length === 1) {
      return rawConfidence;
    }

    let ema = history[0];
    for (let i = 1; i < history.length; i++) {
      ema = alpha * history[i] + (1 - alpha) * ema;
    }

    return Math.max(0, Math.min(100, ema));
  }

  private async calculateAccuracy(
    symbol: string,
    imbalance: number,
    microSignals: ResearchResult['microSignals'],
    uid?: string,
    apiCalls?: string[],
    features?: ResearchResult['features']
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

    // 5. Feature-based weighted scoring (if features are available)
    if (features) {
      // RSI signal contribution
      if (features.rsi > 0 && features.rsi !== 50) {
        const rsiContribution = features.rsi > 70 || features.rsi < 30 
          ? 0.08 // Strong RSI signal (overbought/oversold)
          : features.rsi > 60 || features.rsi < 40
            ? 0.05 // Moderate RSI signal
            : 0.02; // Weak RSI signal
        accuracy += rsiContribution;
        contributions.rsi = rsiContribution;
        logger.debug({ symbol, rsi: features.rsi, contribution: rsiContribution }, '[ACCURACY] RSI contribution');
      }
      
      // MACD trend contribution
      if (features.macd.trend !== 'NEUTRAL' && features.macd.histogram !== 0) {
        const macdContribution = Math.abs(features.macd.histogram) > 0.001
          ? 0.08 // Strong MACD signal
          : 0.04; // Moderate MACD signal
        accuracy += macdContribution;
        contributions.macd = macdContribution;
        logger.debug({ symbol, macdTrend: features.macd.trend, contribution: macdContribution }, '[ACCURACY] MACD contribution');
      }
      
      // Volume trend contribution
      if (features.volume !== 'Stable') {
        const volumeContribution = features.volume === 'Increasing' ? 0.05 : 0.03;
        accuracy += volumeContribution;
        contributions.volumeTrend = volumeContribution;
        logger.debug({ symbol, volume: features.volume, contribution: volumeContribution }, '[ACCURACY] Volume trend contribution');
      }
      
      // Trend strength contribution
      if (features.trendStrength !== 'Weak') {
        const trendContribution = features.trendStrength === 'Strong' ? 0.1 : 0.05;
        accuracy += trendContribution;
        contributions.trendStrength = trendContribution;
        logger.debug({ symbol, trendStrength: features.trendStrength, contribution: trendContribution }, '[ACCURACY] Trend strength contribution');
      }
      
      // Funding rate contribution
      if (features.fundingRate !== 'N/A' && !features.fundingRate.includes('N/A')) {
        const fundingContribution = 0.03; // Funding rate provides moderate signal
        accuracy += fundingContribution;
        contributions.fundingRate = fundingContribution;
        logger.debug({ symbol, fundingRate: features.fundingRate, contribution: fundingContribution }, '[ACCURACY] Funding rate contribution');
      }
      
      // Open interest contribution
      if (features.openInterest !== 'N/A' && !features.openInterest.includes('N/A')) {
        const oiContribution = features.openInterest.includes('Increasing') ? 0.05 : 0.02;
        accuracy += oiContribution;
        contributions.openInterest = oiContribution;
        logger.debug({ symbol, openInterest: features.openInterest, contribution: oiContribution }, '[ACCURACY] Open interest contribution');
      }
      
      // News sentiment contribution
      if (features.newsSentiment !== 'Neutral') {
        const sentimentContribution = features.newsSentiment === 'Bullish' || features.newsSentiment === 'Bearish'
          ? 0.05
          : 0.02; // Slightly Bullish/Bearish
        accuracy += sentimentContribution;
        contributions.newsSentiment = sentimentContribution;
        logger.debug({ symbol, newsSentiment: features.newsSentiment, contribution: sentimentContribution }, '[ACCURACY] News sentiment contribution');
      }
    }

    // 6. Fetch external data sources if integrations are available
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

    // 5. Funding Rate & Open Interest (if available from CryptoQuant or Exchange APIs)
    // Note: These would be added via features if available
    // Explanations for funding rate and OI are handled in feature calculation

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

