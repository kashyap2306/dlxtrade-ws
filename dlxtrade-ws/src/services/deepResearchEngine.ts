import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { fetchNewsData } from './newsDataAdapter';
import { fetchCoinMarketCapMetadata, fetchCoinMarketCapMarketData } from './coinMarketCapAdapter';
import { autoTradeExecutor } from './autoTradeExecutor';
import { tradingStrategies, OHLCData, StrategyResult, IndicatorResult } from './tradingStrategies';
import { BinanceAdapter } from './binanceAdapter';
import { CryptoCompareAdapter } from './cryptocompareAdapter';
import * as admin from 'firebase-admin';
import { config } from '../config';
import { getUserIntegrations } from '../routes/integrations';
import { accuracyEngine, AccuracyResult } from './accuracyEngine';

// FREE MODE Deep Research v1.5 interfaces
export interface ProviderBackupConfig {
  primary: string;
  backups: string[];
}

export interface FreeModeProviderResult {
  success: boolean;
  data: any;
  latencyMs: number;
  provider: string;
  error?: string;
}

export interface FreeModeDeepResearchResult {
  signal: 'BUY' | 'SELL' | 'HOLD';
  accuracy: number;
  snapshotAccuracy: number;
  accuracyBreakdown: {
    indicatorScore: number;
    marketStructureScore: number;
    momentumScore: number;
    volumeScore: number;
    newsScore: number;
    riskPenalty: number;
  };
  accuracyWeightsUsed: Record<string, number>;
  indicators: {
    rsi: IndicatorResult;
    ma50: IndicatorResult;
    ma200: IndicatorResult;
    ema20: IndicatorResult;
    macd: IndicatorResult;
    volume: IndicatorResult;
    vwap: IndicatorResult;
    atr: IndicatorResult;
    pattern: IndicatorResult;
    momentum: IndicatorResult;
  };
  metadata: {
    name: string;
    symbol: string;
    category: string;
    tags: string[];
    rank: number;
    supply: {
      circulating: number;
      total: number;
    };
    description: string;
  };
  news: Array<{
    title: string;
    source: string;
    url: string;
    published_at: string;
    sentiment: 'bullish' | 'bearish' | 'neutral';
  }>;
  raw: {
    marketData: any;
    cryptocompare: any;
    metadata: any;
    news: any;
  };
  providers: {
    marketData: {
      success: boolean;
      latency: number;
      data?: any;
      error?: string;
    };
    metadata: {
      success: boolean;
      latency: number;
      data?: any;
      error?: string;
    };
    cryptocompare: {
      success: boolean;
      latency: number;
      data?: any;
      error?: string;
    };
    news: {
      success: boolean;
      latency: number;
      data?: any;
      error?: string;
    };
  };
}

/**
 * Semaphore for concurrency control
 */
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits--;
      return () => this.release();
    }

    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.permits--;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.permits++;
    if (this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      next();
    }
  }
}

/**
 * In-memory cache for symbol metadata
 */
const symbolCache = new Map<string, { data: string[]; timestamp: number; ttl: number }>();

/**
 * Normalize symbol by removing common quote currencies
 */
function normalizeSymbol(s: string): string {
  if (s.endsWith("USDT")) return s.replace("USDT", "");
  if (s.endsWith("USD")) return s.replace("USD", "");
  return s;
}
const SYMBOL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface ProviderConfirmation {
  name: string;
  status: 'success' | 'failed' | 'rate-limited' | 'fallback';
  latencyMs: number;
  confirmationDeltaPercent?: number;
  raw?: any;
}


export class DeepResearchEngine {
  constructor() {
    console.log("[DR ENGINE LOADED] Version X.Y - Deep Research Provider Fixes");
  }

  /**
   * Get CryptoCompare OHLC data for indicator calculation when Binance fails
   */
  private async getCryptoCompareOHLCForIndicators(symbol: string): Promise<any> {
    try {
      const ccAdapter = new CryptoCompareAdapter('');
      const historicalData = await ccAdapter.getOHLCData(symbol);

      if (!historicalData.ohlc || historicalData.ohlc.length < 20) {
        return null;
      }

      // Calculate indicators from OHLC data
      const indicators = this.calculateIndicatorsFromOHLC(historicalData.ohlc);

      return {
        ohlc: historicalData.ohlc,
        indicators,
        latest: historicalData.latest
      };
    } catch (error) {
      console.error('Failed to get CryptoCompare OHLC:', error);
      return null;
    }
  }

  /**
   * Calculate indicators from OHLC data
   */
  private calculateIndicatorsFromOHLC(ohlc: any[]): any {
    console.log("OHLC length:", ohlc?.length, "Sample OHLC:", ohlc?.[0]);
    if (!ohlc || ohlc.length < 20) {
      console.log("Insufficient OHLC data, using defaults");
      return this.createDefaultIndicators();
    }

    try {
      // Handle different OHLC formats: normalize to {open, high, low, close, volume}
      const normalizedOHLC = ohlc.map(d => ({
        open: d.open || d.o || 0,
        high: d.high || d.h || 0,
        low: d.low || d.l || 0,
        close: d.close || d.c || 0,
        volume: d.volume || d.v || d.volumefrom || 0
      }));

      const closes = normalizedOHLC.map(d => d.close);
      const highs = normalizedOHLC.map(d => d.high);
      const lows = normalizedOHLC.map(d => d.low);
      const volumes = normalizedOHLC.map(d => d.volume);

      // RSI calculation (14-period)
      const rsi = this.calculateRSI(closes);

      // Moving averages
      const ma50 = this.calculateSMA(closes, 50);
      const ma200 = this.calculateSMA(closes, 200);
      const ema20 = this.calculateEMA(closes, 20);
      const currentPrice = closes[closes.length - 1];

      // MACD calculation
      const macd = this.calculateMACD(closes);

      // ATR calculation
      const atr = this.calculateATR(normalizedOHLC);

      // Volume analysis
      const volumeAnalysis = this.calculateVolumeAnalysis(normalizedOHLC);

      // VWAP calculation
      const vwap = this.calculateVWAP(normalizedOHLC);

      // Momentum
      const momentum = this.calculateMomentum(closes);

      // Pattern recognition (simplified)
      const pattern = this.calculatePatternRecognition(normalizedOHLC);

      console.log("Calculated indicators - RSI:", rsi?.value, "MA50:", ma50?.value, "EMA20:", ema20?.value, "MACD:", macd?.value);

      return {
        rsi,
        ma50: { value: ma50.value, smaTrend: ma50.value > currentPrice ? 'bearish' : 'bullish' },
        ma200: { value: ma200.value, smaTrend: ma200.value > currentPrice ? 'bearish' : 'bullish' },
        ema20: { value: ema20.value, emaTrend: ema20.value > currentPrice ? 'bearish' : 'bullish' },
        macd,
        volume: volumeAnalysis,
        vwap,
        atr: { value: atr, classification: atr < 0.02 ? 'low' : atr < 0.05 ? 'medium' : 'high' },
        pattern,
        momentum
      };
    } catch (error) {
      console.error("Error calculating indicators from OHLC:", error);
      return this.createDefaultIndicators();
    }
  }

  /**
   * Calculate RSI (Relative Strength Index)
   */
  private calculateRSI(closes: number[], period: number = 14): any {
    if (closes.length < period + 1) {
      return { value: 50, strength: 0.5 };
    }

    const gains = [];
    const losses = [];

    for (let i = 1; i <= period; i++) {
      const change = closes[i] - closes[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? -change : 0);
    }

    let avgGain = gains.reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.reduce((a, b) => a + b, 0) / period;

    // Use Wilder's smoothing for subsequent values
    for (let i = period + 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? -change : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return { value: rsi, strength: Math.abs(50 - rsi) / 50 };
  }

  /**
   * Calculate Simple Moving Average
   */
  private calculateSMA(closes: number[], period: number): any {
    if (closes.length < period) {
      return { value: closes[closes.length - 1] || 0 };
    }

    const sum = closes.slice(-period).reduce((a, b) => a + b, 0);
    return { value: sum / period };
  }

  /**
   * Calculate Exponential Moving Average
   */
  private calculateEMA(closes: number[], period: number): any {
    if (closes.length < period) {
      return { value: closes[closes.length - 1] || 0 };
    }

    const multiplier = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < closes.length; i++) {
      ema = (closes[i] - ema) * multiplier + ema;
    }

    return { value: ema };
  }

  /**
   * Calculate MACD (Moving Average Convergence Divergence)
   */
  private calculateMACD(closes: number[]): any {
    const ema12 = this.calculateEMA(closes, 12);
    const ema26 = this.calculateEMA(closes, 26);

    if (!ema12.value || !ema26.value) {
      return { value: 0, signal: 'neutral' };
    }

    const macdValue = ema12.value - ema26.value;
    const signal = macdValue > 0 ? 'bullish' : macdValue < 0 ? 'bearish' : 'neutral';

    return { value: macdValue, signal };
  }

  /**
   * Calculate ATR (Average True Range)
   */
  private calculateATR(ohlc: any[], period: number = 14): number {
    if (ohlc.length < period + 1) {
      return 0.01;
    }

    const trs = [];
    for (let i = 1; i < ohlc.length; i++) {
      const tr = Math.max(
        ohlc[i].high - ohlc[i].low,
        Math.abs(ohlc[i].high - ohlc[i - 1].close),
        Math.abs(ohlc[i].low - ohlc[i - 1].close)
      );
      trs.push(tr);
    }

    return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  /**
   * Calculate Volume Analysis
   */
  private calculateVolumeAnalysis(ohlc: any[]): any {
    if (ohlc.length < 10) {
      return { score: 0.5, trend: 'neutral' };
    }

    const volumes = ohlc.map(d => d.volume);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const recentVolume = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;

    const trend = recentVolume > avgVolume * 1.2 ? 'increasing' :
      recentVolume < avgVolume * 0.8 ? 'decreasing' : 'neutral';
    const score = Math.min(1, recentVolume / avgVolume);

    return { score, trend };
  }

  /**
   * Calculate VWAP (Volume Weighted Average Price)
   */
  private calculateVWAP(ohlc: any[]): any {
    if (ohlc.length < 10) {
      return { signal: 'neutral', deviation: 0 };
    }

    let priceVolumeSum = 0;
    let volumeSum = 0;

    for (const candle of ohlc) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      priceVolumeSum += typicalPrice * candle.volume;
      volumeSum += candle.volume;
    }

    const vwap = volumeSum > 0 ? priceVolumeSum / volumeSum : 0;
    const currentPrice = ohlc[ohlc.length - 1].close;
    const deviation = ((currentPrice - vwap) / vwap) * 100;

    const signal = deviation > 2 ? 'bullish' : deviation < -2 ? 'bearish' : 'neutral';

    return { signal, deviation };
  }

  /**
   * Calculate Momentum
   */
  private calculateMomentum(closes: number[], period: number = 10): any {
    if (closes.length < period + 1) {
      return { score: 0.5, direction: 'neutral' };
    }

    const current = closes[closes.length - 1];
    const past = closes[closes.length - period - 1];

    if (past === 0) {
      return { score: 0.5, direction: 'neutral' };
    }

    const momentum = ((current - past) / past) * 100;
    const direction = momentum > 1 ? 'bullish' : momentum < -1 ? 'bearish' : 'neutral';
    const score = Math.min(1, Math.max(0, 0.5 + momentum / 10));

    return { score, direction };
  }

  /**
   * Calculate Pattern Recognition (simplified)
   */
  private calculatePatternRecognition(ohlc: any[]): any {
    if (ohlc.length < 5) {
      return { confidence: 0, pattern: 'neutral' };
    }

    // Simple trend pattern detection
    const closes = ohlc.map(d => d.close);
    const recent = closes.slice(-5);
    const increasing = recent.every((price, i) => i === 0 || price >= recent[i - 1]);
    const decreasing = recent.every((price, i) => i === 0 || price <= recent[i - 1]);

    if (increasing) {
      return { confidence: 0.7, pattern: 'bullish' };
    } else if (decreasing) {
      return { confidence: 0.7, pattern: 'bearish' };
    }

    return { confidence: 0, pattern: 'neutral' };
  }

  /**
   * Create default indicators when no data is available
   */
  private createDefaultIndicators(): any {
    // Return sensible defaults that indicate neutral market conditions
    // rather than zeros which could be misleading
    return {
      rsi: { value: 50, strength: 0.5 }, // Neutral RSI
      ma50: { value: 0, smaTrend: 'neutral' }, // No trend data
      ma200: { value: 0, smaTrend: 'neutral' }, // No trend data
      ema20: { value: 0, emaTrend: 'neutral' }, // No trend data
      macd: { value: 0, signal: 'neutral' }, // No momentum signal
      volume: { score: 0.5, trend: 'neutral' }, // Neutral volume
      vwap: { signal: 'neutral', deviation: 0 }, // No deviation data
      atr: { value: 0.01, classification: 'low' }, // Low volatility assumption
      pattern: { confidence: 0, pattern: 'neutral' }, // No pattern detected
      momentum: { score: 0.5, direction: 'neutral' } // Neutral momentum
    };
  }

  /**
   * Create default indicators data structure
   */
  private createDefaultIndicatorsData(): any {
    return {
      ohlc: [],
      indicators: this.createDefaultIndicators(),
      latest: null
    };
  }

  /**
   * Execute provider with automatic backup fallback
   */
  private async executeProviderWithBackups(
    providerConfig: ProviderBackupConfig,
    executeFn: (provider: string) => Promise<FreeModeProviderResult>,
    providerName: string,
    integrations?: any
  ): Promise<FreeModeProviderResult> {
    const start = Date.now();

    // Try primary provider with retries
    try {
      console.log(`🔄 ${providerName.toUpperCase()}: Attempting primary provider ${providerConfig.primary}`);
      const result = await executeFn(providerConfig.primary);
      if (result.success) {
        result.latencyMs = Date.now() - start;
        return result;
      }
    } catch (error: any) {
      console.error(`❌ ${providerName.toUpperCase()}: Primary provider ${providerConfig.primary} failed:`, error.message);
    }

    // Retry primary provider twice more
    for (let retry = 1; retry <= 2; retry++) {
      try {
        console.log(`🔄 ${providerName.toUpperCase()}: Retrying primary provider ${providerConfig.primary} (attempt ${retry}/2)`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
        const result = await executeFn(providerConfig.primary);
        if (result.success) {
          result.latencyMs = Date.now() - start;
          return result;
        }
      } catch (error: any) {
        console.error(`❌ ${providerName.toUpperCase()}: Primary provider ${providerConfig.primary} retry ${retry} failed:`, error.message);
      }
    }

    // For Binance, don't use backups since they don't provide OHLC data
    if (providerName === 'Binance') {
      return {
        success: false,
        data: null,
        latencyMs: Date.now() - start,
        provider: 'none',
        error: 'Binance failed after retries and no suitable backups available'
      };
    }

    // Try backup providers with same retry logic
    for (const backupProvider of providerConfig.backups) {
      try {
        console.log(`🔄 ${providerName.toUpperCase()}: Trying backup provider ${backupProvider}`);
        const result = await executeFn(backupProvider);
        if (result.success) {
          result.latencyMs = Date.now() - start;
          return result;
        }
      } catch (error: any) {
        console.error(`❌ ${providerName.toUpperCase()}: Backup provider ${backupProvider} failed:`, error.message);
      }

      // Retry backup provider twice more
      for (let retry = 1; retry <= 2; retry++) {
        try {
          console.log(`🔄 ${providerName.toUpperCase()}: Retrying backup provider ${backupProvider} (attempt ${retry}/2)`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
          const result = await executeFn(backupProvider);
          if (result.success) {
            result.latencyMs = Date.now() - start;
            return result;
          }
        } catch (error: any) {
          console.error(`❌ ${providerName.toUpperCase()}: Backup provider ${backupProvider} retry ${retry} failed:`, error.message);
        }
      }
    }

    // All providers failed after retries
    return {
      success: false,
      data: null,
      latencyMs: Date.now() - start,
      provider: 'none',
      error: `All ${providerName} providers failed after retries`
    };
  }

  /**
   * FREE MODE Deep Research v1.5 - Execute with backup APIs
   */
  async runFreeModeDeepResearch(
    uid: string,
    symbol: string,
    providerConfigs?: {
      binance?: ProviderBackupConfig;
      cryptocompare?: ProviderBackupConfig;
      cmc?: ProviderBackupConfig;
      news?: ProviderBackupConfig;
    },
    integrations?: any
  ): Promise<FreeModeDeepResearchResult> {
    const startTime = Date.now();
    logger.info({ uid, symbol }, 'Starting FREE MODE Deep Research v1.5');

    // Get user integrations for API keys (use provided integrations or fetch from Firebase)
    let userIntegrations: any;
    if (integrations) {
      userIntegrations = integrations;
      logger.info({ uid, symbol }, 'Using provided integrations for FREE MODE research');
    } else {
      userIntegrations = {
        binance: { apiKey: '', secret: '' },
        cryptocompare: { apiKey: '' },
        cmc: { apiKey: '' },
        newsdata: { apiKey: ''       }

    // Skip Firebase integration fetching for provided integrations

    // Execute all providers with backup logic
    const [marketDataResult, ccResult, cmcResult, newsResult] = await Promise.all([
      this.executeMarketDataProvider(symbol, providerConfigs?.binance || { primary: 'cryptocompare', backups: [] }, userIntegrations),
      this.executeCryptoCompareProvider(symbol, providerConfigs?.cryptocompare || { primary: 'cryptocompare', backups: [] }, userIntegrations),
      this.executeCMCProvider(symbol, providerConfigs?.cmc || { primary: 'coingecko', backups: [] }, userIntegrations),
      this.executeNewsProvider(symbol, providerConfigs?.news || { primary: 'newsdata', backups: [] }, userIntegrations)
    ]);

    // Combine results using FREE MODE logic v1.5
    const result = await this.combineFreeModeResults(
      uid,
      symbol,
      marketDataResult,
      ccResult,
      cmcResult,
      newsResult
    );

    logger.info({
      uid,
      symbol,
      signal: result.signal,
      accuracy: result.accuracy,
      durationMs: Date.now() - startTime,
      providers: {
        marketData: marketDataResult.success ? marketDataResult.provider : 'failed',
        cryptocompare: ccResult.success ? ccResult.provider : 'failed',
        cmc: cmcResult.success ? cmcResult.provider : 'failed',
        news: newsResult.success ? newsResult.provider : 'failed'
      }
    }, 'FREE MODE Deep Research v1.5 completed');

    return result;
  }

  /**
   * Execute Market Data provider with backups (CryptoCompare, CoinGecko, KuCoin, Bybit, OKX, Bitget)
   */
  private async executeMarketDataProvider(
    symbol: string,
    config: ProviderBackupConfig,
    integrations: any
  ): Promise<FreeModeProviderResult> {
    console.log('🔄 EXECUTE MARKET DATA PROVIDER: Called for symbol', symbol);

    // Direct failover chain - try each provider in order
    const providers = ['cryptocompare', 'coingecko', 'kucoin', 'bybit', 'okx', 'bitget'];

    for (const provider of providers) {
      const startTime = Date.now();
      try {
        console.log(`🔄 MARKET DATA: Trying ${provider} for ${symbol}`);
        const result = await this.fetchMarketDataFromProvider(provider, symbol, integrations);

        if (result.success) {
          console.log(`✅ MARKET DATA: ${provider} succeeded in ${Date.now() - startTime}ms`);
          result.latencyMs = Date.now() - startTime;
          return result;
        } else {
          console.log(`⚠️ MARKET DATA: ${provider} returned success=false: ${result.error}`);
        }
      } catch (error: any) {
        console.error(`❌ MARKET DATA: ${provider} failed:`, error.message);
      }
    }

    // All providers failed
    return {
      success: false,
      data: null,
      latencyMs: Date.now() - Date.now(), // Will be 0 since all failed instantly
      provider: 'none',
      error: 'All market data providers failed'
    };
  }

  /**
   * Fetch market data from a specific provider
   */
  private async fetchMarketDataFromProvider(
    provider: string,
    symbol: string,
    integrations: any
  ): Promise<FreeModeProviderResult> {
    const baseSymbol = symbol.replace('USDT', '').replace('USD', '');
    const usdtSymbol = `${baseSymbol}USDT`;

    switch (provider) {
      case 'cryptocompare':
        return await this.fetchCryptoCompareMarketData(baseSymbol, integrations);

      case 'coingecko':
        return await this.fetchCoinGeckoMarketData(baseSymbol);

      case 'kucoin':
        return await this.fetchKuCoinMarketData(usdtSymbol);

      case 'bybit':
        return await this.fetchBybitMarketData(usdtSymbol);

      case 'okx':
        return await this.fetchOKXMarketData(usdtSymbol);

      case 'bitget':
        return await this.fetchBitgetMarketData(usdtSymbol);

      default:
        throw new Error(`Unknown market data provider: ${provider}`);
    }
  }

  /**
   * Execute CryptoCompare provider with backups (AlphaVantage, CoinGecko)
   */
  private async executeCryptoCompareProvider(
    symbol: string,
    config: ProviderBackupConfig,
    integrations: any
  ): Promise<FreeModeProviderResult> {
    return this.executeProviderWithBackups(
      config,
      async (provider: string) => {
        const startTime = Date.now();

        try {
          switch (provider) {
            case 'cryptocompare':
              return await this.fetchCryptoCompareFreeData(symbol, integrations);

            case 'alphavantage':
              return await this.fetchAlphaVantageFreeData(symbol);

            case 'coingecko':
              return await this.fetchCoinGeckoFreeData(symbol);

            default:
              throw new Error(`Unknown CryptoCompare backup provider: ${provider}`);
          }
        } catch (error: any) {
          return {
            success: false,
            data: null,
            latencyMs: Date.now() - startTime,
            provider,
            error: error.message
          };
        }
      },
      'CryptoCompare',
      integrations
    );
  }

  /**
   * Execute Metadata provider with backups (CoinGecko, CoinPaprika)
   */
  private async executeCMCProvider(
    symbol: string,
    config: ProviderBackupConfig,
    integrations: any
  ): Promise<FreeModeProviderResult> {
    console.log('🔄 EXECUTE METADATA PROVIDER: Called for symbol', symbol);

    // Direct failover chain - try each provider in order
    const providers = ['coingecko', 'coinpaprika'];

    for (const provider of providers) {
      const startTime = Date.now();
      try {
        console.log(`🔄 METADATA: Trying ${provider} for ${symbol}`);
        const result = await this.fetchMetadataFromProvider(provider, symbol, integrations);

        if (result.success) {
          console.log(`✅ METADATA: ${provider} succeeded in ${Date.now() - startTime}ms`);
          result.latencyMs = Date.now() - startTime;
          return result;
        } else {
          console.log(`⚠️ METADATA: ${provider} returned success=false: ${result.error}`);
        }
      } catch (error: any) {
        console.error(`❌ METADATA: ${provider} failed:`, error.message);
      }
    }

    // All providers failed
    return {
      success: false,
      data: null,
      latencyMs: Date.now() - Date.now(), // Will be 0 since all failed instantly
      provider: 'none',
      error: 'All metadata providers failed'
    };
  }

  /**
   * Fetch metadata from a specific provider
   */
  private async fetchMetadataFromProvider(
    provider: string,
    symbol: string,
    integrations: any
  ): Promise<FreeModeProviderResult> {
    switch (provider) {
      case 'coingecko':
        return await this.fetchCoinGeckoMetadata(symbol);

      case 'coinpaprika':
        return await this.fetchCoinPaprikaMetadata(symbol);

      default:
        throw new Error(`Unknown metadata provider: ${provider}`);
    }
  }

  /**
   * Execute News provider with backups (NewsData, CryptoPanic, Reddit, GNews)
   */
  private async executeNewsProvider(
    symbol: string,
    config: ProviderBackupConfig,
    integrations: any
  ): Promise<FreeModeProviderResult> {
    console.log('🔄 EXECUTE NEWS PROVIDER: Called for symbol', symbol);

    // Direct failover chain - try each provider in order
    const providers = ['newsdata', 'cryptopanic', 'reddit', 'gnews'];

    for (const provider of providers) {
      const startTime = Date.now();
      try {
        console.log(`🔄 NEWS: Trying ${provider} for ${symbol}`);
        const result = await this.fetchNewsFromProvider(provider, symbol, integrations);

        if (result.success) {
          console.log(`✅ NEWS: ${provider} succeeded in ${Date.now() - startTime}ms`);
          result.latencyMs = Date.now() - startTime;
          return result;
        } else {
          console.log(`⚠️ NEWS: ${provider} returned success=false: ${result.error}`);
        }
      } catch (error: any) {
        console.error(`❌ NEWS: ${provider} failed:`, error.message);
      }
    }

    // All providers failed
    return {
      success: false,
      data: null,
      latencyMs: Date.now() - Date.now(), // Will be 0 since all failed instantly
      provider: 'none',
      error: 'All news providers failed'
    };
  }

  /**
   * Fetch news from a specific provider
   */
  private async fetchNewsFromProvider(
    provider: string,
    symbol: string,
    integrations: any
  ): Promise<FreeModeProviderResult> {
    switch (provider) {
      case 'newsdata':
        return await this.fetchNewsDataFree(symbol, integrations);

      case 'cryptopanic':
        return await this.fetchCryptoPanicFree(symbol, integrations);

      case 'reddit':
        return await this.fetchRedditNews(symbol);

      case 'gnews':
        return await this.fetchGNews(symbol);

      default:
        throw new Error(`Unknown news provider: ${provider}`);
    }
  }

  /**
   * Fetch Binance Public Data (FREE MODE - Price, OHLC, Volume, Indicators)
   */
  private async fetchBinancePublicData(symbol: string, integrations: any): Promise<FreeModeProviderResult> {
    console.log('🔄 BINANCE PROVIDER: Method called with symbol:', symbol);
    const startTime = Date.now();

    try {
      console.log('🔄 BINANCE PROVIDER: Starting fetch for', symbol, '- API Key present:', !!(integrations.binance?.apiKey));
      console.log('🔄 BINANCE PROVIDER: Attempting fetch for BINANCE API...');

      const binanceAdapter = new BinanceAdapter('', '', true); // Public API only
      console.log('🔄 BINANCE PROVIDER: Created BinanceAdapter instance');

      // Get comprehensive public market data
      console.log('🔄 BINANCE PROVIDER: Making HTTP request to Binance API endpoints...');
      const marketData = await binanceAdapter.getPublicMarketData(symbol);
      console.log('🔄 BINANCE PROVIDER: Got response from BinanceAdapter:', typeof marketData, marketData ? 'has data' : 'null/undefined');

      if (marketData) {
        console.log('🔄 BINANCE PROVIDER: Response keys:', Object.keys(marketData));
        console.log('🔄 BINANCE PROVIDER: hasData:', marketData.hasData);
        console.log('🔄 BINANCE PROVIDER: Full response:', JSON.stringify(marketData).substring(0, 200) + '...');
      }

      if (!marketData || !marketData.hasData) {
        throw new Error('No market data available from Binance');
      }

      // Calculate indicators using OHLC data
      const ohlcData = marketData.ohlc || [];
      const indicators = {
        rsi: tradingStrategies.calculateRSI(ohlcData),
        ma50: tradingStrategies.calculateSMATrend(ohlcData), // SMA 50
        ma200: { value: 0, strength: 0.5, smaTrend: 'neutral' }, // Placeholder for MA200
        ema20: tradingStrategies.calculateEMATrend(ohlcData),
        macd: { value: 0, strength: 0.5, signal: 'neutral' }, // Placeholder
        volume: tradingStrategies.calculateVolumeAnalysis(ohlcData),
        vwap: tradingStrategies.calculateVWAP(ohlcData),
        atr: tradingStrategies.calculateVolatility(ohlcData),
        pattern: tradingStrategies.calculatePriceAction(ohlcData),
        momentum: tradingStrategies.calculateMomentum(ohlcData)
      };

      return {
        success: true,
        data: {
          price: marketData.price,
          volume24h: marketData.volume24h,
          high24h: marketData.high24h,
          low24h: marketData.low24h,
          priceChangePercent24h: marketData.priceChangePercent24h,
          orderbook: marketData.orderbook,
          ohlc: ohlcData,
          indicators
        },
        latencyMs: Date.now() - startTime,
        provider: 'binance'
      };
    } catch (error: any) {
      console.error('❌ BINANCE PROVIDER ERROR:', {
        symbol,
        error: error.message,
        stack: error.stack,
        latencyMs: Date.now() - startTime
      });

      return {
        success: false,
        data: null,
        latencyMs: Date.now() - startTime,
        provider: 'binance',
        error: error.message + ' | Stack: ' + error.stack
      };
    }
  }

  /**
   * Fetch Bybit Public Data (Backup for Binance)
   */
  private async fetchBybitPublicData(symbol: string): Promise<FreeModeProviderResult> {
    const startTime = Date.now();

    try {
      // Bybit public API endpoints
      const response = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`);

      if (!response.ok) {
        throw new Error(`Bybit API error: ${response.status}`);
      }

      const data = await response.json();
      const ticker = data.result?.list?.[0];

      if (!ticker) {
        throw new Error('No ticker data from Bybit');
      }

      return {
        success: true,
        data: {
          price: parseFloat(ticker.lastPrice),
          volume24h: parseFloat(ticker.volume24h),
          high24h: parseFloat(ticker.highPrice24h),
          low24h: parseFloat(ticker.lowPrice24h),
          priceChangePercent24h: parseFloat(ticker.price24hPcnt) * 100
        },
        latencyMs: Date.now() - startTime,
        provider: 'bybit'
      };
    } catch (error: any) {
      return {
        success: false,
        data: null,
        latencyMs: Date.now() - startTime,
        provider: 'bybit',
        error: error.message
      };
    }
  }

  /**
   * Fetch OKX Public Data (Backup for Binance)
   */
  private async fetchOKXPublicData(symbol: string): Promise<FreeModeProviderResult> {
    const startTime = Date.now();

    try {
      // Convert symbol format (BTCUSDT -> BTC-USDT)
      const okxSymbol = symbol.replace('USDT', '-USDT');

      const response = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${okxSymbol}`);

      if (!response.ok) {
        throw new Error(`OKX API error: ${response.status}`);
      }

      const data = await response.json();
      const ticker = data.data?.[0];

      if (!ticker) {
        throw new Error('No ticker data from OKX');
      }

      return {
        success: true,
        data: {
          price: parseFloat(ticker.last),
          volume24h: parseFloat(ticker.vol24h),
          high24h: parseFloat(ticker.high24h),
          low24h: parseFloat(ticker.low24h),
          priceChangePercent24h: (parseFloat(ticker.last) - parseFloat(ticker.open24h)) / parseFloat(ticker.open24h) * 100
        },
        latencyMs: Date.now() - startTime,
        provider: 'okx'
      };
    } catch (error: any) {
      return {
        success: false,
        data: null,
        latencyMs: Date.now() - startTime,
        provider: 'okx',
        error: error.message
      };
    }
  }

  /**
   * Fetch KuCoin Public Data (Backup for Binance)
   */
  private async fetchKuCoinPublicData(symbol: string): Promise<FreeModeProviderResult> {
    const startTime = Date.now();

    try {
      // Convert symbol format (BTCUSDT -> BTC-USDT)
      const kucoinSymbol = symbol.replace('USDT', '-USDT');

      const response = await fetch(`https://api.kucoin.com/api/v1/market/stats?symbol=${kucoinSymbol}`);

      if (!response.ok) {
        throw new Error(`KuCoin API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.data) {
        throw new Error('No ticker data from KuCoin');
      }

      return {
        success: true,
        data: {
          price: parseFloat(data.data.last),
          volume24h: parseFloat(data.data.vol),
          high24h: parseFloat(data.data.high),
          low24h: parseFloat(data.data.low),
          priceChangePercent24h: parseFloat(data.data.changeRate) * 100
        },
        latencyMs: Date.now() - startTime,
        provider: 'kucoin'
      };
    } catch (error: any) {
      return {
        success: false,
        data: null,
        latencyMs: Date.now() - startTime,
        provider: 'kucoin',
        error: error.message
      };
    }
  }

  /**
   * Fetch CryptoCompare FREE MODE Data (1h/1d trend only)
   */
  private async fetchCryptoCompareFreeData(symbol: string, integrations: any): Promise<FreeModeProviderResult> {
    const startTime = Date.now();

    try {
      console.log('🔄 CRYPTOCOMPARE PROVIDER: Starting fetch for', symbol, '- API Key present:', !!(integrations.cryptocompare?.apiKey));
      console.log('🔄 CRYPTOCOMPARE PROVIDER: Attempting fetch for CRYPTOCOMPARE API...');

      const baseSymbol = symbol.replace('USDT', '').replace('USD', '');
      console.log('🔄 CRYPTOCOMPARE PROVIDER: Converted symbol', symbol, 'to', baseSymbol);

      const ccAdapter = new CryptoCompareAdapter(integrations.cryptocompare?.apiKey || '');

      // Get 1h and 1d candle data for trend analysis
      console.log('🔄 CRYPTOCOMPARE PROVIDER: Making HTTP request to CryptoCompare API for', `${baseSymbol}USDT`);
      const histoHour = await ccAdapter.getOHLCData(`${baseSymbol}USDT`);
      const histoDay = await ccAdapter.getOHLCData(`${baseSymbol}USDT`);
      console.log('🔄 CRYPTOCOMPARE PROVIDER: Response received - hour data points:', histoHour.ohlc?.length, 'day data points:', histoDay.ohlc?.length);

      // Calculate simple trends
      const hour1Trend = histoHour.ohlc?.length >= 2 ?
        (histoHour.ohlc[0].close > histoHour.ohlc[1].close ? 'bullish' : 'bearish') : 'neutral';

      const day1Trend = histoDay.ohlc?.length >= 2 ?
        (histoDay.ohlc[0].close > histoDay.ohlc[1].close ? 'bullish' : 'bearish') : 'neutral';

      return {
        success: true,
        data: {
          trend1h: hour1Trend,
          trend1d: day1Trend,
          confirmationSignal: hour1Trend === day1Trend ? hour1Trend : 'neutral'
        },
        latencyMs: Date.now() - startTime,
        provider: 'cryptocompare'
      };
    } catch (error: any) {
      console.error('❌ CRYPTOCOMPARE PROVIDER ERROR:', {
        symbol,
        error: error.message,
        stack: error.stack,
        latencyMs: Date.now() - startTime
      });

      return {
        success: false,
        data: null,
        latencyMs: Date.now() - startTime,
        provider: 'cryptocompare',
        error: error.message + ' | Stack: ' + error.stack
      };
    }
  }

  /**
   * Fetch AlphaVantage FREE Data (Backup for CryptoCompare)
   */
  private async fetchAlphaVantageFreeData(symbol: string): Promise<FreeModeProviderResult> {
    const startTime = Date.now();

    try {
      // AlphaVantage has very limited free crypto data
      // This is a placeholder - in reality AlphaVantage free tier has restrictions
      const baseSymbol = symbol.replace('USDT', '').replace('USD', '');

      const response = await fetch(`https://www.alphavantage.co/query?function=DIGITAL_CURRENCY_DAILY&symbol=${baseSymbol}&market=USD&apikey=demo`);

      if (!response.ok) {
        throw new Error(`AlphaVantage API error: ${response.status}`);
      }

      const data = await response.json();

      if (data['Error Message'] || data['Note']) {
        throw new Error('AlphaVantage free tier limit reached');
      }

      // Extract recent daily data for trend
      const timeSeries = data['Time Series (Digital Currency Daily)'];
      if (!timeSeries) {
        throw new Error('No time series data');
      }

      const dates = Object.keys(timeSeries).sort().reverse();
      const latest = timeSeries[dates[0]];
      const previous = timeSeries[dates[1]];

      if (!latest || !previous) {
        throw new Error('Insufficient data for trend analysis');
      }

      const trend1d = parseFloat(latest['4a. close (USD)']) > parseFloat(previous['4a. close (USD)']) ? 'bullish' : 'bearish';

      return {
        success: true,
        data: {
          trend1d: trend1d,
          confirmationSignal: trend1d // Limited data, so use daily trend as confirmation
        },
        latencyMs: Date.now() - startTime,
        provider: 'alphavantage'
      };
    } catch (error: any) {
      return {
        success: false,
        data: null,
        latencyMs: Date.now() - startTime,
        provider: 'alphavantage',
        error: error.message
      };
    }
  }

  /**
   * Fetch CoinGecko FREE Data (Backup for CryptoCompare)
   */
  private async fetchCoinGeckoFreeData(symbol: string): Promise<FreeModeProviderResult> {
    const startTime = Date.now();

    try {
      // CoinGecko symbol to ID mapping
      const COINGECKO_MAP: Record<string, string> = {
        BTCUSDT: "bitcoin",
        ETHUSDT: "ethereum",
        SOLUSDT: "solana",
        BNBUSDT: "binancecoin",
        XRPUSDT: "ripple",
        ADAUSDT: "cardano",
        DOGEUSDT: "dogecoin",
        TRXUSDT: "tron",
        DOTUSDT: "polkadot",
        MATICUSDT: "matic-network",
        LTCUSDT: "litecoin",
        BCHUSDT: "bitcoin-cash",
        LINKUSDT: "chainlink",
        UNIUSDT: "uniswap",
        XLMUSDT: "stellar",
        ATOMUSDT: "cosmos",
        XMRUSDT: "monero",
        FILUSDT: "filecoin",
        IMXUSDT: "immutable-x",
      };

      // Convert symbol to valid CoinGecko ID
      const id = COINGECKO_MAP[symbol] || symbol.toLowerCase().replace('usdt', '').replace('usd', '');

      // CoinGecko free API for price data
      const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`);

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data[id]) {
        throw new Error('No price data available');
      }

      const priceData = data[id];
      const trend1d = priceData.usd_24h_change > 0 ? 'bullish' : 'bearish';

      return {
        success: true,
        data: {
          trend1d: trend1d,
          confirmationSignal: trend1d
        },
        latencyMs: Date.now() - startTime,
        provider: 'coingecko'
      };
    } catch (error: any) {
      return {
        success: false,
        data: null,
        latencyMs: Date.now() - startTime,
        provider: 'coingecko',
        error: error.message
      };
    }
  }

  /**
   * Fetch CoinMarketCap FREE Metadata (no price data)
   */
  private async fetchCoinMarketCapFreeMetadata(symbol: string, integrations: any): Promise<FreeModeProviderResult> {
    const startTime = Date.now();

    try {
      console.log('🔄 COINMARKETCAP PROVIDER: Starting fetch for', symbol, '- API Key present:', !!(integrations.cmc?.apiKey));
      console.log('🔄 COINMARKETCAP PROVIDER: Attempting fetch for COINMARKETCAP API...');

      const metadata = await fetchCoinMarketCapMetadata(symbol, integrations.cmc?.apiKey);
      console.log('🔄 COINMARKETCAP PROVIDER: Response received - success:', metadata?.success, 'name:', metadata?.metadata?.name);

      if (!metadata || !metadata.success) {
        throw new Error('Failed to fetch CMC metadata');
      }

      return {
        success: true,
        data: {
          name: metadata.metadata?.name || '',
          symbol: metadata.metadata?.symbol || '',
          category: metadata.metadata?.category || '',
          tags: metadata.metadata?.tags || [],
          rank: metadata.metadata?.market_cap_rank || 0,
          supply: {
            circulating: metadata.metadata?.circulating_supply || 0,
            total: metadata.metadata?.total_supply || 0
          },
          description: metadata.metadata?.description || ''
        },
        latencyMs: Date.now() - startTime,
        provider: 'coinmarketcap'
      };
    } catch (error: any) {
      console.error('❌ COINMARKETCAP PROVIDER ERROR:', {
        symbol,
        error: error.message,
        stack: error.stack,
        latencyMs: Date.now() - startTime
      });

      return {
        success: false,
        data: null,
        latencyMs: Date.now() - startTime,
        provider: 'coinmarketcap',
        error: error.message + ' | Stack: ' + error.stack
      };
    }
  }

  /**
   * Fetch CoinGecko Metadata (Backup for CMC)
   */
  private async fetchCoinGeckoMetadata(symbol: string): Promise<FreeModeProviderResult> {
    try {
      // CoinGecko symbol to ID mapping
      const COINGECKO_MAP: Record<string, string> = {
        BTCUSDT: "bitcoin",
        ETHUSDT: "ethereum",
        SOLUSDT: "solana",
        BNBUSDT: "binancecoin",
        XRPUSDT: "ripple",
        ADAUSDT: "cardano",
        DOGEUSDT: "dogecoin",
        TRXUSDT: "tron",
        DOTUSDT: "polkadot",
        MATICUSDT: "matic-network",
        LTCUSDT: "litecoin",
        BCHUSDT: "bitcoin-cash",
        LINKUSDT: "chainlink",
        UNIUSDT: "uniswap",
        XLMUSDT: "stellar",
        ATOMUSDT: "cosmos",
        XMRUSDT: "monero",
        FILUSDT: "filecoin",
        IMXUSDT: "immutable-x",
      };

      // Convert symbol to valid CoinGecko ID
      const id = COINGECKO_MAP[symbol] || symbol.toLowerCase();

      console.log("[HTTP-REQ]", "CoinGecko", `https://api.coingecko.com/api/v3/coins/${id}`);
      const response = await fetch(`https://api.coingecko.com/api/v3/coins/${id}`);

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      console.log("[HTTP-RES]", "CoinGecko", `https://api.coingecko.com/api/v3/coins/${id}`, "status", response.status);
      const data = await response.json();

      return {
        success: true,
        data: {
          name: data.name || '',
          symbol: data.symbol?.toUpperCase() || '',
          category: data.categories?.[0] || '',
          tags: data.categories || [],
          rank: data.market_cap_rank || 0,
          supply: {
            circulating: data.market_data?.circulating_supply || 0,
            total: data.market_data?.total_supply || 0
          },
          description: data.description?.en || '',
          logo: data.image?.large || '',
          market_cap: data.market_data?.market_cap?.usd || 0,
          links: data.links || {}
        },
        latencyMs: 0,
        provider: 'coingecko'
      };
    } catch (error: any) {
      console.error("[HTTP-ERR]", "CoinGecko", `https://api.coingecko.com/api/v3/coins/${symbol}`, error.message, error.stack);
      throw error;
    }
  }

  /**
   * Fetch CoinPaprika Metadata (Backup)
   */
  private async fetchCoinPaprikaMetadata(symbol: string): Promise<FreeModeProviderResult> {
    try {
      // Convert symbol to CoinPaprika ID mapping (simplified)
      const paprikaIds: { [key: string]: string } = {
        'BTC': 'btc-bitcoin',
        'ETH': 'eth-ethereum',
        'BNB': 'bnb-binance-coin',
        'ADA': 'ada-cardano',
        'SOL': 'sol-solana',
        'XRP': 'xrp-xrp',
        'DOT': 'dot-polkadot',
        'DOGE': 'doge-dogecoin',
        'AVAX': 'avax-avalanche',
        'LTC': 'ltc-litecoin'
      };

      const paprikaId = paprikaIds[symbol] || `${symbol.toLowerCase()}-${symbol.toLowerCase()}`;

      console.log("[HTTP-REQ]", "CoinPaprika", `https://api.coinpaprika.com/v1/coins/${paprikaId}`);
      const response = await fetch(`https://api.coinpaprika.com/v1/coins/${paprikaId}`);

      if (!response.ok) {
        throw new Error(`CoinPaprika API error: ${response.status}`);
      }

      console.log("[HTTP-RES]", "CoinPaprika", `https://api.coinpaprika.com/v1/coins/${paprikaId}`, "status", response.status);
      const data = await response.json();

      return {
        success: true,
        data: {
          name: data.name || '',
          symbol: data.symbol || '',
          category: data.type || '',
          tags: data.tags || [],
          rank: data.rank || 0,
          supply: {
            circulating: 0, // CoinPaprika doesn't provide this in basic endpoint
            total: 0
          },
          description: data.description || '',
          logo: data.logo || '',
          market_cap: 0,
          links: data.links || {}
        },
        latencyMs: 0,
        provider: 'coinpaprika'
      };
    } catch (error: any) {
      console.error("[HTTP-ERR]", "CoinPaprika", `https://api.coinpaprika.com/v1/coins/${symbol}`, error.message, error.stack);
      throw error;
    }
  }

  /**
   * Fetch NewsData FREE News
   */
  private async fetchNewsDataFree(symbol: string, integrations: any): Promise<FreeModeProviderResult> {
    const startTime = Date.now();

    try {
      console.log('🔄 NEWSDATA PROVIDER: Starting fetch for', symbol, '- API Key present:', !!(integrations.newsdata?.apiKey));
      console.log('🔄 NEWSDATA PROVIDER: Attempting fetch for NEWSDATA API...');

      const newsData = await fetchNewsData(integrations.newsdata?.apiKey || '', symbol);
      console.log('🔄 NEWSDATA PROVIDER: Response received - success:', newsData?.success, 'article count:', newsData?.articles?.length);

      if (!newsData || !newsData.success) {
        throw new Error('Failed to fetch news data');
      }

      // Transform to free mode format
      const articles = (newsData.articles || []).slice(0, 5).map((article: any) => ({
        title: article.title || '',
        source: article.source || '',
        url: article.url || '',
        published_at: article.published_at || new Date().toISOString(),
        sentiment: this.calculateUnifiedSentiment(article.title + ' ' + (article.description || ''))
      }));

      return {
        success: true,
        data: {
          articles,
          sentimentScore: newsData.sentiment || 0.5
        },
        latencyMs: Date.now() - startTime,
        provider: 'newsdata'
      };
    } catch (error: any) {
      console.error('❌ NEWSDATA PROVIDER ERROR:', {
        symbol,
        error: error.message,
        stack: error.stack,
        latencyMs: Date.now() - startTime
      });

      return {
        success: false,
        data: null,
        latencyMs: Date.now() - startTime,
        provider: 'newsdata',
        error: error.message + ' | Stack: ' + error.stack
      };
    }
  }

  /**
   * Fetch CryptoPanic FREE News (Backup for NewsData)
   */
  private async fetchCryptoPanicFree(symbol: string, integrations: any): Promise<FreeModeProviderResult> {
    try {
      const baseSymbol = symbol.toLowerCase().replace('usdt', '').replace('usd', '');
      const authToken = integrations?.cryptopanic?.apiKey || 'free';

      console.log("[HTTP-REQ]", "CryptoPanic", `https://cryptopanic.com/api/v3/posts/`);
      const response = await fetch(`https://cryptopanic.com/api/v3/posts/?auth_token=${authToken}&currencies=${baseSymbol}&kind=news`);

      if (!response.ok) {
        throw new Error(`CryptoPanic API error: ${response.status}`);
      }

      console.log("[HTTP-RES]", "CryptoPanic", `https://cryptopanic.com/api/v3/posts/`, "status", response.status);
      const data = await response.json();

      // Transform CryptoPanic data
      const articles = (data.results || []).slice(0, 5).map((post: any) => ({
        title: post.title || '',
        source: 'CryptoPanic',
        url: post.url || '',
        published_at: post.published_at || new Date().toISOString(),
        sentiment: this.calculateUnifiedSentiment(post.title + ' ' + (post.description || ''))
      }));

      return {
        success: true,
        data: {
          articles,
          sentimentScore: this.calculateWeightedSentiment(articles)
        },
        latencyMs: 0,
        provider: 'cryptopanic'
      };
    } catch (error: any) {
      console.error("[HTTP-ERR]", "CryptoPanic", `https://cryptopanic.com/api/v3/posts/`, error.message, error.stack);
      throw error;
    }
  }

  /**
   * Fetch Reddit News via scraping (Backup for News)
   */
  private async fetchRedditNews(symbol: string): Promise<FreeModeProviderResult> {
    try {
      const baseSymbol = symbol.toLowerCase().replace('usdt', '').replace('usd', '');

      // Reddit API endpoints for crypto subreddits
      const subreddits = ['cryptocurrency', 'bitcoin'];
      const articles: any[] = [];

      for (const subreddit of subreddits) {
        try {
          console.log("[HTTP-REQ]", "Reddit", `https://www.reddit.com/r/${subreddit}/search.json`);
          const response = await fetch(`https://www.reddit.com/r/${subreddit}/search.json?q=${baseSymbol}&sort=new&limit=5&t=day`, {
            headers: {
              'User-Agent': 'DLXTrade/1.0'
            }
          });

          if (response.ok) {
            console.log("[HTTP-RES]", "Reddit", `https://www.reddit.com/r/${subreddit}/search.json`, "status", response.status);
            const data = await response.json();
            const posts = data.data?.children || [];

            for (const post of posts.slice(0, 2)) { // Limit 2 per subreddit
              articles.push({
                title: post.data.title || '',
                source: `Reddit r/${subreddit}`,
                url: `https://reddit.com${post.data.permalink}`,
                published_at: new Date(post.data.created_utc * 1000).toISOString(),
                sentiment: this.calculateUnifiedSentiment(post.data.title + ' ' + (post.data.selftext || ''))
              });
            }
          } else {
            console.error("[HTTP-ERR]", "Reddit", `https://www.reddit.com/r/${subreddit}/search.json`, `HTTP ${response.status}`, response.status);
          }
        } catch (subError) {
          console.error("[HTTP-ERR]", "Reddit", `https://www.reddit.com/r/${subreddit}/search.json`, subError.message, subError.stack);
          // Continue with other subreddits
        }
      }

      return {
        success: true,
        data: {
          articles: articles.slice(0, 5), // Limit total articles
          sentimentScore: this.calculateWeightedSentiment(articles)
        },
        latencyMs: 0,
        provider: 'reddit'
      };
    } catch (error: any) {
      console.error("[HTTP-ERR]", "Reddit", "General error", error.message, error.stack);
      throw error;
    }
  }

  /**
   * Fetch GNews (Backup)
   */
  private async fetchGNews(symbol: string): Promise<FreeModeProviderResult> {
    try {
      const baseSymbol = symbol.toLowerCase().replace('usdt', '').replace('usd', '');

      console.log("[HTTP-REQ]", "GNews", `https://gnews.io/api/v4/search`);
      const response = await fetch(`https://gnews.io/api/v4/search?q=${baseSymbol}&token=demo&max=5`);

      if (!response.ok) {
        throw new Error(`GNews API error: ${response.status}`);
      }

      console.log("[HTTP-RES]", "GNews", `https://gnews.io/api/v4/search`, "status", response.status);
      const data = await response.json();

      // Transform GNews data
      const articles = (data.articles || []).slice(0, 5).map((article: any) => ({
        title: article.title || '',
        source: article.source?.name || 'GNews',
        url: article.url || '',
        published_at: article.publishedAt || new Date().toISOString(),
        sentiment: this.calculateUnifiedSentiment(article.title + ' ' + (article.description || ''))
      }));

      return {
        success: true,
        data: {
          articles,
          sentimentScore: this.calculateWeightedSentiment(articles)
        },
        latencyMs: 0,
        provider: 'gnews'
      };
    } catch (error: any) {
      console.error("[HTTP-ERR]", "GNews", `https://gnews.io/api/v4/search`, error.message, error.stack);
      throw error;
    }
  }

  /**
   * Calculate unified sentiment score (-1 to 1)
   * positive: +1, negative: -1, neutral: 0
   */
  private calculateUnifiedSentiment(text: string): number {
    const lowerText = text.toLowerCase();

    const positiveWords = ['bull', 'rise', 'gain', 'surge', 'rally', 'up', 'bullish', 'moon', 'pump', 'breakthrough', 'adoption', 'growth', 'success', 'profit', 'increase', 'high', 'strong', 'positive'];
    const negativeWords = ['bear', 'fall', 'drop', 'crash', 'decline', 'down', 'bearish', 'dump', 'sell-off', 'correction', 'loss', 'decrease', 'low', 'weak', 'negative', 'fail', 'crash', 'dump'];

    let positiveCount = 0;
    let negativeCount = 0;

    positiveWords.forEach(word => {
      if (lowerText.includes(word)) positiveCount++;
    });

    negativeWords.forEach(word => {
      if (lowerText.includes(word)) negativeCount++;
    });

    if (positiveCount > negativeCount) return 1; // positive
    if (negativeCount > positiveCount) return -1; // negative
    return 0; // neutral
  }

  /**
   * Calculate weighted sentiment score (0-1 scale with neutral at 0.5)
   */
  private calculateWeightedSentiment(articles: any[]): number {
    if (articles.length === 0) return 0.5;

    const sentiments = articles.map(article => article.sentiment || 0);
    const averageSentiment = sentiments.reduce((sum, sentiment) => sum + sentiment, 0) / sentiments.length;

    // Convert from -1/+1 scale to 0-1 scale (0.5 = neutral)
    return (averageSentiment + 1) / 2;
  }

  /**
   * Fetch CryptoCompare Market Data (Primary)
   */
  private async fetchCryptoCompareMarketData(symbol: string, integrations: any): Promise<FreeModeProviderResult> {
    try {
      console.log("[HTTP-REQ]", "CryptoCompare", `https://min-api.cryptocompare.com/data/price`);
      const response = await fetch(`https://min-api.cryptocompare.com/data/price?fsym=${symbol}&tsyms=USD&api_key=${integrations?.cryptocompare?.apiKey || ''}`);

      if (!response.ok) {
        throw new Error(`CryptoCompare API error: ${response.status}`);
      }

      console.log("[HTTP-RES]", "CryptoCompare", `https://min-api.cryptocompare.com/data/price`, "status", response.status);
      const data = await response.json();

      if (!data.USD) {
        throw new Error('No USD price data from CryptoCompare');
      }

      return {
        success: true,
        data: {
          hasData: true,
          price: data.USD,
          volume24h: 0, // CryptoCompare basic API doesn't provide volume
          change24h: 0,
          high24h: 0,
          low24h: 0
        },
        latencyMs: 0,
        provider: 'cryptocompare'
      };
    } catch (error: any) {
      console.error("[HTTP-ERR]", "CryptoCompare", `https://min-api.cryptocompare.com/data/price`, error.message, error.stack);
      throw error;
    }
  }

  /**
   * Fetch CoinGecko Market Data (Backup)
   */
  private async fetchCoinGeckoMarketData(symbol: string): Promise<FreeModeProviderResult> {
    try {
      // CoinGecko symbol to ID mapping
      const COINGECKO_MAP: Record<string, string> = {
        BTCUSDT: "bitcoin",
        ETHUSDT: "ethereum",
        SOLUSDT: "solana",
        BNBUSDT: "binancecoin",
        XRPUSDT: "ripple",
        ADAUSDT: "cardano",
        DOGEUSDT: "dogecoin",
        TRXUSDT: "tron",
        DOTUSDT: "polkadot",
        MATICUSDT: "matic-network",
        LTCUSDT: "litecoin",
        BCHUSDT: "bitcoin-cash",
        LINKUSDT: "chainlink",
        UNIUSDT: "uniswap",
        XLMUSDT: "stellar",
        ATOMUSDT: "cosmos",
        XMRUSDT: "monero",
        FILUSDT: "filecoin",
        IMXUSDT: "immutable-x",
      };

      // Convert symbol to valid CoinGecko ID
      const id = COINGECKO_MAP[symbol] || symbol.toLowerCase();

      console.log("[HTTP-REQ]", "CoinGecko", `https://api.coingecko.com/api/v3/simple/price`);
      const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`);

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      console.log("[HTTP-RES]", "CoinGecko", `https://api.coingecko.com/api/v3/simple/price`, "status", response.status);
      const data = await response.json();

      if (!data[id]) {
        throw new Error('No price data from CoinGecko');
      }

      const coinData = data[id];

      return {
        success: true,
        data: {
          hasData: true,
          price: coinData.usd || 0,
          volume24h: coinData.usd_24h_vol || 0,
          change24h: coinData.usd_24h_change || 0,
          high24h: 0, // CoinGecko basic API doesn't provide high/low
          low24h: 0
        },
        latencyMs: 0,
        provider: 'coingecko'
      };
    } catch (error: any) {
      console.error("[HTTP-ERR]", "CoinGecko", `https://api.coingecko.com/api/v3/simple/price`, error.message, error.stack);
      throw error;
    }
  }

  /**
   * Fetch KuCoin Market Data (Backup)
   */
  private async fetchKuCoinMarketData(symbol: string): Promise<FreeModeProviderResult> {
    try {
      console.log("[HTTP-REQ]", "KuCoin", `https://api.kucoin.com/api/v1/market/stats`);
      const response = await fetch(`https://api.kucoin.com/api/v1/market/stats?symbol=${symbol}`);

      if (!response.ok) {
        throw new Error(`KuCoin API error: ${response.status}`);
      }

      console.log("[HTTP-RES]", "KuCoin", `https://api.kucoin.com/api/v1/market/stats`, "status", response.status);
      const data = await response.json();

      if (!data.data) {
        throw new Error('No market data from KuCoin');
      }

      const marketData = data.data;

      return {
        success: true,
        data: {
          hasData: true,
          price: parseFloat(marketData.last || '0'),
          volume24h: parseFloat(marketData.vol || '0'),
          change24h: parseFloat(marketData.changeRate || '0') * 100,
          high24h: parseFloat(marketData.high || '0'),
          low24h: parseFloat(marketData.low || '0')
        },
        latencyMs: 0,
        provider: 'kucoin'
      };
    } catch (error: any) {
      console.error("[HTTP-ERR]", "KuCoin", `https://api.kucoin.com/api/v1/market/stats`, error.message, error.stack);
      throw error;
    }
  }

  /**
   * Fetch Bybit Market Data (Backup)
   */
  private async fetchBybitMarketData(symbol: string): Promise<FreeModeProviderResult> {
    try {
      console.log("[HTTP-REQ]", "Bybit", `https://api.bybit.com/v5/market/tickers`);
      const response = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`);

      if (!response.ok) {
        throw new Error(`Bybit API error: ${response.status}`);
      }

      console.log("[HTTP-RES]", "Bybit", `https://api.bybit.com/v5/market/tickers`, "status", response.status);
      const data = await response.json();

      const ticker = data.result?.list?.[0];
      if (!ticker) {
        throw new Error('No ticker data from Bybit');
      }

      return {
        success: true,
        data: {
          hasData: true,
          price: parseFloat(ticker.lastPrice || '0'),
          volume24h: parseFloat(ticker.volume24h || '0'),
          change24h: parseFloat(ticker.price24hPcnt || '0') * 100,
          high24h: parseFloat(ticker.highPrice24h || '0'),
          low24h: parseFloat(ticker.lowPrice24h || '0')
        },
        latencyMs: 0,
        provider: 'bybit'
      };
    } catch (error: any) {
      console.error("[HTTP-ERR]", "Bybit", `https://api.bybit.com/v5/market/tickers`, error.message, error.stack);
      throw error;
    }
  }

  /**
   * Fetch OKX Market Data (Backup)
   */
  private async fetchOKXMarketData(symbol: string): Promise<FreeModeProviderResult> {
    try {
      console.log("[HTTP-REQ]", "OKX", `https://www.okx.com/api/v5/market/ticker`);
      const response = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${symbol}`);

      if (!response.ok) {
        throw new Error(`OKX API error: ${response.status}`);
      }

      console.log("[HTTP-RES]", "OKX", `https://www.okx.com/api/v5/market/ticker`, "status", response.status);
      const data = await response.json();

      const ticker = data.data?.[0];
      if (!ticker) {
        throw new Error('No ticker data from OKX');
      }

      return {
        success: true,
        data: {
          hasData: true,
          price: parseFloat(ticker.last || '0'),
          volume24h: parseFloat(ticker.vol24h || '0'),
          change24h: ((parseFloat(ticker.last || '0') - parseFloat(ticker.open24h || '0')) / parseFloat(ticker.open24h || '0')) * 100,
          high24h: parseFloat(ticker.high24h || '0'),
          low24h: parseFloat(ticker.low24h || '0')
        },
        latencyMs: 0,
        provider: 'okx'
      };
    } catch (error: any) {
      console.error("[HTTP-ERR]", "OKX", `https://www.okx.com/api/v5/market/ticker`, error.message, error.stack);
      throw error;
    }
  }

  /**
   * Fetch Bitget Market Data (Backup)
   */
  private async fetchBitgetMarketData(symbol: string): Promise<FreeModeProviderResult> {
    try {
      console.log("[HTTP-REQ]", "Bitget", `https://api.bitget.com/api/spot/v1/market/ticker`);
      const response = await fetch(`https://api.bitget.com/api/spot/v1/market/ticker?symbol=${symbol}`);

      if (!response.ok) {
        throw new Error(`Bitget API error: ${response.status}`);
      }

      console.log("[HTTP-RES]", "Bitget", `https://api.bitget.com/api/spot/v1/market/ticker`, "status", response.status);
      const data = await response.json();

      const ticker = data.data?.[0];
      if (!ticker) {
        throw new Error('No ticker data from Bitget');
      }

      return {
        success: true,
        data: {
          hasData: true,
          price: parseFloat(ticker.close || '0'),
          volume24h: parseFloat(ticker.usdtVol || '0'),
          change24h: parseFloat(ticker.change || '0'),
          high24h: parseFloat(ticker.high24h || '0'),
          low24h: parseFloat(ticker.low24h || '0')
        },
        latencyMs: 0,
        provider: 'bitget'
      };
    } catch (error: any) {
      console.error("[HTTP-ERR]", "Bitget", `https://api.bitget.com/api/spot/v1/market/ticker`, error.message, error.stack);
      throw error;
    }
  }

  /**
   * Calculate comprehensive accuracy score based on multi-factor analysis
   */
  private calculateAccuracyScore(
    signal: 'BUY' | 'SELL' | 'HOLD',
    indicators: any,
    marketData: any,
    ccData: any,
    metadata: any,
    newsData: any,
    strategy?: string
  ): number {
    // 1. INDICATOR ALIGNMENT SCORE (0-100) - Weight: 40%
    let indicatorScore = 50; // Start at neutral

    // MACD strength alignment (+10 if matches signal)
    if (indicators.macd?.signal === 'bullish' && signal === 'BUY') indicatorScore += 10;
    else if (indicators.macd?.signal === 'bearish' && signal === 'SELL') indicatorScore += 10;

    // Price vs Moving Averages alignment
    const currentPrice = marketData?.price || indicators?.latest?.price || 0;
    const ema20 = indicators.ema20?.value || currentPrice;
    const sma50 = indicators.ma50?.value || currentPrice;
    const sma200 = indicators.ma200?.value || currentPrice;

    if (signal === 'BUY') {
      // For BUY signals, price should be above key averages
      if (currentPrice > ema20) indicatorScore += 3;
      if (currentPrice > sma50) indicatorScore += 3;
      if (currentPrice > sma200) indicatorScore += 4;
      // Bonus for trend alignment (EMA20 > SMA50 > SMA200)
      if (ema20 > sma50 && sma50 > sma200) indicatorScore += 5;
    } else if (signal === 'SELL') {
      // For SELL signals, price should be below key averages
      if (currentPrice < ema20) indicatorScore += 3;
      if (currentPrice < sma50) indicatorScore += 3;
      if (currentPrice < sma200) indicatorScore += 4;
      // Bonus for trend alignment (EMA20 < SMA50 < SMA200)
      if (ema20 < sma50 && sma50 < sma200) indicatorScore += 5;
    }

    // RSI support (+5 if supports direction, -10 if extreme against)
    const rsi = indicators.rsi?.value || 50;
    if (signal === 'BUY' && rsi < 70) indicatorScore += 5; // RSI supports BUY (not overbought)
    else if (signal === 'SELL' && rsi > 30) indicatorScore += 5; // RSI supports SELL (not oversold)
    else if (signal === 'BUY' && rsi > 80) indicatorScore -= 10; // RSI extreme against BUY
    else if (signal === 'SELL' && rsi < 20) indicatorScore -= 10; // RSI extreme against SELL

    // VWAP alignment (+5)
    if (indicators.vwap?.signal === 'bullish' && signal === 'BUY') indicatorScore += 5;
    else if (indicators.vwap?.signal === 'bearish' && signal === 'SELL') indicatorScore += 5;

    // Strategy-specific adjustments
    if (strategy === 'Scalping') {
      // Higher weight on momentum & EMA20
      if (indicators.ema20?.emaTrend === 'bullish' && signal === 'BUY') indicatorScore += 5;
      else if (indicators.ema20?.emaTrend === 'bearish' && signal === 'SELL') indicatorScore += 5;
    } else if (strategy === 'Swing') {
      // Higher weight on SMA50 & market regime
      if (indicators.ma50?.smaTrend === 'bullish' && signal === 'BUY') indicatorScore += 5;
      else if (indicators.ma50?.smaTrend === 'bearish' && signal === 'SELL') indicatorScore += 5;
    } else if (strategy === 'Breakout') {
      // Higher weight on volume & volatility patterns
      if (indicators.pattern?.confidence > 0.7) indicatorScore += 5;
    } else if (strategy === 'Trend-following') {
      // Higher weight on MA alignment & VWAP
      if (indicators.vwap?.signal === signal.toLowerCase()) indicatorScore += 5;
    }

    indicatorScore = Math.max(0, Math.min(100, indicatorScore));

    // 2. MARKET STRUCTURE SCORE (0-100) - Weight: 25%
    let marketStructureScore = 50; // Start at neutral

    // Trend alignment (+10 if 1h & 1d match)
    if (ccData?.trend1h && ccData?.trend1d) {
      if (ccData.trend1h === ccData.trend1d) {
        marketStructureScore += 10;
        if ((ccData.trend1h === 'bullish' && signal === 'BUY') ||
          (ccData.trend1h === 'bearish' && signal === 'SELL')) {
          marketStructureScore += 10; // Market regime aligns with signal
        }
      }
    }

    // Support/Resistance proximity (simplified - would need actual S/R levels)
    // For now, use VWAP as proxy for fair value
    const vwap = indicators.vwap?.value || currentPrice;
    const vwapDeviation = indicators.vwap?.deviation || 0;

    if (signal === 'BUY' && currentPrice < vwap && vwapDeviation < -2) {
      marketStructureScore += 5; // Price in discount zone for BUY
    } else if (signal === 'SELL' && currentPrice > vwap && vwapDeviation > 2) {
      marketStructureScore += 5; // Price in premium zone for SELL
    } else if (signal === 'BUY' && currentPrice > vwap && vwapDeviation > 2) {
      marketStructureScore -= 10; // Price at resistance for BUY signal
    } else if (signal === 'SELL' && currentPrice < vwap && vwapDeviation < -2) {
      marketStructureScore -= 10; // Price at support for SELL signal
    }

    marketStructureScore = Math.max(0, Math.min(100, marketStructureScore));

    // 3. MOMENTUM SCORE (0-100) - Weight: 15%
    let momentumScore = 50; // Start at neutral

    // Momentum indicator (convert 0-1 scale to 0-100)
    const momentum = indicators.momentum?.score || 0.5;
    momentumScore = momentum * 100;

    // ATR relative volatility penalty
    const atr = indicators.atr?.value || 0.01;
    const atrClassification = indicators.atr?.classification || 'medium';
    if (atrClassification === 'high') {
      momentumScore -= 15; // High volatility = risk penalty
    } else if (atrClassification === 'low') {
      momentumScore += 5; // Low volatility = more reliable
    }

    // Pattern confidence boost
    const patternConfidence = indicators.pattern?.confidence || 0;
    momentumScore += patternConfidence * 10; // Up to +10 for high confidence patterns

    momentumScore = Math.max(0, Math.min(100, momentumScore));

    // 4. VOLUME CONFIRMATION SCORE (0-100) - Weight: 10%
    let volumeScore = 50; // Start at neutral

    const volumeTrend = indicators.volume?.trend || 'neutral';
    const volumeStrength = indicators.volume?.score || 0.5;

    // High volume + trend alignment = +20
    if (volumeTrend === 'increasing' && volumeStrength > 0.7) {
      if (signal === 'BUY' && indicators.volume?.trend === 'increasing') volumeScore += 20;
      else if (signal === 'SELL' && indicators.volume?.trend === 'increasing') volumeScore += 20;
    }

    // Low volume penalty
    if (volumeStrength < 0.3) {
      volumeScore = Math.min(volumeScore, 20); // Cap at 20 for low volume
    }

    // Volume divergence penalty
    if (signal === 'BUY' && volumeTrend === 'decreasing') volumeScore -= 10;
    else if (signal === 'SELL' && volumeTrend === 'decreasing') volumeScore -= 10;

    volumeScore = Math.max(0, Math.min(100, volumeScore));

    // 5. NEWS & SENTIMENT SCORE (0-100) - Weight: 10%
    let newsScore = 50; // Start at neutral

    if (newsData?.sentimentScore !== undefined) {
      const sentimentScore = newsData.sentimentScore;
      newsScore = sentimentScore * 100; // Convert to 0-100 scale

      // Additional alignment bonuses
      if (sentimentScore > 0.6 && signal === 'BUY') newsScore += 10;
      else if (sentimentScore < 0.4 && signal === 'SELL') newsScore += 10;
      else if ((sentimentScore > 0.6 && signal === 'SELL') ||
        (sentimentScore < 0.4 && signal === 'BUY')) {
        newsScore -= 20; // Conflicting news = penalty
      }
    } else {
      // No news data available = slight penalty
      newsScore = 45;
    }

    newsScore = Math.max(0, Math.min(100, newsScore));

    // 6. VOLATILITY & RISK PENALTY (0 to -15%) - Weight: -10%
    let riskPenalty = 0;

    // ATR-based volatility penalty
    if (atrClassification === 'high') riskPenalty += 5;
    else if (atrClassification === 'medium') riskPenalty += 2;

    // Wrong-side EMA compression (high risk)
    if (signal === 'BUY' && ema20 < sma50 && sma50 < sma200) riskPenalty += 5;
    else if (signal === 'SELL' && ema20 > sma50 && sma50 > sma200) riskPenalty += 5;

    // High volatility + low volume mismatch
    if (atrClassification === 'high' && volumeStrength < 0.4) riskPenalty += 3;

    riskPenalty = Math.min(15, riskPenalty); // Max penalty of 15%

    // FINAL ACCURACY FORMULA
    let finalAccuracy = Math.max(0, Math.min(100,
      (indicatorScore * 0.40) +
      (marketStructureScore * 0.25) +
      (momentumScore * 0.15) +
      (volumeScore * 0.10) +
      (newsScore * 0.10) -
      (riskPenalty * 0.10)
    ));

    // Drop accuracy if critical providers fail
    if (!marketData?.success) finalAccuracy *= 0.8;
    if (!ccData?.success) finalAccuracy *= 0.9;
    if (!metadata?.success) finalAccuracy *= 0.95;
    if (!newsData?.success) finalAccuracy *= 0.95;

    return Math.max(10, Math.min(95, finalAccuracy / 100)); // Convert to 0.10-0.95 scale for consistency
  }

  /**
   * Combine FREE MODE v1.5 results from all providers
   */
  private async combineFreeModeResults(
    uid: string,
    symbol: string,
    marketDataResult: FreeModeProviderResult,
    ccResult: FreeModeProviderResult,
    cmcResult: FreeModeProviderResult,
    newsResult: FreeModeProviderResult
  ): Promise<FreeModeDeepResearchResult> {

    console.log("FreeMode active, integrations:", { marketData: marketDataResult.success, cryptocompare: ccResult.success, cmc: cmcResult.success, news: newsResult.success });

    let primaryData = marketDataResult;
    let dataSource = 'marketData';

    // Always attempt market data first, then always attempt CryptoCompare OHLC second for indicators
    console.log('Always attempting CryptoCompare OHLC fallback for technical indicators');
    try {
      const ccOHLC = await this.getCryptoCompareOHLCForIndicators(symbol);
      if (ccOHLC && ccOHLC.ohlc && ccOHLC.ohlc.length >= 20) {
        primaryData = {
          success: true,
          data: ccOHLC,
          latencyMs: 500, // Estimated latency for OHLC fallback
          provider: 'cryptocompare_ohlc'
        };
        dataSource = 'cryptocompare';
        console.log("OHLC fallback successful, length:", ccOHLC.ohlc?.length);
      } else {
        console.log("OHLC fallback failed - insufficient data or no OHLC returned");
      }
    } catch (error) {
      console.error('Failed to get CryptoCompare OHLC for indicators:', error);
    }

    // If OHLC fallback also fails, create default indicators
    if (!primaryData.success || !primaryData.data?.ohlc || primaryData.data.ohlc.length < 20) {
      console.log('No valid OHLC data available, using default indicators');
      primaryData = {
        success: true,
        data: this.createDefaultIndicatorsData(),
        latencyMs: 0,
        provider: 'defaults'
      };
      dataSource = 'defaults';
    }

    const data = primaryData.data;

    // Initialize default values
    let combinedSignal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let accuracy = 0.5;

    // A. Get indicators from primary data source
    const indicators = dataSource === 'defaults' ? data.indicators : this.calculateIndicatorsFromOHLC(data.ohlc);

    // Calculate signal from indicators (simplified for direction)
    let buySignals = 0;
    let sellSignals = 0;

    // RSI Analysis
    if (indicators.rsi?.value < 30) buySignals += 2; // Oversold
    else if (indicators.rsi?.value > 70) sellSignals += 2; // Overbought

    // Moving Averages
    if (indicators.ma50?.smaTrend === 'bullish' && indicators.ma200?.smaTrend === 'bullish') buySignals += 2;
    else if (indicators.ma50?.smaTrend === 'bearish' && indicators.ma200?.smaTrend === 'bearish') sellSignals += 2;

    // EMA Trend
    if (indicators.ema20?.emaTrend === 'bullish') buySignals += 1;
    else if (indicators.ema20?.emaTrend === 'bearish') sellSignals += 1;

    // MACD
    if (indicators.macd?.signal === 'bullish') buySignals += 1;
    else if (indicators.macd?.signal === 'bearish') sellSignals += 1;

    // Volume
    if (indicators.volume?.trend === 'increasing') buySignals += 1;

    // VWAP
    if (indicators.vwap?.signal === 'bullish') buySignals += 1;
    else if (indicators.vwap?.signal === 'bearish') sellSignals += 1;

    // Pattern Detection
    if (indicators.pattern?.confidence > 0.7) {
      if (indicators.pattern.pattern?.includes('bull')) buySignals += 2;
      else if (indicators.pattern.pattern?.includes('bear')) sellSignals += 2;
    }

    // Determine combined signal
    if (buySignals > sellSignals + 2) {
      combinedSignal = 'BUY';
    } else if (sellSignals > buySignals + 2) {
      combinedSignal = 'SELL';
    } else {
      combinedSignal = 'HOLD';
    }

    // B. Get metadata
    let metadata: any = {
      name: '',
      symbol: symbol,
      category: '',
      tags: [],
      rank: 0,
      supply: { circulating: 0, total: 0 },
      description: ''
    };

    if (cmcResult.success) {
      metadata = cmcResult.data;
    }

    // C. Get news
    let news: any[] = [];
    if (newsResult.success) {
      news = newsResult.data.articles || [];
    }

    // D. Calculate comprehensive accuracy score using the accuracy engine
    const accuracyResult = await accuracyEngine.calculateSnapshotAccuracy({
      signal: combinedSignal,
      accuracy: 0, // Will be overridden
      indicators,
      metadata,
      news,
      raw: {
        marketData: marketDataResult.data,
        cryptocompare: ccResult.success ? ccResult.data : null,
        metadata: cmcResult.data,
        news: newsResult.data
      },
      providers: {
        marketData: marketDataResult,
        metadata: cmcResult,
        cryptocompare: ccResult,
        news: newsResult
      },
      symbol,
      requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    });

    accuracy = accuracyResult.accuracy;

    // E. Save prediction snapshot for historical tracking
    try {
      await accuracyEngine.savePredictionSnapshot(uid, {
        requestId: accuracyResult.metadata.requestId,
        timestamp: new Date(),
        symbol,
        strategy: 'free-mode', // Could be made configurable
        signal: combinedSignal,
        positionPercentCandidate: 0, // Not used in free mode
        snapshotAccuracy: accuracy,
        breakdown: accuracyResult.breakdown,
        providersStatus: {
          marketData: marketDataResult.success,
          cryptocompare: ccResult.success,
          metadata: cmcResult.success,
          news: newsResult.success
        }
      });
    } catch (error) {
      logger.warn({ error: error.message }, 'Failed to save prediction snapshot');
      // Don't fail the research request if snapshot save fails
    }

    return {
      signal: combinedSignal,
      accuracy,
      snapshotAccuracy: accuracyResult.accuracy,
      accuracyBreakdown: accuracyResult.breakdown,
      accuracyWeightsUsed: accuracyResult.finalAppliedWeights,
      indicators,
      metadata,
      news,
      raw: {
        marketData: marketDataResult.data,
        cryptocompare: ccResult.data,
        metadata: cmcResult.data,
        news: newsResult.data
      },
      providers: {
        marketData: {
          success: marketDataResult.success,
          latency: marketDataResult.latencyMs,
          data: marketDataResult.data,
          error: marketDataResult.error
        },
        metadata: {
          success: cmcResult.success,
          latency: cmcResult.latencyMs,
          data: cmcResult.data,
          error: cmcResult.error
        },
        cryptocompare: {
          success: ccResult.success,
          latency: ccResult.latencyMs,
          data: ccResult.data,
          error: ccResult.error
        },
        news: {
          success: newsResult.success,
          latency: newsResult.latencyMs,
          data: newsResult.data,
          error: newsResult.error
        }
      }
    };

  // Temporarily commented out due to compilation issues
  // private async getCoinsToResearch(uid: string, tradingSettings: TradingSettings): Promise<string[]> {
  //   // Implementation temporarily removed
  //   return [];
  // }
}

/**
 * FREE MODE Deep Research v1.5 Entry Point
 */
export async function runFreeModeDeepResearch(
  uid: string,
  symbol: string,
  providerConfigs?: {
    binance?: ProviderBackupConfig;
    cryptocompare?: ProviderBackupConfig;
    cmc?: ProviderBackupConfig;
    news?: ProviderBackupConfig;
  },
  integrations?: any
): Promise<FreeModeDeepResearchResult> {
  // Default FREE MODE provider configurations
  const defaultConfigs = {
    binance: {
      primary: 'binance',
      backups: ['bybit', 'okx', 'kucoin']
    },
    cryptocompare: {
      primary: 'cryptocompare',
      backups: ['alphavantage', 'coingecko']
    },
    cmc: {
      primary: 'coinmarketcap',
      backups: ['coingecko']
    },
    news: {
      primary: 'newsdata',
      backups: ['cryptopanic', 'reddit']
    }
  };

  const configs = providerConfigs || defaultConfigs;

  return await deepResearchEngine.runFreeModeDeepResearch(uid, symbol, configs, integrations);
}

/**
 * Run deep research with coin selection based on trading settings
 */
export async function runDeepResearchWithCoinSelection(
  uid: string,
  tradingSettings: TradingSettings,
  providerConfigs ?: {
    binance?: ProviderBackupConfig;
    cryptocompare?: ProviderBackupConfig;
    cmc?: ProviderBackupConfig;
    news?: ProviderBackupConfig;
  },
  integrations ?: any
): Promise<{ results: FreeModeDeepResearchResult[]; mode: string; coinsAnalyzed: string[] }> {
  const startTime = Date.now();
  logger.info({ uid, mode: tradingSettings.mode }, `Starting Deep Research with ${tradingSettings.mode} mode`);

  // Get coins to research based on mode
  const coinsToResearch = await this.getCoinsToResearch(uid, tradingSettings);
  logger.info({ uid, coinsCount: coinsToResearch.length, coins: coinsToResearch.slice(0, 5) }, `Selected ${coinsToResearch.length} coins for research`);

  // Research all coins in parallel (but limit concurrency to avoid rate limits)
  const semaphore = new Semaphore(5); // Max 5 concurrent requests
  const researchPromises = coinsToResearch.map(async (symbol) => {
    const release = await semaphore.acquire();
    try {
      return await this.runFreeModeDeepResearch(uid, symbol, providerConfigs, integrations);
    } finally {
      release();
    }
  });

  const results = await Promise.all(researchPromises);

  // For TOP_100 and TOP_10 modes, find the coin with highest accuracy
  let bestResult: FreeModeDeepResearchResult | null = null;
  if(tradingSettings.mode === 'TOP_100' || tradingSettings.mode === 'TOP_10') {
  bestResult = results.reduce((best, current) => {
    return !best || current.accuracy > best.accuracy ? current : best;
  }, null as FreeModeDeepResearchResult | null);
}

logger.info({
  uid,
  mode: tradingSettings.mode,
  coinsAnalyzed: coinsToResearch.length,
  resultsCount: results.length,
  bestResult: bestResult ? { symbol: bestResult.metadata.symbol, accuracy: bestResult.accuracy, signal: bestResult.signal } : null,
  durationMs: Date.now() - startTime
}, `Deep Research with ${tradingSettings.mode} mode completed`);

return {
  results: tradingSettings.mode === 'MANUAL' ? results : (bestResult ? [bestResult] : []),
  mode: tradingSettings.mode,
  coinsAnalyzed: coinsToResearch
};
  }
}

export const deepResearchEngine = new DeepResearchEngine();
