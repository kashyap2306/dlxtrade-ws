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
    binance: any;
    cryptocompare: any;
    cmc: any;
    news: any;
  };
  providers: {
    binance: {
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
    cmc: {
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
      const change = closes[i] - closes[i-1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? -change : 0);
    }

    let avgGain = gains.reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.reduce((a, b) => a + b, 0) / period;

    // Use Wilder's smoothing for subsequent values
    for (let i = period + 1; i < closes.length; i++) {
      const change = closes[i] - closes[i-1];
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
        Math.abs(ohlc[i].high - ohlc[i-1].close),
        Math.abs(ohlc[i].low - ohlc[i-1].close)
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
    const increasing = recent.every((price, i) => i === 0 || price >= recent[i-1]);
    const decreasing = recent.every((price, i) => i === 0 || price <= recent[i-1]);

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
        newsdata: { apiKey: '' }
      };
    }

    // Skip Firebase integration fetching for provided integrations

    // Execute all providers with backup logic
    const [binanceResult, ccResult, cmcResult, newsResult] = await Promise.all([
      this.executeBinanceProvider(symbol, providerConfigs.binance, userIntegrations),
      this.executeCryptoCompareProvider(symbol, providerConfigs.cryptocompare, userIntegrations),
      this.executeCMCProvider(symbol, providerConfigs.cmc, userIntegrations),
      this.executeNewsProvider(symbol, providerConfigs.news, userIntegrations)
    ]);

    // Combine results using FREE MODE logic v1.5
    const result = await this.combineFreeModeResults(
      symbol,
      binanceResult,
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
        binance: binanceResult.success ? binanceResult.provider : 'failed',
        cryptocompare: ccResult.success ? ccResult.provider : 'failed',
        cmc: cmcResult.success ? cmcResult.provider : 'failed',
        news: newsResult.success ? newsResult.provider : 'failed'
      }
    }, 'FREE MODE Deep Research v1.5 completed');

    return result;
  }

  /**
   * Execute Binance provider with backups (Bybit, OKX, KuCoin)
   */
  private async executeBinanceProvider(
    symbol: string,
    config: ProviderBackupConfig,
    integrations: any
  ): Promise<FreeModeProviderResult> {
    console.log('🔄 EXECUTE BINANCE PROVIDER: Called for symbol', symbol);
    return this.executeProviderWithBackups(
      config,
      async (provider: string) => {
        console.log('🔄 BINANCE EXECUTE FN: Called for provider', provider);
        const startTime = Date.now();

        try {
          switch (provider) {
            case 'binance':
              console.log('🔄 BINANCE CASE: About to call fetchBinancePublicData');
              return await this.fetchBinancePublicData(symbol, integrations);

            case 'bybit':
              return await this.fetchBybitPublicData(symbol);

            case 'okx':
              return await this.fetchOKXPublicData(symbol);

            case 'kucoin':
              return await this.fetchKuCoinPublicData(symbol);

            default:
              throw new Error(`Unknown Binance backup provider: ${provider}`);
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
      'Binance',
      integrations
    );
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
   * Execute CoinMarketCap provider with backup (CoinGecko)
   */
  private async executeCMCProvider(
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
            case 'coinmarketcap':
              return await this.fetchCoinMarketCapFreeMetadata(symbol, integrations);

            case 'coingecko':
              return await this.fetchCoinGeckoMetadata(symbol);

            default:
              throw new Error(`Unknown CMC backup provider: ${provider}`);
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
      'CMC',
      integrations
    );
  }

  /**
   * Execute News provider with backups (CryptoPanic, Reddit)
   */
  private async executeNewsProvider(
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
            case 'newsdata':
              return await this.fetchNewsDataFree(symbol, integrations);

            case 'cryptopanic':
              return await this.fetchCryptoPanicFree(symbol);

            case 'reddit':
              return await this.fetchRedditNews(symbol);

            default:
              throw new Error(`Unknown News backup provider: ${provider}`);
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
      'News',
      integrations
    );
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
      const baseSymbol = symbol.toLowerCase().replace('usdt', '').replace('usd', '');

      // CoinGecko free API for price data
      const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${baseSymbol}&vs_currencies=usd&include_24hr_change=true`);

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data[baseSymbol]) {
        throw new Error('No price data available');
      }

      const priceData = data[baseSymbol];
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
    const startTime = Date.now();

    try {
      const baseSymbol = symbol.toLowerCase().replace('usdt', '').replace('usd', '');

      const response = await fetch(`https://api.coingecko.com/api/v3/coins/${baseSymbol}`);

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

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
          description: data.description?.en || ''
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
        sentiment: this.analyzeNewsSentiment(article.title + ' ' + (article.description || ''))
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
  private async fetchCryptoPanicFree(symbol: string): Promise<FreeModeProviderResult> {
    const startTime = Date.now();

    try {
      const baseSymbol = symbol.toLowerCase().replace('usdt', '').replace('usd', '');
      const response = await fetch(`https://cryptopanic.com/api/v3/posts/?auth_token=free&currencies=${baseSymbol}&kind=news`);

      if (!response.ok) {
        throw new Error(`CryptoPanic API error: ${response.status}`);
      }

      const data = await response.json();

      // Transform CryptoPanic data
      const articles = (data.results || []).slice(0, 5).map((post: any) => ({
        title: post.title || '',
        source: 'CryptoPanic',
        url: post.url || '',
        published_at: post.published_at || new Date().toISOString(),
        sentiment: this.analyzeNewsSentiment(post.title + ' ' + (post.description || ''))
      }));

      return {
        success: true,
        data: {
          articles,
          sentimentScore: this.calculateOverallSentiment(articles)
        },
        latencyMs: Date.now() - startTime,
        provider: 'cryptopanic'
      };
    } catch (error: any) {
      return {
        success: false,
        data: null,
        latencyMs: Date.now() - startTime,
        provider: 'cryptopanic',
        error: error.message
      };
    }
  }

  /**
   * Fetch Reddit News via scraping (Backup for News)
   */
  private async fetchRedditNews(symbol: string): Promise<FreeModeProviderResult> {
    const startTime = Date.now();

    try {
      const baseSymbol = symbol.toLowerCase().replace('usdt', '').replace('usd', '');

      // Reddit API endpoints for crypto subreddits
      const subreddits = ['cryptocurrency', 'bitcoin'];
      const articles: any[] = [];

      for (const subreddit of subreddits) {
        try {
          const response = await fetch(`https://www.reddit.com/r/${subreddit}/search.json?q=${baseSymbol}&sort=new&limit=5&t=day`, {
            headers: {
              'User-Agent': 'DLXTrade/1.0'
            }
          });

          if (response.ok) {
            const data = await response.json();
            const posts = data.data?.children || [];

            for (const post of posts.slice(0, 2)) { // Limit 2 per subreddit
              articles.push({
                title: post.data.title || '',
                source: `Reddit r/${subreddit}`,
                url: `https://reddit.com${post.data.permalink}`,
                published_at: new Date(post.data.created_utc * 1000).toISOString(),
                sentiment: this.analyzeNewsSentiment(post.data.title + ' ' + (post.data.selftext || ''))
              });
            }
          }
        } catch (subError) {
          // Continue with other subreddits
          logger.debug({ subreddit, error: subError.message }, 'Reddit subreddit fetch failed');
        }
      }

      return {
        success: true,
        data: {
          articles: articles.slice(0, 5), // Limit total articles
          sentimentScore: this.calculateOverallSentiment(articles)
        },
        latencyMs: Date.now() - startTime,
        provider: 'reddit'
      };
    } catch (error: any) {
      return {
        success: false,
        data: null,
        latencyMs: Date.now() - startTime,
        provider: 'reddit',
        error: error.message
      };
    }
  }

  /**
   * Analyze sentiment of news text
   */
  private analyzeNewsSentiment(text: string): 'bullish' | 'bearish' | 'neutral' {
    const lowerText = text.toLowerCase();

    const bullishWords = ['bull', 'rise', 'gain', 'surge', 'rally', 'up', 'bullish', 'moon', 'pump', 'breakthrough', 'adoption'];
    const bearishWords = ['bear', 'fall', 'drop', 'crash', 'decline', 'down', 'bearish', 'dump', 'sell-off', 'correction'];

    let bullishCount = 0;
    let bearishCount = 0;

    bullishWords.forEach(word => {
      if (lowerText.includes(word)) bullishCount++;
    });

    bearishWords.forEach(word => {
      if (lowerText.includes(word)) bearishCount++;
    });

    if (bullishCount > bearishCount) return 'bullish';
    if (bearishCount > bullishCount) return 'bearish';
    return 'neutral';
  }

  /**
   * Calculate overall sentiment score from articles
   */
  private calculateOverallSentiment(articles: any[]): number {
    if (articles.length === 0) return 0.5;

    let bullish = 0;
    let bearish = 0;

    articles.forEach(article => {
      if (article.sentiment === 'bullish') bullish++;
      else if (article.sentiment === 'bearish') bearish++;
    });

    const total = articles.length;
    if (total === 0) return 0.5;

    // Return sentiment score between 0-1 (0.5 = neutral)
    return 0.5 + ((bullish - bearish) / total) * 0.5;
  }


  /**
   * Combine FREE MODE v1.5 results from all providers
   */
  private async combineFreeModeResults(
    symbol: string,
    binanceResult: FreeModeProviderResult,
    ccResult: FreeModeProviderResult,
    cmcResult: FreeModeProviderResult,
    newsResult: FreeModeProviderResult
  ): Promise<FreeModeDeepResearchResult> {

    console.log("FreeMode active, integrations:", { binance: binanceResult.success, cryptocompare: ccResult.success, cmc: cmcResult.success, news: newsResult.success });

    let primaryData = binanceResult;
    let dataSource = 'binance';

    // Always attempt Binance first, then always attempt CryptoCompare OHLC second
    console.log('Always attempting CryptoCompare OHLC fallback regardless of Binance result');
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
    let confidenceBoost = 0;

    // A. Get indicators from primary data source
    const indicators = dataSource === 'defaults' ? data.indicators : this.calculateIndicatorsFromOHLC(data.ohlc);

    // Calculate signal from indicators
    let buySignals = 0;
    let sellSignals = 0;

    // RSI Analysis
    if (indicators.rsi.value < 30) buySignals += 2; // Oversold
    else if (indicators.rsi.value > 70) sellSignals += 2; // Overbought

    // Moving Averages
    if (indicators.ma50.smaTrend === 'bullish' && indicators.ma200.smaTrend === 'bullish') buySignals += 2;
    else if (indicators.ma50.smaTrend === 'bearish' && indicators.ma200.smaTrend === 'bearish') sellSignals += 2;

    // EMA Trend
    if (indicators.ema20.emaTrend === 'bullish') buySignals += 1;
    else if (indicators.ema20.emaTrend === 'bearish') sellSignals += 1;

    // MACD (simplified)
    if (indicators.macd.signal === 'bullish') buySignals += 1;
    else if (indicators.macd.signal === 'bearish') sellSignals += 1;

    // Volume Anomaly
    if (indicators.volume.trend === 'increasing') buySignals += 1;

    // VWAP Distance
    if (indicators.vwap.signal === 'bullish') buySignals += 1;
    else if (indicators.vwap.signal === 'bearish') sellSignals += 1;

    // ATR Volatility (lower volatility = more reliable signals)
    if (indicators.atr.classification === 'low') accuracy += 0.1;

    // Pattern Detection
    if (indicators.pattern.confidence > 0.7) {
      if (indicators.pattern.pattern.includes('bull')) buySignals += 2;
      else if (indicators.pattern.pattern.includes('bear')) sellSignals += 2;
    }

    // Determine combined signal
    if (buySignals > sellSignals + 2) {
      combinedSignal = 'BUY';
      accuracy = Math.min(0.9, 0.5 + (buySignals - sellSignals) * 0.1);
    } else if (sellSignals > buySignals + 2) {
      combinedSignal = 'SELL';
      accuracy = Math.min(0.9, 0.5 + (sellSignals - buySignals) * 0.1);
    } else {
      combinedSignal = 'HOLD';
      accuracy = 0.5;
    }

    // B. CryptoCompare Trend Filter (optional boost)
    if (ccResult.success) {
      const ccData = ccResult.data;
      const bothBullish = ccData.trend1h === 'bullish' && ccData.trend1d === 'bullish';
      const bothBearish = ccData.trend1h === 'bearish' && ccData.trend1d === 'bearish';

      if (bothBullish && combinedSignal === 'BUY') {
        accuracy = Math.min(0.95, accuracy + 0.1); // Boost BUY confidence
      } else if (bothBearish && combinedSignal === 'SELL') {
        accuracy = Math.min(0.95, accuracy + 0.1); // Boost SELL confidence
      } else if (!bothBullish && !bothBearish && combinedSignal !== 'HOLD') {
        accuracy = Math.max(0.4, accuracy - 0.1); // Reduce confidence for conflicting trends
      }
    }

    // C. CMC Metadata Boost (optional)
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

      // Supply health boost
      if (metadata.supply.circulating > 0 && metadata.supply.total > 0) {
        const supplyRatio = metadata.supply.circulating / metadata.supply.total;
        if (supplyRatio < 0.8) { // Healthy supply distribution
          confidenceBoost += 0.05;
        }
      }

      // Category and tags boost
      if (metadata.category && ['layer-1', 'defi', 'infrastructure'].some(cat =>
        metadata.category.toLowerCase().includes(cat))) {
        confidenceBoost += 0.05;
      }

      accuracy = Math.min(0.95, accuracy + confidenceBoost);
    }

    // D. News Sentiment (optional)
    let news: any[] = [];
    if (newsResult.success) {
      news = newsResult.data.articles || [];
      const sentimentScore = newsResult.data.sentimentScore || 0.5;

      // Boost confidence based on news sentiment
      if (sentimentScore > 0.6 && combinedSignal === 'BUY') {
        accuracy = Math.min(0.95, accuracy + 0.05);
      } else if (sentimentScore < 0.4 && combinedSignal === 'SELL') {
        accuracy = Math.min(0.95, accuracy + 0.05);
      } else if ((sentimentScore > 0.6 && combinedSignal === 'SELL') ||
                 (sentimentScore < 0.4 && combinedSignal === 'BUY')) {
        accuracy = Math.max(0.3, accuracy - 0.1); // Reduce confidence for conflicting news
      }
    }

    // Ensure minimum accuracy
    accuracy = Math.max(0.3, accuracy);

    return {
      signal: combinedSignal,
      accuracy,
      indicators,
      metadata,
      news,
      raw: {
        binance: binanceResult.data,
        cryptocompare: ccResult.data,
        cmc: cmcResult.data,
        news: newsResult.data
      },
      providers: {
        binance: {
          success: binanceResult.success,
          latency: binanceResult.latencyMs,
          data: binanceResult.data,
          error: binanceResult.error
        },
        cryptocompare: {
          success: ccResult.success,
          latency: ccResult.latencyMs,
          data: ccResult.data,
          error: ccResult.error
        },
        cmc: {
          success: cmcResult.success,
          latency: cmcResult.latencyMs,
          data: cmcResult.data,
          error: cmcResult.error
        },
        news: {
          success: newsResult.success,
          latency: newsResult.latencyMs,
          data: newsResult.data,
          error: newsResult.error
        }
      }
    };
  }

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

export const deepResearchEngine = new DeepResearchEngine();
