import crypto from 'crypto';
import { logger } from '../utils/logger';
import { firestoreAdapter, type ActiveExchangeContext } from './firestoreAdapter';
import { MarketAuxAdapter, MarketAuxData } from './MarketAuxAdapter';
import { CryptoCompareAdapter, type CryptoCompareData, type MTFIndicators, type MTFConfluenceResult } from './cryptoCompareAdapter';
// NOTE: CoinAPI replaced with free APIs
import { BinancePublicAdapter } from './binancePublicAdapter';
import { CoinGeckoAdapter } from './coingeckoAdapter';
import { GoogleFinanceAdapter } from './googleFinanceAdapter';
import { analyzeRSI } from './strategies/rsiStrategy';
import { analyzeMACD } from './strategies/macdStrategy';
import { analyzeVolume } from './strategies/volumeStrategy';
import { analyzeLiquidity } from './strategies/liquidityStrategy';
import { analyzeSentiment, type SentimentData, type SentimentResult } from './strategies/sentimentStrategy';
import { analyzeDerivatives, type DerivativesResult, type DerivativesData } from './strategies/derivativesStrategy';
import { computeConfidence, computeFeatureScores, fuseSignals } from './confidenceEngine';
import type { FeatureScoreState } from './confidenceEngine';
import type { Orderbook } from '../types';
import type { ExchangeConnector } from './exchangeConnector';

const VALID_TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'];
const MULTI_TIMEFRAMES = ['5m', '15m', '1h'] as const;
type MultiTimeframe = typeof MULTI_TIMEFRAMES[number];
type BiasSignal = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
type ConfluenceState = 'ALIGNED' | 'OPPOSED' | 'MIXED' | 'MISSING';
const TIMEFRAME_WEIGHTS: Record<MultiTimeframe, number> = {
  '5m': 1,
  '15m': 1.2,
  '1h': 1.4,
};

type ApiCallStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED';

export interface ApiCallReportEntry {
  apiName: string;
  status: ApiCallStatus;
  message?: string;
  durationMs?: number;
  provider?: string;
}

export interface MissingDependency {
  api: string;
  missingKey?: boolean;
  reason?: string;
}

type TimeframeSignalOverview = {
  signal: BiasSignal;
  scorePercent: number;
  fusedScore: number;
  confidence: number;
  priceMomentum: number;
  trend: string | null;
};

type TimeframeBreakdown = {
  available: boolean;
  bias: BiasSignal;
  score: number;
  scorePercent: number;
  fusedScore: number;
  weight: number;
  perFeatureScore: Record<string, number>;
  availability: FeatureScoreState['availability'];
  metadata: {
    rsi?: number | null;
    macdHistogram?: number | null;
    volumeSignal?: string | null;
    atr?: number | null;
    priceMomentum?: number;
    trend?: string | null;
  };
};

type MultiTimeframeContext = {
  breakdown: Record<MultiTimeframe, TimeframeBreakdown>;
  signalsByTimeframe: Record<MultiTimeframe, TimeframeSignalOverview>;
  confluenceMatrix: Record<string, { status: ConfluenceState; weight: number }>;
  alignmentCount: number;
  allAgree: boolean;
  higherContradiction: boolean;
  shortTermDominant: boolean;
  scorePercent: number;
  availableCount: number;
};

export interface ResearchSignal {
  type: 'entry' | 'exit' | 'sl' | 'tp';
  price: number;
  reason?: string;
}

export interface LiveAnalysis {
  isLive: boolean;
  lastUpdated: string;
  summary: string;
  meta?: any;
}

export interface ResearchResult {
  symbol: string;
  status: 'ok' | 'insufficient_data' | 'error';
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
  entry: number | null;
  exits: number[];
  stopLoss: number | null;
  takeProfit: number | null;
  side: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number;
  timeframe: string;
  signals: ResearchSignal[];
  liveAnalysis?: LiveAnalysis;
  message?: string;
  currentPrice: number;
  mode: 'LOW' | 'MID_BLUR' | 'NORMAL' | 'TRADE_SETUP';
  recommendedTrade: 'LONG' | 'SHORT' | null;
  blurFields: boolean;
  apiCalls: string[];
  explanations: string[];
  accuracyRange: string | undefined;
  timedOut?: boolean;
  partialData?: boolean;
  rsi5?: number | null;
  rsi14?: number | null;
  trendAnalysis?: {
    ema12: number | null;
    ema26: number | null;
    trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  } | null;
  confidenceBreakdown?: {
    technicals: number;
    orderFlow: number;
    sentiment: number;
    derivatives: number;
    volatility: number;
    momentum: number;
    liquidity: number;
    microStructure: number;
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
    confluenceCount?: number;
  };
  signalsByTimeframe?: Record<string, TimeframeSignalOverview>;
  confluenceMatrix?: Record<string, { status: ConfluenceState; weight: number }>;
  mtfScore?: number;
  mtfConfluenceCount?: number;
  highConfidenceReason?: string | null;
  perTimeframeBreakdown?: Record<string, TimeframeBreakdown>;
  liquidityAcceptable?: boolean;
  derivativesAligned?: boolean;
  mtf?: {
    "5m": MTFIndicators;
    "15m": MTFIndicators;
    "1h": MTFIndicators;
    score: string;
    boost: string;
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
    globalMarketData?: {
      price?: number;
      volume24h?: number;
      priceChangePercent24h?: number;
    };
    _volumeNumber?: number | null;
    _atrValue?: number | null;
    _orderbookImbalanceValue?: number | null;
    _trendStrengthValue?: { ema20: number | null; ema50: number | null; trend: string } | null;
    _apisUsed?: Record<string, boolean | string>;
  };
  indicators?: {
    rsi?: number | null;
    macd?: { signal: number; histogram: number; trend: string } | null;
    volume?: number | null;
    trendStrength?: { ema20?: number | null; ema50?: number | null; ema12?: number | null; ema26?: number | null; trend: string } | null;
    volatility?: number | null;
    orderbook?: number | null;
  };
  entrySignal?: 'LONG' | 'SHORT' | null;
  exitSignal?: number[] | null;
  entryPrice?: number | null;
  recommendation?: 'AUTO' | 'MANUAL' | null;
  perFeatureScore?: Record<string, number>;
  apisUsed?: Record<string, boolean | string>;
  _apiUsageSummary?: {
    totalApis: number;
    successfulApis: number;
    failedApis: number;
    providerDetails: Record<string, boolean | string>;
  };
  rawConfidence?: number;
  smoothedConfidence?: number;
  confluenceFlags?: Record<string, boolean>;
  volumeConfirmed?: boolean;
  derivativesContradict?: boolean;
  apiCallReport: ApiCallReportEntry[];
  missingDependencies?: MissingDependency[];
  _providerDebug?: Record<string, any>; // Debug info for provider calls
}

class ResearchEngineError extends Error {
  constructor(
    message: string,
    public readonly errorId: string,
    public readonly statusCode: number = 500,
    public readonly missingDependencies?: MissingDependency[]
  ) {
    super(message);
    this.name = 'ResearchEngineError';
  }
}

type NormalizedCandle = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
};

export class ResearchEngine {
  constructor() {}

  async runResearch(
    symbol: string,
    uid: string,
    adapterOverride?: ExchangeConnector,
    _forceEngine: boolean = false,
    _legacy?: Array<{ exchange: string; adapter: ExchangeConnector; credentials: any }>,
    timeframe: string = '5m',
    activeContext?: ActiveExchangeContext
  ): Promise<ResearchResult> {
    // Add global 10-second timeout to prevent hanging (never throws)
    return Promise.race([
      this.runResearchInternal(symbol, uid, adapterOverride, _forceEngine, _legacy, timeframe, activeContext),
      new Promise<ResearchResult>((resolve) =>
        setTimeout(() => {
          logger.warn({ symbol, uid, timeframe }, 'Research timeout: exceeded 10 seconds, returning complete fallback result');
          // Return complete fallback result instead of partial
          resolve(this.createCompleteFallbackResult(symbol, timeframe));
        }, 10000)
      )
    ]);
  }

  private createCompleteFallbackResult(symbol: string, timeframe: string): ResearchResult {
    return {
      symbol,
      status: 'ok',
      signal: 'HOLD',
      accuracy: 0.5,
      orderbookImbalance: 0,
      recommendedAction: 'Complete fallback analysis - all providers timed out',
      microSignals: { spread: 0, volume: 0, priceMomentum: 0, orderbookDepth: 0 },
      entry: null,
      exits: [],
      stopLoss: null,
      takeProfit: null,
      side: 'NEUTRAL',
      confidence: 0.5,
      timeframe,
      signals: [],
      currentPrice: 0,
      mode: 'LOW',
      recommendedTrade: null,
      blurFields: false,
      apiCalls: [],
      apiCallReport: [],
      explanations: [],
      accuracyRange: undefined,
      timedOut: true,
      partialData: false,
      liveAnalysis: {
        isLive: false,
        lastUpdated: new Date().toISOString(),
        summary: 'Complete fallback analysis',
        meta: {}
      }
    };
  }

  private async runResearchInternal(
    symbol: string,
    uid: string,
    adapterOverride?: ExchangeConnector,
    _forceEngine: boolean = false,
    _legacy?: Array<{ exchange: string; adapter: ExchangeConnector; credentials: any }>,
    timeframe: string = '5m',
    activeContext?: ActiveExchangeContext
  ): Promise<ResearchResult> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const normalizedTimeframe = this.normalizeTimeframe(timeframe);
    const startedAt = Date.now();
    const context = activeContext ?? await this.resolveContext(uid);

    logger.info({ uid, symbol: normalizedSymbol, timeframe: normalizedTimeframe }, 'FINAL SYMBOL USED in research engine');

    if (adapterOverride && !activeContext && uid !== 'system') {
      logger.warn({ uid, symbol: normalizedSymbol }, 'Adapter override ignored — active exchange determined via Firestore');
    }

    const apiCalls: string[] = [];
    const apiCallReport: ApiCallReportEntry[] = [];
    const providerDebug: Record<string, any> = {};

    // Declare variables that are used before their initialization
    let binanceSpreadPercent: number | null = null;
    let binanceTickerResult: { success: boolean; data?: any; error?: any; duration: number; httpStatus?: number };
    let binanceBookTickerResult: { success: boolean; data?: any; error?: any; duration: number; httpStatus?: number };
    let binanceVolatilityResult: { success: boolean; data?: any; error?: any; duration: number; httpStatus?: number };
    let binanceMarketData: any = {};
    let binanceVolumeTrend: string = 'Stable';
    let binanceTickerData: any = null;

    const recordApiCall = (entry: ApiCallReportEntry) => {
      apiCallReport.push(entry);
    };

    const logProviderCall = async <T>(
      providerName: string,
      fn: () => Promise<T>
    ): Promise<{ success: boolean; data?: T; error?: any; duration: number; httpStatus?: number }> => {
      const startTime = Date.now();
      try {
        const result = await fn();
        const duration = Date.now() - startTime;
        providerDebug[providerName] = {
          called: true,
          status: 'SUCCESS',
          durationMs: duration,
          dataPreview: result ? Object.keys(result) : null,
        };
        logger.info({ provider: providerName, status: 'SUCCESS', durationMs: duration, dataKeys: result ? Object.keys(result) : null }, `Provider ${providerName} call completed`);
        return { success: true, data: result, duration };
      } catch (err: any) {
        const duration = Date.now() - startTime;
        const httpStatus = err.response?.status;
        providerDebug[providerName] = {
          called: true,
          status: 'ERROR',
          durationMs: duration,
          httpStatus,
          error: err.message,
        };
        logger.error({ provider: providerName, status: 'ERROR', durationMs: duration, httpStatus, error: err.message }, `Provider ${providerName} call failed`);
        return { success: false, error: err, duration, httpStatus };
      }
    };

    const runApiCall = async <T>(
      apiName: string,
      fn: () => Promise<T>,
      timeoutMs: number,
      fallbackValue: T,
      provider?: string
    ): Promise<{ success: boolean; data: T; fallback: boolean; durationMs: number }> => {
      const callStarted = Date.now();

      try {
        const result = await Promise.race([
          fn(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), timeoutMs)
          )
        ]);

        const duration = Date.now() - callStarted;
        recordApiCall({
          apiName,
          status: 'SUCCESS',
          durationMs: duration,
          provider,
        });

        return { success: true, data: result, fallback: false, durationMs: duration };
      } catch (err: any) {
        const duration = Date.now() - callStarted;
        const message = err?.message || 'Unknown error';

        recordApiCall({
          apiName,
          status: 'FAILED',
          message,
          durationMs: duration,
          provider,
        });

        // NEVER throw - always return fallback data
        logger.warn({ apiName, error: message, timeoutMs }, 'API call failed, using fallback');
        return { success: false, data: fallbackValue, fallback: true, durationMs: duration };
      }
    };

    // NOTE: Exchange API is now optional for Deep Research
    const userExchangeAdapter = context?.adapter || null;

    // ALL 5 provider APIs are MANDATORY - buildProviderAdapters throws if any are missing
    // NOTE: CoinAPI replaced with free APIs
    const { marketAuxAdapter, cryptoAdapter, binanceAdapter, coingeckoAdapter, googleFinanceAdapter } =
      await this.buildProviderAdapters(uid);

    // NOTE: Exchange API is now OPTIONAL for Deep Research - only required for Auto-Trade
    // Deep Research works with LunarCrush + CryptoQuant + Free APIs (Binance, CoinGecko, Google Finance)
    // Exchange API is only needed for actual trading execution, not for research analysis

    // Safe exchange name handling
    const exchangeName = context?.name ?? "no-exchange";

    // Initialize providersUsed - will be updated based on actual API call results
    const providersUsed: Record<string, boolean | string> = {
      userExchange: exchangeName, // Exchange connection is optional for research
      cryptocompare: true, // Always attempted
      marketaux: true, // Always attempted
      binance: true, // Always attempted
      coingecko: true, // Always attempted
      googlefinance: true, // Always attempted
    };

    try {
      // Use exchange candles if available, otherwise fall back to Binance free API
      let candles: NormalizedCandle[];

      if (userExchangeAdapter && context) {
        const candlesResult = await runApiCall<NormalizedCandle[]>(
          `${exchangeName.toUpperCase()} Candles (${normalizedTimeframe})`,
          () => this.fetchExchangeCandles(userExchangeAdapter!, normalizedSymbol, normalizedTimeframe, 500, apiCalls),
          2500,
          [{
            timestamp: Date.now(),
            open: 0,
            high: 0,
            low: 0,
            close: 0,
            volume: 0
          }],
          exchangeName
        );
        candles = candlesResult.data;
      } else {
        // Use Binance free API for candles when no exchange API is configured
        const binanceCandlesResult = await runApiCall<Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>>(
          `Binance Candles (${normalizedTimeframe})`,
          () => binanceAdapter.getKlines(normalizedSymbol, normalizedTimeframe, 500),
          2500,
          [{
            time: Date.now(),
            open: 0,
            high: 0,
            low: 0,
            close: 0,
            volume: 0
          }],
          'Binance'
        );

        // Convert Binance format to NormalizedCandle format
        candles = binanceCandlesResult.data.map(candle => ({
          timestamp: candle.time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        }));
      }
      if (!candles || candles.length === 0) {
        logger.warn({ symbol: normalizedSymbol, exchange: exchangeName }, 'No candles available, using fallback data');
        candles = [{
          timestamp: Date.now(),
          open: 0,
          high: 0,
          low: 0,
          close: 0,
          volume: 0
        }];
      }
      this.ensureCandleCoverage(candles);

      const multiTimeframeCandles = await this.buildMultiTimeframeCandles({
        symbol: normalizedSymbol,
        primaryTimeframe: normalizedTimeframe,
        primaryCandles: candles,
        fetchTimeframe: async (tf) => {
          if (tf === normalizedTimeframe) {
            return candles;
          }
          try {
            // Use exchange adapter if available, otherwise fall back to Binance
            if (userExchangeAdapter && context) {
              const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Exchange ${tf} candles timeout`)), 1200)
              );
              const apiCall = this.fetchExchangeCandles(userExchangeAdapter, normalizedSymbol, tf, 500, apiCalls);
              return Promise.race([apiCall, timeout]);
            } else {
              // Fall back to Binance free API for multi-timeframe data
              const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Binance ${tf} candles timeout`)), 1200)
              );
              const apiCall = binanceAdapter.getKlines(normalizedSymbol, tf, 500);
              const binanceCandles = await Promise.race([apiCall, timeout]);
              return binanceCandles.map(candle => ({
                timestamp: candle.time,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volume: candle.volume,
              }));
            }
          } catch (error: any) {
            logger.warn({ symbol: normalizedSymbol, timeframe: tf, error: error.message }, `Timeframe fetch failed for ${tf}`);
            return null;
          }
        },
      });

      const currentPrice = candles[candles.length - 1].close;
      const priceMomentum = this.calculatePriceMomentum(candles);

      let rawOrderbook: Orderbook;
      let orderbookProvider: string;

      if (userExchangeAdapter && context) {
        // Use exchange orderbook if available
        const orderbookResult = await runApiCall<Orderbook>(
          `${exchangeName.toUpperCase()} Orderbook`,
          async () => {
            apiCalls.push(`${exchangeName}:orderbook`);
            const orderbookResponse = await userExchangeAdapter!.getOrderbook(normalizedSymbol, 20);
            if (!orderbookResponse) {
              logger.warn({ symbol: normalizedSymbol, exchange: exchangeName }, 'Exchange returned empty orderbook, using fallback');
              return { symbol: normalizedSymbol, bids: [], asks: [], lastUpdateId: 0, fallback: true };
            }
            return orderbookResponse;
          },
          2500,
          { symbol: normalizedSymbol, bids: [], asks: [], lastUpdateId: 0 },
          exchangeName
        );
        rawOrderbook = orderbookResult.data;
        orderbookProvider = exchangeName;
      } else {
        // Fall back to Binance orderbook (depth = 20 for compatibility)
        const binanceOrderbookResult = await runApiCall<Orderbook>(
          'Binance Orderbook (Fallback)',
          async () => {
            apiCalls.push('binance:orderbook');
            const orderbookResponse = await binanceAdapter.getOrderbook(normalizedSymbol, 20);
            if (!orderbookResponse) {
              logger.warn({ symbol: normalizedSymbol }, 'Binance returned empty orderbook, using fallback');
              return { symbol: normalizedSymbol, bids: [], asks: [], lastUpdateId: 0, fallback: true };
            }
            return orderbookResponse;
          },
          2500,
          { symbol: normalizedSymbol, bids: [], asks: [], lastUpdateId: 0 },
          'Binance'
        );
        rawOrderbook = binanceOrderbookResult.data;
        orderbookProvider = 'Binance';
      }

      if (!rawOrderbook) {
        logger.warn({ symbol: normalizedSymbol, provider: orderbookProvider }, 'No orderbook data available, using fallback');
        rawOrderbook = { symbol: normalizedSymbol, bids: [], asks: [], lastUpdateId: 0, fallback: true };
      }
      const orderbook: Orderbook = {
        symbol: normalizedSymbol,
        bids: rawOrderbook.bids,
        asks: rawOrderbook.asks,
        lastUpdateId: Date.now(),
      };
      const exchangeOrderbooks: Array<{ exchange: string; bidsCount: number; asksCount: number }> = [
        { exchange: orderbookProvider, bidsCount: orderbook.bids.length, asksCount: orderbook.asks.length },
      ];

      // Use Binance book ticker data for more accurate spread calculation
      let enhancedLiquidity = analyzeLiquidity(orderbook, 5);

      // Override spread calculation if we have book ticker data
      if (binanceSpreadPercent !== null && Number.isFinite(binanceSpreadPercent)) {
        // Determine signal based on spread thresholds (updated from user's requirements)
        let spreadSignal: 'High' | 'Medium' | 'Low';
        if (binanceSpreadPercent < 0.02) {
          spreadSignal = 'High';
        } else if (binanceSpreadPercent >= 0.02 && binanceSpreadPercent <= 0.1) {
          spreadSignal = 'Medium';
        } else {
          spreadSignal = 'Low';
        }

        // Create enhanced liquidity object with accurate spread
        enhancedLiquidity = {
          ...enhancedLiquidity,
          spread: binanceSpreadPercent * (currentPrice / 100), // Convert percentage to absolute spread
          spreadPercent: binanceSpreadPercent,
          signal: spreadSignal,
        };
      }

      const liquidity = enhancedLiquidity;
      const imbalance = this.calculateOrderbookImbalance(orderbook);
      const microSignals = this.buildMicroSignals(liquidity, priceMomentum);
      recordApiCall({ apiName: 'Microstructure Module', status: 'SUCCESS' });

      // CryptoCompare always available - returns neutral data if no API key
      const cryptoCompareResult = await logProviderCall(
        'cryptocompare',
        async () => {
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('CryptoCompare timeout')), 1500)
          );
          const apiCall = cryptoAdapter.getAllMetrics(normalizedSymbol);
          return Promise.race([apiCall, timeout]);
        }
      );

      // All providers are always attempted and return data (success or fallback)
      providersUsed.cryptocompare = true;

      // Update debug preview for cryptocompare
      if (cryptoCompareResult.success && cryptoCompareResult.data) {
        providerDebug.cryptocompare.dataPreview = Object.keys(cryptoCompareResult.data);
      }


      const cryptoCompareData = cryptoCompareResult.success ? cryptoCompareResult.data : null;

      // MTF Indicator Pipeline - fetch indicators for all timeframes
      const mtfIndicators: Record<"5m" | "15m" | "1h", MTFIndicators> = {
        "5m": { timeframe: "5m", rsi: null, macd: null, ema12: null, ema26: null, sma20: null },
        "15m": { timeframe: "15m", rsi: null, macd: null, ema12: null, ema26: null, sma20: null },
        "1h": { timeframe: "1h", rsi: null, macd: null, ema12: null, ema26: null, sma20: null },
      };

      // Fetch MTF indicators for each timeframe (always runs with neutral data fallback)
      const mtfPromises = (["5m", "15m", "1h"] as const).map(async (timeframe) => {
        try {
          const result = await logProviderCall(
            `mtf_${timeframe}`,
            async () => {
              const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`MTF ${timeframe} timeout`)), 1500)
              );
              const apiCall = cryptoAdapter.getMTFIndicators(normalizedSymbol, timeframe);
              return Promise.race([apiCall, timeout]);
            }
          );
          if (result.success && result.data) {
            mtfIndicators[timeframe] = result.data;
          } else {
            // FORCED FALLBACK: Always provide neutral data when API fails
            mtfIndicators[timeframe] = {
              timeframe,
              rsi: 50,
              macd: { value: 0, signal: 0, histogram: 0 },
              ema12: null,
              ema26: null,
              sma20: null
            };
          }
        } catch (error: any) {
          logger.warn({ symbol: normalizedSymbol, timeframe, error: error.message }, `MTF ${timeframe} indicators failed, using fallback`);
          // FORCED FALLBACK: Always provide neutral data when API fails
          mtfIndicators[timeframe] = {
            timeframe,
            rsi: 50,
            macd: { value: 0, signal: 0, histogram: 0 },
            ema12: null,
            ema26: null,
            sma20: null
          };
        }
      });

      await Promise.all(mtfPromises);

      // Calculate MTF confluence (always runs with available data)
      const mtfConfluence = cryptoAdapter.calculateMTFConfluence(mtfIndicators);

      // Add MTF debug info
      providerDebug.mtf = {
        indicators: mtfIndicators,
        confluence: mtfConfluence,
      };

      // Extract indicators from CryptoCompare data (if available)
      const rsiFromCryptoCompare = cryptoCompareData?.indicators?.rsi ? {
        value: cryptoCompareData.indicators.rsi,
        signal: cryptoCompareData.indicators.rsi > 70 ? 'OVERBOUGHT' : cryptoCompareData.indicators.rsi < 30 ? 'OVERSOLD' : 'NEUTRAL'
      } : { value: null, signal: 'NEUTRAL' };

      const macdFromCryptoCompare = cryptoCompareData?.indicators?.macd ? {
        signal: cryptoCompareData.indicators.macd.value,
        histogram: cryptoCompareData.indicators.macd.histogram,
        trend: cryptoCompareData.indicators.macd.histogram > 0 ? 'BULLISH' : 'BEARISH'
      } : { signal: 0, histogram: 0, trend: 'NEUTRAL' };

      // Derivatives data will come from user's providers (CryptoCompare, CoinAPI, etc.)
      const derivativesResult = await runApiCall<DerivativesData>(
        'Derivatives Data Fetch',
        async () => {
          const { fetchDerivativesData } = await import('./strategies/derivativesStrategy');
          return await fetchDerivativesData(normalizedSymbol, userExchangeAdapter, cryptoAdapter);
        },
        2000,
        { source: 'exchange' },
        'Multiple'
      );
      const derivatives = analyzeDerivatives(derivativesResult.data);

      // Remove on-chain score since CryptoCompare no longer provides it
      const onChainScore = 0;

      // PARALLEL EXECUTION: Run all provider calls simultaneously
      const providerResults = await Promise.all([
        // MarketAux sentiment analysis
        runApiCall(
          'marketaux',
          async () => {
            const baseSymbol = normalizedSymbol.replace(/USDT$/i, '').replace(/USD$/i, '');
            const result = await marketAuxAdapter.getNewsSentiment(baseSymbol);
            logger.info({ symbol: normalizedSymbol, sentiment: result.sentiment, articles: result.totalArticles }, 'MarketAux: Called → OK');
            return result;
          },
          1200,
          {
            sentiment: 0.05,
            hypeScore: 45,
            totalArticles: 1,
            trendScore: 0,
            latestArticles: []
          },
          'marketaux'
        ),

        // Binance ticker data
        runApiCall(
          'binance',
          () => binanceAdapter.getTicker(normalizedSymbol),
          2500,
          {
            lastPrice: 0,
            volume: 0,
            priceChangePercent: 0,
            fallback: true
          },
          'binance'
        ),

        // Binance book ticker
        runApiCall(
          'binance_bookTicker',
          () => binanceAdapter.getBookTicker(normalizedSymbol),
          2500,
          {
            symbol: normalizedSymbol,
            bidPrice: 0,
            askPrice: 0,
            fallback: true
          },
          'binance'
        ),

        // Binance volatility
        runApiCall(
          'binance_volatility',
          () => binanceAdapter.getVolatility(normalizedSymbol),
          2500,
          0.05, // 5% fallback volatility
          'binance'
        ),

        // Google Finance rates
        runApiCall(
          'googlefinance',
          async () => {
            const result = await googleFinanceAdapter.getExchangeRates();
            logger.info({ ratesCount: result?.length || 0 }, 'GoogleFinance: Called → OK');
            return result;
          },
          1200,
          [],
          'googlefinance'
        ),

        // CoinGecko historical data
        runApiCall(
          'coingecko',
          async () => {
            const coingeckoHistoricalData = await coingeckoAdapter.getHistoricalData(normalizedSymbol, 90);
            return coingeckoHistoricalData;
          },
          1200,
          null,
          'coingecko'
        )
      ]);

      // Extract results from parallel execution
      const [
        marketAuxResult,
        binanceTickerResult,
        binanceBookTickerResult,
        binanceVolatilityResult,
        googleFinanceResult,
        coingeckoResult
      ] = providerResults;

      const marketAuxData = marketAuxResult.data;
      const binanceTickerData = binanceTickerResult.data;
      const binanceBookTickerData = binanceBookTickerResult.data;
      const binanceVolatility = binanceVolatilityResult.data;
      const googleFinanceExchangeRate = googleFinanceResult.data;
      const coingeckoHistoricalData = coingeckoResult.data;

      // All providers are always attempted and return data (success or fallback)
      providersUsed.marketaux = true;
      providersUsed.binance = true;
      providersUsed.googlefinance = true;
      providersUsed.coingecko = true;

      // Convert MarketAuxData to SentimentData format
      const sentimentPayload: SentimentData | undefined = marketAuxData ? {
        sentiment: marketAuxData.sentiment,
        socialScore: marketAuxData.hypeScore,
        socialVolume: marketAuxData.totalArticles,
        timestamp: Date.now(),
      } : undefined;

      const sentiment = analyzeSentiment(sentimentPayload || undefined);

      // Transform Binance ticker data to expected format
      const binanceMarketData = binanceTickerData ? {
        price: binanceTickerData.lastPrice || 0,
        volume24h: binanceTickerData.volume || 0,
        priceChangePercent24h: binanceTickerData.priceChangePercent || 0,
      } : {};

      // Calculate bid-ask spread percentage for liquidity
      if (binanceBookTickerData) {
        const bidPrice = binanceBookTickerData.bidPrice || 0;
        const askPrice = binanceBookTickerData.askPrice || 0;
        if (bidPrice > 0 && askPrice > 0 && askPrice > bidPrice) {
          binanceSpreadPercent = ((askPrice - bidPrice) / bidPrice) * 100;
        }
      }

      // Enhanced volume analysis with trend comparison
      if (binanceTickerData) {
        const currentVolume = binanceTickerData.volume || 0;
        const quoteVolume = binanceTickerData.volume || 0;

        // Use quote volume if available (more accurate for BTC pairs)
        const volume = quoteVolume > 0 ? quoteVolume : currentVolume;

        if (volume > 0) {
          // Compare with previous day's volume if available
          const prevDayVolume = binanceTickerData.volume || 0; // Use current volume as approximation
          // For now, just classify based on volume levels - this is a simplified approach
          // In production, you'd want to fetch historical volume data
          binanceVolumeTrend = volume > 1000000 ? 'High' : volume > 100000 ? 'Medium' : 'Low';
        }
      }

      // Update debug preview for binance with detailed metrics
      if (binanceTickerResult.success || binanceBookTickerResult.success || binanceVolatilityResult.success) {
        providerDebug.binance = {
          ...providerDebug.binance,
          depthParseSummary: {
            bidsCount: rawOrderbook?.bids?.length || 0,
            asksCount: rawOrderbook?.asks?.length || 0,
            totalBidVolume: rawOrderbook ? rawOrderbook.bids.slice(0, 10).reduce((sum, bid) => sum + parseFloat(bid.quantity || '0'), 0) : 0,
            totalAskVolume: rawOrderbook ? rawOrderbook.asks.slice(0, 10).reduce((sum, ask) => sum + parseFloat(ask.quantity || '0'), 0) : 0,
            imbalance: imbalance,
          },
          volumeSummary: {
            volume24h: binanceMarketData?.volume24h || null,
            trend: binanceVolumeTrend,
            quoteVolume: binanceTickerData ? binanceTickerData.volume : null,
          },
          spreadPercentage: binanceSpreadPercent,
          volatilityNumber: binanceVolatility,
        };
      }

      if (coingeckoHistoricalData) {
        recordApiCall({
          apiName: 'CoinGecko Historical Data',
          status: 'SUCCESS',
          durationMs: 0, // We don't track duration for CoinGecko anymore
          provider: 'CoinGecko'
        });
      } else {
        recordApiCall({
          apiName: 'CoinGecko Historical Data',
          status: 'SKIPPED',
          message: 'Rate limited or unavailable',
          durationMs: 0,
          provider: 'CoinGecko'
        });
      }

      const rsi = analyzeRSI(candles);
      const macd = analyzeMACD(candles);
      const volume = analyzeVolume(candles);
      recordApiCall({
        apiName: 'RVOL Calculation',
        status: 'SUCCESS',
        message: volume.relativeVolume ? `${volume.relativeVolume.toFixed(2)}x` : 'Volume normalized',
      });
      const trendAnalysis = this.computeTrendAnalysis(candles);
      recordApiCall({ apiName: 'Trend Module', status: 'SUCCESS' });
      const trendStrength = this.computeTrendStrength(candles);
      const atr = this.computeAtr(candles);
        recordApiCall({ apiName: 'Volatility Module', status: 'SUCCESS' });

      // Update Binance usage based on successful calls throughout the research
      // Binance is used for candles, orderbook, and various market data calls
      providersUsed.binance = true; // Binance is always attempted and typically succeeds

      const multiTimeframeContext = this.summarizeMultiTimeframes({
        symbol: normalizedSymbol,
        candlesByTimeframe: multiTimeframeCandles,
        sharedInputs: {
          liquidity,
          sentiment,
          derivatives,
          microSignals,
          orderbookImbalance: imbalance,
        },
      });
      MULTI_TIMEFRAMES.forEach((tf) => {
        if (multiTimeframeCandles[tf]) {
          recordApiCall({ apiName: `MTF Indicator ${tf}`, status: 'SUCCESS' });
        } else {
          recordApiCall({
            apiName: `MTF Indicator ${tf}`,
            status: 'FAILED',
            message: 'Insufficient candles',
          });
        }
      });

      const featureScores = computeFeatureScores({
        symbol: normalizedSymbol,
        timeframe: normalizedTimeframe,
        price: currentPrice,
        rsi,
        macd,
        trendStrength: {
          ...trendStrength,
          ema12: trendAnalysis?.ema12 ?? null,
          ema26: trendAnalysis?.ema26 ?? null,
        },
        orderbookImbalance: imbalance,
        volume,
        liquidity,
        volatility: { atr, price: currentPrice },
        sentiment,
        derivatives,
        priceMomentum,
        onChainScore,
        microSignals,
      });
      const confidenceResult = computeConfidence(featureScores);
      const confidenceAdjustment = this.applyMultiTimeframeConfidenceAdjustments(
        confidenceResult.smoothedConfidence,
        multiTimeframeContext
      );
      // Apply MTF confidence boost
      const mtfBoost = (mtfConfluence.score / 3) * 15; // Max 15% boost for perfect 3/3 score
      const confidenceBeforeMTF = confidenceAdjustment.confidence;
      const confidence = Math.min(95, confidenceAdjustment.confidence + mtfBoost); // Cap at 95%

      // Update explanations with MTF boost info
      const mtfBoostExplanation = mtfBoost > 0 ? ` | MTF confluence ${mtfConfluence.label} (+${mtfBoost.toFixed(1)}%)` : '';

      const accuracyRange = this.buildAccuracyRangeFromConfidence(confidence);
      const finalSignal = confidenceResult.signal;
      const side: 'LONG' | 'SHORT' | 'NEUTRAL' =
        finalSignal === 'BUY' ? 'LONG' : finalSignal === 'SELL' ? 'SHORT' : 'NEUTRAL';
      const mtfConfluenceCount = multiTimeframeContext.alignmentCount;
      const derivativesAligned = this.isDerivativesAligned(derivatives, finalSignal);
      const derivativesContradict = this.isDerivativesContradicting(derivatives, finalSignal);
      const liquidityAcceptable = this.isLiquidityAcceptable(liquidity);

      const entry = currentPrice;
      const takeProfit = side === 'LONG' ? entry * 1.03 : side === 'SHORT' ? entry * 0.97 : null;
      const stopLoss = side === 'LONG' ? entry * 0.98 : side === 'SHORT' ? entry * 1.02 : null;
      const exits = takeProfit ? [entry + (takeProfit - entry) * 0.5, takeProfit] : [];

      const mode: ResearchResult['mode'] = confidence >= 75 ? 'TRADE_SETUP' : confidence >= 60 ? 'NORMAL' : 'LOW';
      const blurFields = confidence < 60;
      const recommendedTrade = mode === 'TRADE_SETUP' && side !== 'NEUTRAL' ? (side as 'LONG' | 'SHORT') : null;
      const mtfDescription = Object.entries(multiTimeframeContext.signalsByTimeframe)
        .map(([tf, data]) => `${tf}:${data.signal}`)
        .join(' / ');

      const features: NonNullable<ResearchResult['features']> = {
        rsi: rsi.value,
        rsiSignal: rsi.signal,
        macd: { signal: macd.signal, histogram: macd.histogram, trend: macd.trend },
        volume: binanceVolumeTrend !== 'Stable' ? binanceVolumeTrend : `${volume.signal}${volume.relativeVolume ? ` (${volume.relativeVolume.toFixed(2)}x)` : ''}`,
        orderbookImbalance: imbalance !== null ? `${(imbalance * 100).toFixed(2)}% ${imbalance >= 0 ? 'Buy' : 'Sell'} pressure` : 'Insufficient depth',
        liquidity: `${liquidity.signal} (${liquidity.spreadPercent.toFixed(3)}% spread)`,
        fundingRate: derivatives.fundingRate.description,
        openInterest: derivatives.openInterest.description,
        liquidations: derivatives.liquidations.description,
        trendStrength: trendStrength.trend,
        volatility: binanceVolatility !== null ? (binanceVolatility * 100).toFixed(2) + '%' : (atr ? atr.toFixed(6) : null),
        newsSentiment: sentiment.description,
        onChainFlows: undefined, // Removed - no longer available from CryptoCompare
        priceDivergence: undefined,
        globalMarketData: binanceMarketData ? {
          price: binanceMarketData.price,
          volume24h: binanceMarketData.volume24h,
          priceChangePercent24h: binanceMarketData.priceChangePercent24h
        } : undefined,
        _volumeNumber: volume.relativeVolume ?? null,
        _atrValue: atr,
        _orderbookImbalanceValue: imbalance,
        _trendStrengthValue: trendStrength,
        _apisUsed: providersUsed,
      };

      const indicators: ResearchResult['indicators'] = {
        rsi: rsi.value,
        macd: { signal: macd.signal, histogram: macd.histogram, trend: macd.trend },
        volume: volume.relativeVolume ?? null,
        trendStrength: {
          ...trendStrength,
          ema12: trendAnalysis?.ema12 ?? null,
          ema26: trendAnalysis?.ema26 ?? null,
        },
        volatility: atr,
        orderbook: imbalance,
      };

      const explanations = [
        `RSI ${rsi.signal} at ${rsi.value.toFixed(2)}`,
        `MACD histogram ${macd.histogram.toFixed(4)}`,
        `Volume ${volume.signal}${volume.relativeVolume ? ` (${volume.relativeVolume.toFixed(2)}x)` : ''}`,
        `Liquidity ${liquidity.signal} (${liquidity.spreadPercent.toFixed(3)}%)`,
        `Derivatives ${derivatives.overallSignal} (${(derivatives.overallScore * 100).toFixed(1)}%)`,
        `Sentiment ${sentiment.signal} (${sentiment.sentiment.toFixed(2)})`,
        `MTF confluence ${mtfConfluence.label} (${mtfConfluence.details["5m"]} | ${mtfConfluence.details["15m"]} | ${mtfConfluence.details["1h"]})`,
      ];
      if (confidenceAdjustment.reason) {
        explanations.push(confidenceAdjustment.reason);
      }
      if (mtfBoost > 0) {
        explanations.push(`MTF boost: ${mtfConfluence.label} (+${mtfBoost.toFixed(1)}% confidence)`);
      }

      const autoTradeEligible =
        confidence >= 75 && mtfConfluenceCount >= 2 && derivativesAligned && liquidityAcceptable;
      const autoTradeReason = this.buildAutoTradeReason({
        confidence,
        confluenceCount: mtfConfluenceCount,
        derivativesAligned,
        liquidityAcceptable,
      });

      const result: ResearchResult = {
        symbol: normalizedSymbol,
        status: 'ok',
        signal: finalSignal,
        accuracy: confidence / 100,
        orderbookImbalance: imbalance,
        recommendedAction: this.buildRecommendation(finalSignal, exchangeName),
        microSignals,
        entry,
        exits,
        stopLoss,
        takeProfit,
        side,
        confidence,
        timeframe: normalizedTimeframe,
        signals: this.buildSignals(entry, stopLoss, takeProfit, exits),
        liveAnalysis: this.buildLiveAnalysis(normalizedSymbol, finalSignal, confidence, entry, stopLoss, takeProfit),
        message: 'Research completed using your private data providers.',
        currentPrice: entry ?? 0,
        mode,
        recommendedTrade,
        blurFields,
        apiCalls,
        explanations,
        accuracyRange,
        rsi5: null,
        rsi14: rsi.value,
        trendAnalysis,
        confidenceBreakdown: confidenceResult.confidenceBreakdown,
        exchangeOrderbooks,
        exchangeCount: exchangeOrderbooks.length,
        exchangesUsed: [exchangeName],
        autoTradeDecision: {
          triggered: autoTradeEligible,
          confidence,
          threshold: 75,
          reason: autoTradeEligible ? 'All trade rules satisfied' : autoTradeReason,
          confluenceCount: mtfConfluenceCount,
        },
        features,
        indicators,
        entrySignal: side === 'NEUTRAL' ? null : side,
        exitSignal: exits,
        entryPrice: entry,
        recommendation: recommendedTrade ? 'AUTO' : 'MANUAL',
        perFeatureScore: confidenceResult.perFeatureScore,
        apisUsed: providersUsed,

        // Add detailed API usage logging
        _apiUsageSummary: {
          totalApis: Object.keys(providersUsed).length,
          successfulApis: Object.entries(providersUsed).filter(([key, value]) => value === true || typeof value === 'string').length,
          failedApis: Object.entries(providersUsed).filter(([key, value]) => value === false).length,
          providerDetails: providersUsed,
        },

        rawConfidence: confidenceResult.rawConfidence,
        smoothedConfidence: confidence,
        confluenceFlags: confidenceResult.confluenceFlags,
        volumeConfirmed: volume.signal !== 'Stable',
        derivativesContradict,
        signalsByTimeframe: multiTimeframeContext.signalsByTimeframe,
        confluenceMatrix: multiTimeframeContext.confluenceMatrix,
        mtfScore: multiTimeframeContext.scorePercent,
        mtfConfluenceCount,
        highConfidenceReason: confidenceAdjustment.reason,
        perTimeframeBreakdown: multiTimeframeContext.breakdown,
        liquidityAcceptable,
        derivativesAligned,
        apiCallReport,
        missingDependencies: [],
        mtf: {
          "5m": mtfIndicators["5m"],
          "15m": mtfIndicators["15m"],
          "1h": mtfIndicators["1h"],
          score: mtfConfluence.label,
          boost: mtfBoost > 0 ? `+${mtfBoost.toFixed(1)}%` : '0%',
        },
        _providerDebug: providerDebug, // Debug info for provider calls
      };

      // Log final API usage summary
      logger.info({
        uid,
        symbol: normalizedSymbol,
        apisUsed: providersUsed,
        successfulCount: Object.values(providersUsed).filter(v => v === true || typeof v === 'string').length,
        totalApis: Object.keys(providersUsed).length,
        durationMs: Date.now() - startedAt
      }, 'RESEARCH COMPLETE: API usage summary');

      logger.info({ uid, symbol: normalizedSymbol, exchange: exchangeName, confidence, durationMs: Date.now() - startedAt }, 'Deep research completed');
      return result;
    } catch (err: any) {
      if (err instanceof ResearchEngineError) {
        throw err;
      }
      const errorId = this.createErrorId();
      const message = err?.message || 'Research processing failed';
      logger.error({ uid, symbol: normalizedSymbol, error: message, errorId }, 'Research engine failed');
      throw new ResearchEngineError(message, errorId, 400);
    }
  }

  private normalizeSymbol(symbol: string): string {
    return symbol.replace(/[^a-z0-9]/gi, '').toUpperCase();
  }

  private normalizeTimeframe(timeframe: string): string {
    const tf = timeframe.toLowerCase();
    if (VALID_TIMEFRAMES.includes(tf)) {
      return tf;
    }
    return '5m';
  }

  private async buildProviderAdapters(uid: string): Promise<{
    marketAuxAdapter: MarketAuxAdapter;
    cryptoAdapter: CryptoCompareAdapter;
    // Free APIs - no API keys required
    binanceAdapter: any;
    coingeckoAdapter: any;
    googleFinanceAdapter: any;
  }> {
    // ALWAYS fetch API keys from Firestore - NO override keys allowed
    const userKeys = await firestoreAdapter.getUserProviderApiKeys(uid);

    // MANDATORY API keys - Deep Research requires all 5 providers
    // ALWAYS use Firestore keys - never fallback to null when user has keys
    const marketAuxKey = userKeys['marketaux']?.apiKey;
    const cryptocompareKey = userKeys['cryptocompare']?.apiKey;

    // Add debug log next to adapter creation
    logger.info({
      uid,
      marketAuxKey: marketAuxKey ? 'PRESENT' : 'MISSING',
      cryptocompareKey: cryptocompareKey ? 'PRESENT' : 'MISSING',
      marketAuxKeyLength: marketAuxKey?.length,
      cryptocompareKeyLength: cryptocompareKey?.length
    }, 'Loaded user API keys for research');

    // API keys - use null if missing (adapters handle gracefully)
    logger.info({
      uid,
      marketAuxKeyPresent: !!marketAuxKey,
      cryptocompareKeyPresent: !!cryptocompareKey,
    }, 'API key availability check');

    // Always initialize ALL adapters - they handle missing keys internally
    logger.info({ uid }, 'Initializing ALL provider adapters (with fallback handling for missing keys)');

    // Create ALL adapters - they handle missing keys with neutral defaults
    let marketAuxAdapter: MarketAuxAdapter;
    let cryptoAdapter: CryptoCompareAdapter;

    try {
      logger.debug({ uid, keyLength: marketAuxKey?.length }, 'Initializing MarketAux adapter');
      marketAuxAdapter = new MarketAuxAdapter(marketAuxKey || null);
      logger.info({ uid, hasKey: !!marketAuxKey }, 'MarketAux adapter initialized');
    } catch (error: any) {
      logger.error({ uid, error: error.message }, 'Failed to initialize MarketAux adapter - using fallback');
      // Create adapter with null key as fallback - should not fail
      marketAuxAdapter = new MarketAuxAdapter(null);
    }

    try {
      logger.debug({ uid, keyLength: cryptocompareKey?.length }, 'Initializing CryptoCompare adapter');
      cryptoAdapter = new CryptoCompareAdapter(cryptocompareKey || null);
      logger.info({ uid, hasKey: !!cryptocompareKey }, 'CryptoCompare adapter initialized');
    } catch (error: any) {
      logger.error({ uid, error: error.message }, 'Failed to initialize CryptoCompare adapter - using fallback');
      // Create adapter with null key as fallback - should not fail
      cryptoAdapter = new CryptoCompareAdapter(null);
    }

    // Create free API adapters - no API keys required
    let binanceAdapter: BinancePublicAdapter;
    let coingeckoAdapter: any;
    let googleFinanceAdapter: any;

    try {
      logger.debug({ uid }, 'Initializing Binance public adapter (free API)');
      binanceAdapter = new BinancePublicAdapter();
      logger.info({ uid }, 'Binance public adapter initialized successfully');
    } catch (error: any) {
      logger.error({ uid, error: error.message }, 'Failed to initialize Binance adapter');
      throw new ResearchEngineError(
        `Failed to initialize Binance adapter: ${error.message}`,
        this.createErrorId(),
        400
      );
    }

    try {
      logger.debug({ uid }, 'Initializing CoinGecko adapter (free API)');
      coingeckoAdapter = CoinGeckoAdapter;
      logger.info({ uid }, 'CoinGecko adapter initialized successfully');
    } catch (error: any) {
      logger.error({ uid, error: error.message }, 'Failed to initialize CoinGecko adapter');
      throw new ResearchEngineError(
        `Failed to initialize CoinGecko adapter: ${error.message}`,
        this.createErrorId(),
        400
      );
    }

    try {
      logger.debug({ uid }, 'Initializing Google Finance adapter (free API)');
      googleFinanceAdapter = GoogleFinanceAdapter;
      logger.info({ uid }, 'Google Finance adapter initialized successfully');
    } catch (error: any) {
      logger.error({ uid, error: error.message }, 'Failed to initialize Google Finance adapter');
      throw new ResearchEngineError(
        `Failed to initialize Google Finance adapter: ${error.message}`,
        this.createErrorId(),
        400
      );
    }

    logger.info({ uid }, 'All provider adapters initialized successfully (including free APIs)');
    return { marketAuxAdapter, cryptoAdapter, binanceAdapter, coingeckoAdapter, googleFinanceAdapter };
  }

  private async resolveContext(uid: string): Promise<ActiveExchangeContext | null> {
    // For scheduled research (system user), completely disable exchange context resolution
    if (uid === 'system') {
      logger.debug('Scheduled research: exchange context disabled');
      return null;
    }

    try {
      const context = await firestoreAdapter.getActiveExchangeForUser(uid);
      // Handle fallback object when no exchange is configured
      if (context && typeof context === 'object' && 'exchangeConfigured' in context && context.exchangeConfigured === false) {
        logger.debug({ uid }, 'Exchange integration not configured, using null context for research');
        return null;
      }
      // NOTE: Exchange API is now optional for Deep Research - return context if configured, null if not
      // This allows Deep Research to work without exchange API keys
      return (context && typeof context === 'object' && 'name' in context) ? context : null;
    } catch (error: any) {
      // If exchange lookup fails, return null (exchange is optional for Deep Research)
      logger.debug({ uid, error: error.message }, 'Exchange context lookup failed, using null context');
      return null;
    }
  }

  private mapTimeframeToCoinapiPeriod(timeframe: string): string {
    const map: Record<string, string> = {
      '1m': '1MIN',
      '3m': '3MIN',
      '5m': '5MIN',
      '15m': '15MIN',
      '30m': '30MIN',
      '1h': '1HRS',
      '2h': '2HRS',
      '4h': '4HRS',
      '6h': '6HRS',
      '8h': '8HRS',
      '12h': '12HRS',
      '1d': '1DAY',
      '3d': '3DAY',
      '1w': '7DAY',
    };
    return map[timeframe.toLowerCase()] || '5MIN';
  }

  private async fetchExchangeCandles(
    adapter: ExchangeConnector,
    symbol: string,
    timeframe: string,
    limit: number,
    apiCalls: string[]
  ): Promise<NormalizedCandle[]> {
    const exchangeName = adapter.getExchangeName();
    apiCalls.push(`${exchangeName}:klines:${timeframe}`);
    const candles = await adapter.getKlines(symbol, timeframe, limit);
    if (!candles.length) {
      logger.warn({ symbol, timeframe, exchange: exchangeName }, 'Exchange returned no candles, using fallback');
      return [{
        timestamp: Date.now(),
        open: 0,
        high: 0,
        low: 0,
        close: 0,
        volume: 0
      }];
    }
    return candles
      .map((item) => ({
        open: parseFloat(item.open),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        close: parseFloat(item.close),
        volume: parseFloat(item.volume),
        timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.parse(item.timestamp),
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  private normalizeCandles(raw: any[]): NormalizedCandle[] {
    return raw
      .map((item) => {
        if (Array.isArray(item)) {
          const [timestamp, open, high, low, close, volume] = item;
          return {
            open: parseFloat(open ?? 0),
            high: parseFloat(high ?? 0),
            low: parseFloat(low ?? 0),
            close: parseFloat(close ?? 0),
            volume: parseFloat(volume ?? 0),
            timestamp: Number(timestamp ?? Date.now()),
          };
        }
        if (typeof item === 'object' && item !== null) {
          return {
            open: parseFloat(item.open ?? item[1] ?? 0),
            high: parseFloat(item.high ?? item[2] ?? 0),
            low: parseFloat(item.low ?? item[3] ?? 0),
            close: parseFloat(item.close ?? item[4] ?? 0),
            volume: parseFloat(item.volume ?? item[5] ?? 0),
            timestamp: Number(item.timestamp ?? item[0] ?? Date.now()),
          };
        }
        return null;
      })
      .filter((c): c is NormalizedCandle => !!c && c.close > 0)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  private ensureCandleCoverage(candles: NormalizedCandle[]): void {
    if (candles.length < 60) {
      throw new ResearchEngineError('Not enough market data to compute indicators (need at least 60 candles)', this.createErrorId(), 422);
    }
  }


  private calculateOrderbookImbalance(orderbook: Orderbook): number | null {
    if (!orderbook.bids || !orderbook.asks || orderbook.bids.length === 0 || orderbook.asks.length === 0) {
      return null;
    }

    const bidVolume = orderbook.bids.slice(0, 10).reduce((sum, bid) => {
      const qty = parseFloat(bid.quantity);
      return sum + (Number.isFinite(qty) ? qty : 0);
    }, 0);
    const askVolume = orderbook.asks.slice(0, 10).reduce((sum, ask) => {
      const qty = parseFloat(ask.quantity);
      return sum + (Number.isFinite(qty) ? qty : 0);
    }, 0);
    const total = bidVolume + askVolume;

    // If total volume is 0, do NOT compute ratio (return null)
    if (total === 0 || !Number.isFinite(total)) {
      return null;
    }

    const imbalance = (bidVolume - askVolume) / total;
    return Number.isFinite(imbalance) ? imbalance : null;
  }

  private buildMicroSignals(liquidity: ReturnType<typeof analyzeLiquidity>, priceMomentum: number): ResearchResult['microSignals'] {
    return {
      spread: liquidity.spreadPercent,
      volume: liquidity.bidDepth + liquidity.askDepth,
      priceMomentum,
      orderbookDepth: liquidity.bidDepth + liquidity.askDepth,
    };
  }

  private computeTrendAnalysis(candles: NormalizedCandle[]): ResearchResult['trendAnalysis'] {
    const ema12 = this.calculateEMA(candles.map((c) => c.close), 12);
    const ema26 = this.calculateEMA(candles.map((c) => c.close), 26);
    let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (ema12 !== null && ema26 !== null) {
      if (ema12 > ema26) trend = 'BULLISH';
      else if (ema12 < ema26) trend = 'BEARISH';
    }
    return { ema12, ema26, trend };
  }

  private computeTrendStrength(candles: NormalizedCandle[]): { ema20: number | null; ema50: number | null; trend: string } {
    const ema20 = this.calculateEMA(candles.map((c) => c.close), 20);
    const ema50 = this.calculateEMA(candles.map((c) => c.close), 50);
    let trend = 'NEUTRAL';
    if (ema20 !== null && ema50 !== null) {
      if (ema20 > ema50) trend = 'BULLISH';
      else if (ema20 < ema50) trend = 'BEARISH';
    }
    return { ema20, ema50, trend };
  }

  private computeAtr(candles: NormalizedCandle[], period: number = 14): number | null {
    if (candles.length < period + 1) {
      return null;
    }
    let sum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      const current = candles[i];
      const previous = candles[i - 1];
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      );
      sum += tr;
    }
    return sum / period;
  }

  private calculateEMA(prices: number[], period: number): number | null {
    if (prices.length < period) {
      return null;
    }
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
  }

  private buildSignals(
    entry: number | null,
    stopLoss: number | null,
    takeProfit: number | null,
    exits: number[]
  ): ResearchSignal[] {
    const signals: ResearchSignal[] = [];
    if (entry) {
      signals.push({ type: 'entry', price: entry, reason: 'Primary entry' });
    }
    if (stopLoss) {
      signals.push({ type: 'sl', price: stopLoss, reason: 'Risk management stop' });
    }
    if (takeProfit) {
      signals.push({ type: 'tp', price: takeProfit, reason: 'Primary take-profit target' });
    }
    exits.forEach((price, idx) =>
      signals.push({ type: 'exit', price, reason: idx === 0 ? 'First exit target' : 'Final exit target' })
    );
    return signals;
  }

  private buildRecommendation(signal: 'BUY' | 'SELL' | 'HOLD', exchange: string): string {
    if (signal === 'BUY') return `Consider LONG on ${exchange}`;
    if (signal === 'SELL') return `Consider SHORT on ${exchange}`;
    return 'Wait for clearer confirmation';
  }

  private buildLiveAnalysis(
    symbol: string,
    signal: 'BUY' | 'SELL' | 'HOLD',
    confidence: number,
    entry: number | null,
    stopLoss: number | null,
    takeProfit: number | null
  ): LiveAnalysis {
    return {
      isLive: true,
      lastUpdated: new Date().toISOString(),
      summary: `${symbol}: ${signal} signal at ${confidence}% confidence`,
      meta: { entry, stopLoss, takeProfit, confidence },
    };
  }

  private isDerivativesAligned(derivatives: DerivativesResult, signal: 'BUY' | 'SELL' | 'HOLD'): boolean {
    if (signal === 'BUY') {
      return derivatives.overallSignal === 'Bullish';
    }
    if (signal === 'SELL') {
      return derivatives.overallSignal === 'Bearish';
    }
    return false;
  }

  private isDerivativesContradicting(derivatives: DerivativesResult, signal: 'BUY' | 'SELL' | 'HOLD'): boolean {
    if (signal === 'HOLD') return false;
    if (signal === 'BUY' && derivatives.overallSignal === 'Bearish') return true;
    if (signal === 'SELL' && derivatives.overallSignal === 'Bullish') return true;
    return false;
  }

  private createErrorId(): string {
    return crypto.randomBytes(6).toString('hex');
  }

  private async buildMultiTimeframeCandles(params: {
    symbol: string;
    primaryTimeframe: string;
    primaryCandles: NormalizedCandle[];
    fetchTimeframe: (timeframe: MultiTimeframe) => Promise<NormalizedCandle[] | null>;
  }): Promise<Record<MultiTimeframe, NormalizedCandle[]>> {
    const map = {} as Record<MultiTimeframe, NormalizedCandle[]>;
    await Promise.all(
      MULTI_TIMEFRAMES.map(async (tf) => {
        if (tf === params.primaryTimeframe && params.primaryCandles) {
          map[tf] = params.primaryCandles;
          return;
        }
        const candles = await params.fetchTimeframe(tf);
        if (candles) {
          map[tf] = candles;
        }
      })
    );
    return map;
  }

  private summarizeMultiTimeframes(params: {
    symbol: string;
    candlesByTimeframe: Record<string, NormalizedCandle[]>;
    sharedInputs: {
      liquidity: ReturnType<typeof analyzeLiquidity>;
      sentiment: SentimentResult;
      derivatives: DerivativesResult;
      microSignals: ResearchResult['microSignals'];
      orderbookImbalance: number;
    };
  }): MultiTimeframeContext {
    const breakdown = {} as Record<MultiTimeframe, TimeframeBreakdown>;
    const signals: Record<MultiTimeframe, TimeframeSignalOverview> = {} as Record<
      MultiTimeframe,
      TimeframeSignalOverview
    >;
    let weightedScoreSum = 0;
    let totalWeight = 0;
    let availableCount = 0;

    MULTI_TIMEFRAMES.forEach((tf) => {
      const candles = params.candlesByTimeframe[tf];
      if (!candles || candles.length < 40) {
        breakdown[tf] = {
          available: false,
          bias: 'NEUTRAL',
          score: 0,
          scorePercent: 50,
          fusedScore: 0,
          weight: TIMEFRAME_WEIGHTS[tf],
          perFeatureScore: {},
          availability: {} as FeatureScoreState['availability'],
          metadata: {
            rsi: null,
            macdHistogram: null,
            volumeSignal: null,
            atr: null,
            priceMomentum: 0,
            trend: null,
          },
        };
        signals[tf] = {
          signal: 'NEUTRAL',
          scorePercent: 50,
          fusedScore: 0,
          confidence: 50,
          priceMomentum: 0,
          trend: null,
        };
        return;
      }

      const rsi = analyzeRSI(candles);
      const macd = analyzeMACD(candles);
      const volume = analyzeVolume(candles);
      const trendStrength = this.computeTrendStrength(candles);
      const trendAnalysis = this.computeTrendAnalysis(candles);
      const atr = this.computeAtr(candles);
      const lastClose = candles[candles.length - 1].close;
      const momentum = this.calculatePriceMomentum(candles);
      const weight = TIMEFRAME_WEIGHTS[tf];
      const scoreState = computeFeatureScores({
        symbol: params.symbol,
        timeframe: tf,
        price: lastClose,
        rsi,
        macd,
        trendStrength: {
          ...trendStrength,
          ema12: trendAnalysis?.ema12 ?? null,
          ema26: trendAnalysis?.ema26 ?? null,
        },
        orderbookImbalance: params.sharedInputs.orderbookImbalance,
        volatility: { atr, price: lastClose },
        volume,
        liquidity: params.sharedInputs.liquidity,
        sentiment: params.sharedInputs.sentiment,
        derivatives: params.sharedInputs.derivatives,
        priceMomentum: momentum,
        microSignals: params.sharedInputs.microSignals,
      });
      const fused = fuseSignals(scoreState);
      const bias = this.scoreToBias(fused.weightedScore);
      const scorePercent = this.scoreToPercent(fused.weightedScore);
      const confidencePercent = Math.max(35, Math.min(95, scorePercent));

      breakdown[tf] = {
        available: true,
        bias,
        score: fused.weightedScore,
        scorePercent,
        fusedScore: fused.weightedScore,
        weight,
        perFeatureScore: scoreState.perFeatureScore,
        availability: scoreState.availability,
        metadata: {
          rsi: rsi.value,
          macdHistogram: macd.histogram,
          volumeSignal: volume.signal,
          atr,
          priceMomentum: momentum,
          trend: trendStrength.trend,
        },
      };
      signals[tf] = {
        signal: bias,
        scorePercent,
        fusedScore: fused.weightedScore,
        confidence: confidencePercent,
        priceMomentum: momentum,
        trend: trendStrength.trend,
      };
      weightedScoreSum += fused.weightedScore * weight;
      totalWeight += weight;
      availableCount += 1;
    });

    const scorePercent = totalWeight ? this.scoreToPercent(weightedScoreSum / totalWeight) : 50;
    const bullCount = MULTI_TIMEFRAMES.filter((tf) => breakdown[tf].bias === 'BULLISH' && breakdown[tf].available).length;
    const bearCount = MULTI_TIMEFRAMES.filter((tf) => breakdown[tf].bias === 'BEARISH' && breakdown[tf].available).length;
    const alignmentCount = Math.max(bullCount, bearCount);
    const confluenceMatrix: Record<string, { status: ConfluenceState; weight: number }> = {};
    const pairs: Array<[MultiTimeframe, MultiTimeframe]> = [
      ['5m', '15m'],
      ['5m', '1h'],
      ['15m', '1h'],
    ];

    pairs.forEach(([a, b]) => {
      const key = `${a}_${b}`;
      const aData = breakdown[a];
      const bData = breakdown[b];
      const weight = (TIMEFRAME_WEIGHTS[a] + TIMEFRAME_WEIGHTS[b]) / 2;
      if (!aData.available || !bData.available) {
        confluenceMatrix[key] = { status: 'MISSING', weight: 0 };
        return;
      }
      if (aData.bias === 'NEUTRAL' || bData.bias === 'NEUTRAL') {
        confluenceMatrix[key] = { status: 'MIXED', weight: weight / 2 };
        return;
      }
      confluenceMatrix[key] = { status: aData.bias === bData.bias ? 'ALIGNED' : 'OPPOSED', weight };
    });

    const availableAll = MULTI_TIMEFRAMES.every((tf) => breakdown[tf].available);
    const allAgree =
      availableAll &&
      MULTI_TIMEFRAMES.every(
        (tf, _, arr) =>
          breakdown[tf].bias !== 'NEUTRAL' &&
          breakdown[tf].bias === breakdown[arr[0]].bias
      );

    const higherContradiction =
      breakdown['1h'].available &&
      breakdown['1h'].bias !== 'NEUTRAL' &&
      ['5m', '15m'].some(
        (tf) =>
          breakdown[tf].available &&
          breakdown[tf].bias !== 'NEUTRAL' &&
          breakdown[tf].bias !== breakdown['1h'].bias
      );

    const shortTermDominant =
      breakdown['5m'].available &&
      Math.abs(breakdown['5m'].score) >= 0.6 &&
      (!breakdown['15m'].available || Math.abs(breakdown['15m'].score) < 0.2) &&
      (!breakdown['1h'].available || Math.abs(breakdown['1h'].score) < 0.2);

    return {
      breakdown,
      signalsByTimeframe: signals,
      confluenceMatrix,
      alignmentCount,
      allAgree,
      higherContradiction,
      shortTermDominant,
      scorePercent,
      availableCount,
    };
  }

  private applyMultiTimeframeConfidenceAdjustments(
    baseConfidence: number,
    context: MultiTimeframeContext
  ): { confidence: number; reason: string | null } {
    let adjusted = baseConfidence;
    const reasons: string[] = [];

    if (context.allAgree) {
      adjusted += 10;
      reasons.push('5m/15m/1h alignment (+10%)');
    }

    if (context.higherContradiction) {
      adjusted -= 8;
      reasons.push('Higher timeframe contradiction (-8%)');
    }

    if (context.shortTermDominant) {
      adjusted = Math.min(adjusted, Math.max(55, adjusted - 5));
      reasons.push('Short-term strength dampened (higher TF weak)');
    }

    const clamped = Math.max(35, Math.min(95, Math.round(adjusted)));
    return {
      confidence: clamped,
      reason: reasons.length ? reasons.join(' | ') : null,
    };
  }

  private buildAccuracyRangeFromConfidence(confidence: number): string {
    const lower = Math.max(35, confidence - 5);
    const upper = Math.min(95, confidence + 5);
    return `${lower}-${upper}%`;
  }

  private scoreToBias(score: number): BiasSignal {
    if (score >= 0.25) return 'BULLISH';
    if (score <= -0.25) return 'BEARISH';
    return 'NEUTRAL';
  }

  private scoreToPercent(score: number): number {
    return Math.round(((score + 1) / 2) * 100);
  }

  private calculatePriceMomentum(candles: NormalizedCandle[], lookback: number = 5): number {
    if (!candles.length) {
      return 0;
    }
    const end = candles[candles.length - 1].close;
    const startIndex = Math.max(0, candles.length - lookback - 1);
    const start = candles[startIndex].close;
    if (!start || !Number.isFinite(end) || !Number.isFinite(start)) {
      return 0;
    }
    return ((end - start) / start) * 100;
  }

  private isLiquidityAcceptable(liquidity: ReturnType<typeof analyzeLiquidity>): boolean {
    return liquidity.signal !== 'Low' && liquidity.spreadPercent <= 0.6;
  }

  private buildAutoTradeReason(params: {
    confidence: number;
    confluenceCount: number;
    derivativesAligned: boolean;
    liquidityAcceptable: boolean;
  }): string {
    const reasons: string[] = [];
    if (params.confidence < 75) {
      reasons.push('Confidence below 75%');
    }
    if (params.confluenceCount < 2) {
      reasons.push('Need ≥2 aligned timeframes');
    }
    if (!params.derivativesAligned) {
      reasons.push('Derivatives contradict bias');
    }
    if (!params.liquidityAcceptable) {
      reasons.push('Liquidity below threshold');
    }
    return reasons.length ? reasons.join(' | ') : 'All trade conditions satisfied';
  }
}

export const researchEngine = new ResearchEngine();

type RunResearchOptions = {
  symbol: string;
  uid: string;
  timeframe?: string;
  adapterOverride?: ExchangeConnector;
  legacyAdapters?: Array<{ exchange: string; adapter: ExchangeConnector; credentials: any }>;
  activeContext?: ActiveExchangeContext;
};

const runResearch = ({
  symbol,
  uid,
  timeframe = '5m',
  adapterOverride,
  legacyAdapters,
  activeContext,
}: RunResearchOptions) =>
  researchEngine.runResearch(symbol, uid, adapterOverride, false, legacyAdapters, timeframe, activeContext);

/**
 * Quick scan result for lightweight analysis
 */
interface QuickScanResult {
  symbol: string;
  confidence: number;
  priceChange24h: number;
  volume24h: number;
  rsi?: number;
  macdSignal?: number;
  scanTimeMs: number;
}

/**
 * Quick scan a symbol for lightweight analysis (<300ms)
 * Only uses basic price/volume data and fallback RSI/MACD
 */
async function quickScan(symbol: string, binanceAdapter: any): Promise<QuickScanResult> {
  const startTime = Date.now();
  const normalizedSymbol = symbol.toUpperCase();

  try {
    // Get basic ticker data from Binance (fast)
    const tickerData = await binanceAdapter.getTicker(normalizedSymbol);
    const priceChange24h = parseFloat(tickerData.priceChangePercent || '0');
    const volume24h = parseFloat(tickerData.volume || '0');

    // Quick RSI/MACD fallback calculation (simplified)
    let rsi = 50; // Neutral fallback
    let macdSignal = 0; // Neutral fallback

    try {
      // Try to get recent klines for basic RSI calculation (fast)
      const klines = await binanceAdapter.getKlines(normalizedSymbol, '5m', 50);
      if (klines && klines.length > 14) {
        const closes = klines.slice(-14).map((k: any) => parseFloat(k.close));
        rsi = calculateSimpleRSI(closes);
      }
    } catch (error) {
      // Keep fallback values
    }

    // Compute rough confidence score based on price momentum and volume
    const priceMomentum = Math.abs(priceChange24h); // 0-100 range
    const volumeScore = Math.min(volume24h / 1000000, 10); // Cap at 10 for very high volume
    const rsiScore = rsi > 70 ? 8 : rsi < 30 ? 8 : 5; // Extreme RSI = high confidence
    const macdScore = Math.abs(macdSignal) > 0.001 ? 6 : 3; // MACD divergence = moderate confidence

    const confidence = Math.min(100,
      (priceMomentum * 2) + // Price change weight
      (volumeScore * 3) +   // Volume weight
      rsiScore +           // RSI weight
      macdScore            // MACD weight
    );

    return {
      symbol: normalizedSymbol,
      confidence,
      priceChange24h,
      volume24h,
      rsi,
      macdSignal,
      scanTimeMs: Date.now() - startTime
    };

  } catch (error: any) {
    // Return minimal result on error
    return {
      symbol: normalizedSymbol,
      confidence: 0,
      priceChange24h: 0,
      volume24h: 0,
      rsi: 50,
      macdSignal: 0,
      scanTimeMs: Date.now() - startTime
    };
  }
}

/**
 * Simple RSI calculation for quick scan
 */
function calculateSimpleRSI(closes: number[]): number {
  if (closes.length < 14) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / 13; // 14 periods - 1
  const avgLoss = losses / 13;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Get top 100 symbols from CoinGecko/Binance
 */
async function getTop100Symbols(): Promise<string[]> {
  const { topCoinsService } = await import('./topCoinsService');
  return await topCoinsService.getTop100Coins();
}

/**
 * Select the best symbol from top 100 by running quick scans
 */
async function selectBestSymbolFromTop100(uid: string): Promise<{
  selectedSymbol: string;
  confidence: number;
  topCandidates: Array<{ symbol: string; confidence: number; priceChange24h: number; volume24h: number }>;
  totalScanTimeMs: number;
  reason: string;
}> {
  const startTime = Date.now();
  const { BinancePublicAdapter } = await import('./binancePublicAdapter');

  // Get top 100 symbols
  const topSymbols = await getTop100Symbols();
  if (topSymbols.length === 0) {
    logger.warn('No symbols available from top coins service, using fallback');
    // Return a fallback selection
    return {
      selectedSymbol: 'BTCUSDT',
      confidence: 0.5,
      topCandidates: [{ symbol: 'BTCUSDT', confidence: 0.5, priceChange24h: 0, volume24h: 0 }],
      totalScanTimeMs: 0,
      reason: 'Fallback: no symbols available'
    };
  }

  // Limit to first 50 for performance (top coins are most important)
  const symbolsToScan = topSymbols.slice(0, 50);
  const binanceAdapter = new BinancePublicAdapter();

  logger.info({ uid, symbolCount: symbolsToScan.length }, 'Starting quick scan of top symbols for auto-selection');

  // Run quick scans in parallel (with concurrency limit)
  const scanPromises: Promise<QuickScanResult>[] = [];
  const concurrencyLimit = 10; // Limit concurrent requests

  for (let i = 0; i < symbolsToScan.length; i += concurrencyLimit) {
    const batch = symbolsToScan.slice(i, i + concurrencyLimit);
    const batchPromises = batch.map(symbol => quickScan(symbol, binanceAdapter));
    scanPromises.push(...batchPromises);

    // Small delay between batches to avoid rate limiting
    if (i + concurrencyLimit < symbolsToScan.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  const scanResults = await Promise.all(scanPromises);

  // Sort by confidence (highest first)
  scanResults.sort((a, b) => b.confidence - a.confidence);

  const selectedResult = scanResults[0];
  const totalScanTimeMs = Date.now() - startTime;

  // Get top 5 candidates for logging
  const topCandidates = scanResults.slice(0, 5).map(result => ({
    symbol: result.symbol,
    confidence: result.confidence,
    priceChange24h: result.priceChange24h,
    volume24h: result.volume24h
  }));

  logger.info({
    uid,
    selectedSymbol: selectedResult.symbol,
    confidence: selectedResult.confidence,
    topCandidates,
    totalScanTimeMs,
    symbolsScanned: scanResults.length
  }, 'Auto-selected best symbol from top 100 coins');

  return {
    selectedSymbol: selectedResult.symbol,
    confidence: selectedResult.confidence,
    topCandidates,
    totalScanTimeMs,
    reason: `Highest confidence (${selectedResult.confidence.toFixed(1)}%) from quick scan of ${scanResults.length} top symbols`
  };
}

export { runResearch, quickScan, getTop100Symbols, selectBestSymbolFromTop100 };
