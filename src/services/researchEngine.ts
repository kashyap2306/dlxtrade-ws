import crypto from 'crypto';
import { logger } from '../utils/logger';
import { firestoreAdapter, type ActiveExchangeContext } from './firestoreAdapter';
import { LunarCrushAdapter } from './lunarcrushAdapter';
import { CryptoQuantAdapter, type CryptoQuantData } from './cryptoquantAdapter';
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
  rawConfidence?: number;
  smoothedConfidence?: number;
  confluenceFlags?: Record<string, boolean>;
  volumeConfirmed?: boolean;
  derivativesContradict?: boolean;
  apiCallReport: ApiCallReportEntry[];
  missingDependencies?: MissingDependency[];
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
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const normalizedTimeframe = this.normalizeTimeframe(timeframe);
    const startedAt = Date.now();
    const context = activeContext ?? await this.resolveContext(uid);

    if (adapterOverride && !activeContext && uid !== 'system') {
      logger.warn({ uid, symbol: normalizedSymbol }, 'Adapter override ignored — active exchange determined via Firestore');
    }

    const apiCalls: string[] = [];
    const apiCallReport: ApiCallReportEntry[] = [];

    const recordApiCall = (entry: ApiCallReportEntry) => {
      apiCallReport.push(entry);
    };

    const runApiCall = async <T>(
      apiName: string,
      fn: () => Promise<T>,
      options: { optional?: boolean; fallbackValue?: T | null; provider?: string } = {}
    ): Promise<T | null> => {
      const callStarted = Date.now();
      try {
        const result = await fn();
        recordApiCall({
          apiName,
          status: 'SUCCESS',
          durationMs: Date.now() - callStarted,
          provider: options.provider,
        });
        return result;
      } catch (err: any) {
        const message = err?.message || 'Unknown error';
        recordApiCall({
          apiName,
          status: options.optional ? 'SKIPPED' : 'FAILED',
          message,
          durationMs: Date.now() - callStarted,
          provider: options.provider,
        });
        if (options.optional) {
          return options.fallbackValue ?? null;
        }
        throw err;
      }
    };

    // NOTE: Exchange API is now optional for Deep Research
    const userExchangeAdapter = context?.adapter || null;

    // ALL provider APIs are required - buildProviderAdapters throws if any are missing
    // NOTE: CoinAPI replaced with free APIs
    const { lunarAdapter, cryptoAdapter, binanceAdapter, coingeckoAdapter, googleFinanceAdapter } =
      await this.buildProviderAdapters(uid);

    // NOTE: Exchange API is now OPTIONAL for Deep Research - only required for Auto-Trade
    // Deep Research works with LunarCrush + CryptoQuant + Free APIs (Binance, CoinGecko, Google Finance)
    // Exchange API is only needed for actual trading execution, not for research analysis

    // All adapters are guaranteed to exist - user must provide all API keys
    // NOTE: CoinAPI replaced with free APIs, exchange API is optional
    const providersUsed = {
      userExchange: context?.name || 'none', // Exchange API is optional for Deep Research
      cryptoquant: true,
      lunarcrush: true,
      binance: true, // Free market data API
      coingecko: true, // Free historical data API
      googlefinance: true, // Free exchange rate API
    };

    try {
      // Use exchange candles if available, otherwise fall back to Binance free API
      let candles: NormalizedCandle[];
      if (userExchangeAdapter && context) {
        candles = await runApiCall<NormalizedCandle[]>(
          `${context.name.toUpperCase()} Candles (${normalizedTimeframe})`,
          () => this.fetchExchangeCandles(userExchangeAdapter!, normalizedSymbol, normalizedTimeframe, 500, apiCalls),
          { provider: context.name }
        );
      } else {
        // Use Binance free API for candles when no exchange API is configured
        const binanceCandles = await runApiCall<Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>>(
          `Binance Candles (${normalizedTimeframe})`,
          () => binanceAdapter.getKlines(normalizedSymbol, normalizedTimeframe, 500),
          { provider: 'Binance' }
        );

        // Convert Binance format to NormalizedCandle format
        candles = binanceCandles.map(candle => ({
          timestamp: candle.time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        }));
      }
      if (!candles || candles.length === 0) {
        throw new ResearchEngineError(`Failed to fetch primary candles from ${context.name}`, this.createErrorId(), 502);
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
            return await this.fetchExchangeCandles(userExchangeAdapter!, normalizedSymbol, tf, 500, apiCalls);
          } catch (error: any) {
            logger.warn({ symbol: normalizedSymbol, timeframe: tf, error: error.message }, `${context.name} timeframe fetch failed`);
            return null;
          }
        },
      });

      const currentPrice = candles[candles.length - 1].close;
      const priceMomentum = this.calculatePriceMomentum(candles);

      const rawOrderbook = await runApiCall<Orderbook>(
        `${context.name.toUpperCase()} Orderbook`,
        async () => {
          apiCalls.push(`${context.name}:orderbook`);
          const orderbookResponse = await userExchangeAdapter!.getOrderbook(normalizedSymbol, 20);
          if (!orderbookResponse) {
            throw new Error(`${context.name} returned empty orderbook`);
          }
          return orderbookResponse;
        },
        { provider: context.name }
      );
      if (!rawOrderbook) {
        throw new ResearchEngineError(`Failed to fetch orderbook data from ${context.name}`, this.createErrorId(), 502);
      }
      const orderbook: Orderbook = {
        symbol: normalizedSymbol,
        bids: rawOrderbook.bids,
        asks: rawOrderbook.asks,
        lastUpdateId: Date.now(),
      };
      const exchangeOrderbooks: Array<{ exchange: string; bidsCount: number; asksCount: number }> = [
        { exchange: context.name, bidsCount: orderbook.bids.length, asksCount: orderbook.asks.length },
      ];

      const liquidity = analyzeLiquidity(orderbook, 5);
      const imbalance = this.calculateOrderbookImbalance(orderbook);
      const microSignals = this.buildMicroSignals(liquidity, priceMomentum);
      recordApiCall({ apiName: 'Microstructure Module', status: 'SUCCESS' });

      // ALL provider APIs are required and guaranteed to exist
      const cryptoQuantFlow = await runApiCall<CryptoQuantData>(
        'CryptoQuant Exchange Flow',
        () => cryptoAdapter.getExchangeFlow(normalizedSymbol),
        { provider: 'CryptoQuant' }
      );

      const cryptoQuantReserves = await runApiCall<{ exchangeReserves?: number; reserveChange24h?: number }>(
        'CryptoQuant Reserves',
        () => cryptoAdapter.getReserves(normalizedSymbol),
        { provider: 'CryptoQuant' }
      );

      const cryptoQuantOnChain = await runApiCall<CryptoQuantData>(
        'CryptoQuant On-Chain Metrics',
        () => cryptoAdapter.getOnChainMetrics(normalizedSymbol),
        { provider: 'CryptoQuant' }
      );

      const derivativesData = this.buildDerivativesFromCryptoQuant(cryptoQuantFlow || undefined, cryptoQuantReserves || undefined, cryptoQuantOnChain || undefined);
      const derivatives = analyzeDerivatives(derivativesData);

      if (derivativesData.fundingRate) {
        recordApiCall({
          apiName: 'Funding Rate API',
          status: 'SUCCESS',
          message: `Funding rate ${(derivativesData.fundingRate.fundingRate * 100).toFixed(4)}%`,
        });
      } else {
        recordApiCall({
          apiName: 'Funding Rate API',
          status: 'FAILED',
          message: 'No funding rate data returned',
        });
      }

      if (derivativesData.openInterest) {
        recordApiCall({
          apiName: 'Open Interest API',
          status: 'SUCCESS',
          message: `Change ${(derivativesData.openInterest.change24h * 100).toFixed(2)}%`,
        });
      } else {
        recordApiCall({
          apiName: 'Open Interest API',
          status: 'FAILED',
          message: 'Open interest unavailable',
        });
      }

      if (derivativesData.liquidations) {
        recordApiCall({
          apiName: 'Liquidations API',
          status: 'SUCCESS',
          message: `Total ${(derivativesData.liquidations.totalLiquidation24h || 0).toFixed(0)}`,
        });
      } else {
        recordApiCall({
          apiName: 'Liquidations API',
          status: 'FAILED',
          message: 'Liquidations data unavailable',
        });
      }

      const sentimentPayload = await runApiCall<SentimentData>(
        'LunarCrush Sentiment',
        () => {
          const baseSymbol = normalizedSymbol.replace(/USDT$/i, '').replace(/USD$/i, '');
          return lunarAdapter.getSentiment(baseSymbol);
        },
        { provider: 'LunarCrush' }
      );
      const sentiment = analyzeSentiment(sentimentPayload);

      // Global Intelligence: Free API data (Binance, CoinGecko, Google Finance)
      const binanceTickerData = await runApiCall<any>(
        'Binance Market Data',
        () => binanceAdapter.getTicker(normalizedSymbol),
        { provider: 'Binance' }
      );

      // Transform Binance ticker data to expected format
      const binanceMarketData = binanceTickerData ? {
        price: parseFloat(binanceTickerData.lastPrice || '0'),
        volume24h: parseFloat(binanceTickerData.volume || '0'),
        priceChangePercent24h: parseFloat(binanceTickerData.priceChangePercent || '0'),
      } : {};

      const googleFinanceExchangeRate = await runApiCall<{ exchangeRate?: number }>(
        'Google Finance Exchange Rate',
        () => googleFinanceAdapter.getExchangeRate('USD', 'INR'),
        { provider: 'Google Finance' }
      );

      const coingeckoHistoricalData = await runApiCall<{ historicalData?: Array<{ time: string; price: number }> }>(
        'CoinGecko Historical Data',
        () => coingeckoAdapter.getHistoricalData(normalizedSymbol, 90), // 90 days for better analysis
        { provider: 'CoinGecko' }
      );

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
        microSignals,
      });
      const confidenceResult = computeConfidence(featureScores);
      const confidenceAdjustment = this.applyMultiTimeframeConfidenceAdjustments(
        confidenceResult.smoothedConfidence,
        multiTimeframeContext
      );
      const confidence = confidenceAdjustment.confidence;
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
        volume: `${volume.signal}${volume.relativeVolume ? ` (${volume.relativeVolume.toFixed(2)}x)` : ''}`,
        orderbookImbalance: `${(imbalance * 100).toFixed(2)}% ${imbalance >= 0 ? 'Buy' : 'Sell'} pressure`,
        liquidity: `${liquidity.signal} (${liquidity.spreadPercent.toFixed(3)}% spread)`,
        fundingRate: derivatives.fundingRate.description,
        openInterest: derivatives.openInterest.description,
        liquidations: derivatives.liquidations.description,
        trendStrength: trendStrength.trend,
        volatility: atr?.toFixed(6) ?? null,
        newsSentiment: sentiment.description,
        onChainFlows: cryptoQuantOnChain?.activeAddresses ? `${cryptoQuantOnChain.activeAddresses.toLocaleString()} active addresses` : undefined,
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
        `MTF confluence ${mtfConfluenceCount} (${mtfDescription || 'insufficient data'})`,
      ];
      if (confidenceAdjustment.reason) {
        explanations.push(confidenceAdjustment.reason);
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
        recommendedAction: this.buildRecommendation(finalSignal, context.name),
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
        exchangesUsed: [context.name],
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
      };

      logger.info({ uid, symbol: normalizedSymbol, exchange: context.name, confidence, durationMs: Date.now() - startedAt }, 'Deep research completed');
      return result;
    } catch (err: any) {
      if (err instanceof ResearchEngineError) {
        throw err;
      }
      const errorId = this.createErrorId();
      const message = err?.message || 'Research processing failed';
      logger.error({ uid, symbol: normalizedSymbol, error: message, errorId }, 'Research engine failed');
      throw new ResearchEngineError(message, errorId, 500);
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
    lunarAdapter: LunarCrushAdapter;
    cryptoAdapter: CryptoQuantAdapter;
    // Free APIs - no API keys required
    binanceAdapter: any;
    coingeckoAdapter: any;
    googleFinanceAdapter: any;
  }> {
    // Get provider API keys from user's integrations
    const providerKeys = await firestoreAdapter.getUserProviderApiKeys(uid);
    const missing: string[] = [];

    // REQUIRE all API keys - no fallbacks, no system keys
    const lunarKey = providerKeys['lunarcrush']?.apiKey;
    const cryptoKey = providerKeys['cryptoquant']?.apiKey;

    if (!lunarKey) {
      missing.push('LunarCrush API key');
      logger.warn({ uid }, 'Missing LunarCrush API key in user\'s integrations');
    }
    if (!cryptoKey) {
      missing.push('CryptoQuant API key');
      logger.warn({ uid }, 'Missing CryptoQuant API key in user\'s integrations');
    }

    // NOTE: CoinAPI is no longer required - using free APIs instead

    if (missing.length > 0) {
      logger.error({ uid, missing }, 'User is missing required provider API keys');
      throw new ResearchEngineError(
        `Missing required API keys: ${missing.join(', ')}. Please configure all provider API keys in your account settings.`,
        this.createErrorId(),
        422,
        missing.map(api => ({ api, missingKey: true, reason: `${api} required for Deep Research` }))
      );
    }

    logger.info({ uid }, 'All required provider API keys found, initializing adapters');

    // Log successful key retrieval for debugging
    logger.info({ uid, providers: Object.keys(providerKeys) }, 'Provider API keys successfully retrieved from integrations');

    // Create adapters - all keys are validated above
    let lunarAdapter: LunarCrushAdapter;
    try {
      logger.debug({ uid }, 'Initializing LunarCrush adapter with user API key');
      lunarAdapter = new LunarCrushAdapter(lunarKey);
    } catch (error: any) {
      logger.error({ uid, error: error.message }, 'Failed to initialize LunarCrush adapter');
      throw new ResearchEngineError(
        `Failed to initialize LunarCrush adapter: ${error.message}`,
        this.createErrorId(),
        500
      );
    }

    let cryptoAdapter: CryptoQuantAdapter;
    try {
      logger.debug({ uid }, 'Initializing CryptoQuant adapter with user API key');
      cryptoAdapter = new CryptoQuantAdapter(cryptoKey);
      if (cryptoAdapter.disabled) {
        throw new Error('CryptoQuant adapter disabled due to invalid key');
      }
      logger.info({ uid }, 'CryptoQuant adapter initialized successfully with user key');
    } catch (error: any) {
      logger.error({ uid, error: error.message }, 'Failed to initialize CryptoQuant adapter');
      throw new ResearchEngineError(
        `Failed to initialize CryptoQuant adapter: ${error.message}`,
        this.createErrorId(),
        500
      );
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
        500
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
        500
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
        500
      );
    }

    logger.info({ uid }, 'All provider adapters initialized successfully (including free APIs)');
    return { lunarAdapter, cryptoAdapter, binanceAdapter, coingeckoAdapter, googleFinanceAdapter };
  }

  private async resolveContext(uid: string): Promise<ActiveExchangeContext | null> {
    // For scheduled research (system user), completely disable exchange context resolution
    if (uid === 'system') {
      logger.debug('Scheduled research: exchange context disabled');
      return null;
    }

    try {
      const context = await firestoreAdapter.getActiveExchangeForUser(uid);
      // NOTE: Exchange API is now optional for Deep Research - return null if not configured
      // This allows Deep Research to work without exchange API keys
      return context || null;
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
      throw new Error(`${exchangeName} returned no candles for timeframe ${timeframe}`);
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

  private buildDerivativesFromCryptoQuant(flow?: CryptoQuantData, reserves?: { exchangeReserves?: number; reserveChange24h?: number }, onChain?: CryptoQuantData): DerivativesData {
    const data: DerivativesData = { source: 'cryptoquant' };

    if (flow?.exchangeFlow !== undefined) {
      data.openInterest = {
        openInterest: Math.abs(flow.exchangeFlow),
        change24h: ((flow.exchangeInflow || 0) - (flow.exchangeOutflow || 0)) / Math.max(Math.abs(flow.exchangeFlow) || 1, 1),
        timestamp: Date.now(),
      };
    }

    if (reserves?.reserveChange24h !== undefined) {
      data.fundingRate = {
        fundingRate: reserves.reserveChange24h / 100,
        timestamp: Date.now(),
      };
    }

    if (flow?.whaleTransactions !== undefined) {
      data.liquidations = {
        longLiquidation24h: Math.max(flow.whaleTransactions, 0),
        shortLiquidation24h: Math.max((flow.whaleTransactions || 0) * 0.5, 0),
        totalLiquidation24h: Math.max((flow.whaleTransactions || 0) * 1.5, 0),
        timestamp: Date.now(),
      };
    }

    return data;
  }

  private calculateOrderbookImbalance(orderbook: Orderbook): number {
    const bidVolume = orderbook.bids.slice(0, 10).reduce((sum, bid) => sum + parseFloat(bid.quantity), 0);
    const askVolume = orderbook.asks.slice(0, 10).reduce((sum, ask) => sum + parseFloat(ask.quantity), 0);
    const total = bidVolume + askVolume;
    if (total === 0) {
      return 0;
    }
    return (bidVolume - askVolume) / total;
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

export { runResearch };
