import { fetchNewsData } from './newsDataAdapter';
import { fetchCoinMarketCapMetadata, fetchCoinMarketCapMarketData } from './coinMarketCapAdapter';
import { tradingStrategies } from './tradingStrategies';
import { BinanceAdapter } from './binanceAdapter';
import { CryptoCompareAdapter } from './cryptocompareAdapter';
import { fetchCoinPaprikaMarketData, fetchCoinPaprikaMetadata } from './coinPaprikaAdapter';
import { fetchCoinGeckoMarketData as fetchCoinGeckoMarketDataSimple, fetchCoinGeckoMetadata as fetchCoinGeckoMetadataSimple } from './coinGeckoAdapter';
import { FreeModeProviderResult } from './researchTypes';
import { calculateUnifiedSentiment, calculateWeightedSentiment } from './coinScoring';
import axios from 'axios'; // Ensure axios is imported

import { getCryptoNews as getCointelegraphNews } from '../providers/newsProviders/cointelegraph';
import { getCryptoNews as getAltcoinBuzzNews } from '../providers/newsProviders/altcoinbuzz';
import { getCryptoNews as getCoinStatsNews } from '../providers/newsProviders/coinstatsnews';

// --- COINLORE IMPLEMENTATION ---
async function fetchCoinLoreMarketData(symbol: string): Promise<FreeModeProviderResult> {
  const startTime = Date.now();
  try {
    // CoinLore needs ID. Search first or basic map.
    // Basic approach: try ticker (limited). Best is global data then filter, but that's heavy.
    // Try search API? 
    // CoinLore Ticker: https://api.coinlore.net/api/ticker/?id=90 (BTC)
    // Map Top coins:
    const map: Record<string, string> = { 'BTC': '90', 'ETH': '80', 'BNB': '2710', 'XRP': '58', 'SOL': '48543', 'USDT': '518', 'DOGE': '2', 'ADA': '257' };
    const clean = symbol.replace('USDT', '').replace('USD', '').toUpperCase();
    const id = map[clean];

    if (!id) return { success: false, data: null, provider: 'coinlore', error: 'Symbol ID map missing', latencyMs: 0 };

    const res = await axios.get(`https://api.coinlore.net/api/ticker/?id=${id}`, { timeout: 5000 });
    if (res.data && res.data[0]) {
      const d = res.data[0];
      return {
        success: true,
        provider: 'coinlore',
        latencyMs: Date.now() - startTime,
        data: {
          hasData: true,
          price: parseFloat(d.price_usd),
          volume24h: parseFloat(d.volume24), // check unit
          change24h: parseFloat(d.percent_change_24h),
          marketCap: parseFloat(d.market_cap_usd)
        }
      };
    }
    return { success: false, data: null, provider: 'coinlore', error: 'No data', latencyMs: Date.now() - startTime };
  } catch (e: any) {
    return { success: false, data: null, provider: 'coinlore', error: e.message, latencyMs: Date.now() - startTime };
  }
}

// --- COINCAP IMPLEMENTATION ---
async function fetchCoinCapMarketData(symbol: string): Promise<FreeModeProviderResult> {
  const startTime = Date.now();
  try {
    const map: Record<string, string> = { 'BTC': 'bitcoin', 'ETH': 'ethereum', 'BNB': 'binance-coin', 'SOL': 'solana', 'XRP': 'xrp', 'ADA': 'cardano', 'DOGE': 'dogecoin', 'DOT': 'polkadot' };
    const clean = symbol.replace('USDT', '').replace('USD', '').toUpperCase();
    const id = map[clean] || clean.toLowerCase();

    const res = await axios.get(`https://api.coincap.io/v2/assets/${id}`, { timeout: 5000 });
    if (res.data && res.data.data) {
      const d = res.data.data;
      return {
        success: true,
        provider: 'coincap',
        latencyMs: Date.now() - startTime,
        data: {
          hasData: true,
          price: parseFloat(d.priceUsd),
          volume24h: parseFloat(d.volumeUsd24Hr),
          change24h: parseFloat(d.changePercent24Hr),
          marketCap: parseFloat(d.marketCapUsd)
        }
      };
    }
    return { success: false, data: null, provider: 'coincap', error: 'No data', latencyMs: Date.now() - startTime };
  } catch (e: any) {
    return { success: false, data: null, provider: 'coincap', error: e.message, latencyMs: Date.now() - startTime };
  }
}


export async function fetchMarketDataFromProvider(
  provider: string,
  symbol: string,
  integrations: any,
  apiKey?: string
): Promise<FreeModeProviderResult> {
  const baseSymbol = symbol.replace('USDT', '').replace('USD', '');
  const usdtSymbol = `${baseSymbol}USDT`;

  switch (provider) {
    case 'coingecko':
      return await fetchCoinGeckoMarketDataSimple(baseSymbol);

    case 'bravenewcoin':
      return { success: false, data: null, latencyMs: 0, provider: 'bravenewcoin', error: 'Not implemented' };

    case 'coinapi':
      return { success: false, data: null, latencyMs: 0, provider: 'coinapi', error: 'Not implemented' };

    case 'coincheckup':
      // Fallback to CoinLore or others if Checkup API is unavailable/private
      return { success: false, data: null, latencyMs: 0, provider: 'coincheckup', error: 'Not implemented' };

    case 'coinlore':
      return await fetchCoinLoreMarketData(symbol);

    case 'coincap':
      return await fetchCoinCapMarketData(symbol);

    case 'coinmarketcap':
      // Try to use CoinMarketCap adapter if available
      try {
        const cmcResult = await fetchCoinMarketCapMarketData(baseSymbol, apiKey);
        if (cmcResult.success && cmcResult.marketData) {
          return {
            success: true,
            data: {
              hasData: true,
              price: cmcResult.marketData.price || 0,
              volume24h: cmcResult.marketData.volume24h || 0,
              change24h: cmcResult.marketData.priceChangePercent24h || 0,
              high24h: 0,
              low24h: 0
            },
            latencyMs: 0,
            provider: 'coinmarketcap'
          };
        }
      } catch (cmcError: any) {
        return {
          success: false,
          data: null,
          latencyMs: 0,
          provider: 'coinmarketcap',
          error: cmcError.message || 'CoinMarketCap market data provider failed'
        };
      }
      return {
        success: false,
        data: null,
        latencyMs: 0,
        provider: 'coinmarketcap',
        error: 'CoinMarketCap returned invalid data'
      };

    case 'coinpaprika':
      return await fetchCoinPaprikaMarketData(symbol);

    case 'coinstats':
      // TODO: Implement CoinStats market data fetching
      return {
        success: false,
        data: null,
        latencyMs: 0,
        provider: 'coinstats',
        error: 'CoinStats market data provider not yet implemented'
      };

    case 'kaiko':
      // TODO: Implement Kaiko market data fetching
      return {
        success: false,
        data: null,
        latencyMs: 0,
        provider: 'kaiko',
        error: 'Kaiko market data provider not yet implemented'
      };

    case 'livecoinwatch':
      // TODO: Implement LiveCoinWatch market data fetching
      return {
        success: false,
        data: null,
        latencyMs: 0,
        provider: 'livecoinwatch',
        error: 'LiveCoinWatch market data provider not yet implemented'
      };

    case 'messari':
      // TODO: Implement Messari market data fetching
      return {
        success: false,
        data: null,
        latencyMs: 0,
        provider: 'messari',
        error: 'Messari market data provider not yet implemented'
      };

    default:
      // CRITICAL: Do NOT throw - return failure result instead (FreeMode must never throw)
      return {
        success: false,
        data: null,
        latencyMs: 0,
        provider,
        error: `Unknown market data provider: ${provider}`
      };
  }
}

/**
 * Fetch metadata from a specific provider
 */
export async function fetchMetadataFromProvider(
  provider: string,
  symbol: string,
  integrations: any
): Promise<FreeModeProviderResult> {
  switch (provider) {
    case 'cryptocompare':
      // TODO: Implement CryptoCompare metadata fetching
      throw new Error('CryptoCompare metadata provider not yet implemented');

    case 'coincap':
      return {
        success: false,
        provider: 'coincap',
        error: 'Metadata not supported for CoinCap in free mode',
        latencyMs: 0,
        data: null
      };

    case 'coingecko':
      return await fetchCoinGeckoMetadataSimple(symbol);

    case 'coinmarketcap':
      try {
        const res = await fetchCoinMarketCapMetadata(symbol, integrations?.cmc?.apiKey);
        if (res.success && res.metadata) {
          return {
            success: true,
            data: res.metadata,
            latencyMs: res.latency,
            provider: 'coinmarketcap'
          };
        }
        throw new Error('No data');
      } catch (e: any) {
        return { success: false, data: null, latencyMs: 0, provider: 'coinmarketcap', error: e.message };
      }

    case 'coinpaprika':
      return await fetchCoinPaprikaMetadata(symbol);

    case 'coinranking':
      // TODO: Implement CoinRanking metadata fetching
      throw new Error('CoinRanking metadata provider not yet implemented');

    case 'coinstats':
      // TODO: Implement CoinStats metadata fetching
      throw new Error('CoinStats metadata provider not yet implemented');

    case 'livecoinwatch':
      // TODO: Implement LiveCoinWatch metadata fetching
      throw new Error('LiveCoinWatch metadata provider not yet implemented');

    case 'messari':
      // TODO: Implement Messari metadata fetching
      throw new Error('Messari metadata provider not yet implemented');

    case 'nomics':
      // TODO: Implement Nomics metadata fetching
      throw new Error('Nomics metadata provider not yet implemented');

    default:
      // CRITICAL: Do NOT throw - return failure result instead (FreeMode must never throw)
      return {
        success: false,
        data: null,
        latencyMs: 0,
        provider,
        error: `Unknown metadata provider: ${provider}`
      };
  }
}

/**
 * Fetch news from a specific provider
 */
export async function fetchNewsFromProvider(
  provider: string,
  symbol: string,
  integrations: any
): Promise<FreeModeProviderResult> {
  switch (provider) {
    case 'newsdata':
    case 'newsdataio':
      return await fetchNewsDataFree(symbol, integrations);

    case 'marketaux':
    case 'bingnews':
    case 'contextualweb':
    case 'mediastack':
    case 'newscatcher':
    case 'webzio':
    case 'yahoonews':
      return {
        success: false,
        data: null,
        latencyMs: 0,
        provider,
        error: `${provider} provider not yet implemented`
      };

    case 'cryptopanic':
      return await fetchCryptoPanicFree(symbol, integrations);

    case 'reddit':
      return await fetchRedditNews(symbol);
    case 'gnews':
      return await fetchGNews(symbol);

    case 'cointelegraph_rss':
      return await fetchCointelegraphRSS(symbol);

    case 'altcoinbuzz_rss':
      return await fetchAltcoinBuzzRSS(symbol);

    case 'coinstatsnews':
      return await fetchCoinStatsRSS(symbol);

    default:
      // CRITICAL: Do NOT throw - return failure result instead (FreeMode must never throw)
      return {
        success: false,
        data: null,
        latencyMs: 0,
        provider,
        error: `Unknown news provider: ${provider}`
      };
  }
}

/**
 * Fetch Binance Public Data (FREE MODE - Price, OHLC, Volume, Indicators)
 */
export async function fetchBinancePublicData(symbol: string, integrations: any): Promise<FreeModeProviderResult> {
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
export async function fetchBybitPublicData(symbol: string): Promise<FreeModeProviderResult> {
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
export async function fetchOKXPublicData(symbol: string): Promise<FreeModeProviderResult> {
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
export async function fetchKuCoinPublicData(symbol: string): Promise<FreeModeProviderResult> {
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
export async function fetchCryptoCompareFreeData(symbol: string, integrations: any): Promise<FreeModeProviderResult> {
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
    const histoDay = await ccAdapter.getDailyOHLCData(`${baseSymbol}USDT`);
    console.log('🔄 CRYPTOCOMPARE PROVIDER: Response received - hour data points:', histoHour.ohlc?.length, 'day data points:', histoDay.ohlc?.length);

    // Calculate simple trends
    const hour1Trend = histoHour.ohlc?.length >= 2 ?
      (histoHour.ohlc[histoHour.ohlc.length - 1].close > histoHour.ohlc[histoHour.ohlc.length - 2].close ? 'bullish' : 'bearish') : 'neutral';

    const day1Trend = histoDay.ohlc?.length >= 2 ?
      (histoDay.ohlc[histoDay.ohlc.length - 1].close > histoDay.ohlc[histoDay.ohlc.length - 2].close ? 'bullish' : 'bearish') : 'neutral';

    return {
      success: true,
      data: {
        trend1h: hour1Trend,
        trend1d: day1Trend,
        confirmationSignal: hour1Trend === day1Trend ? hour1Trend : 'neutral',
        ohlc: histoHour.ohlc, // Include raw OHLC (hourly)
        dailyOHLC: histoDay.ohlc // Include daily OHLC for fallback
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
export async function fetchAlphaVantageFreeData(symbol: string): Promise<FreeModeProviderResult> {
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
// REMOVED fetchCoinGeckoFreeData to avoid duplication
export async function fetchCoinGeckoFreeData(symbol: string): Promise<FreeModeProviderResult> {
  return await fetchCoinGeckoMarketDataSimple(symbol);
}

/**
 * Fetch CoinMarketCap FREE Metadata (no price data)
 */
export async function fetchCoinMarketCapFreeMetadata(symbol: string, integrations: any): Promise<FreeModeProviderResult> {
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
// REMOVED DUPLICATE fetchCoinGeckoMetadata
// REMOVED DUPLICATE fetchCoinGeckoMetadata
export async function fetchCoinGeckoMetadata(symbol: string): Promise<FreeModeProviderResult> {
  return await fetchCoinGeckoMetadataSimple(symbol);
}

/**
 * Fetch CoinPaprika Metadata (Backup)
 */
// Local fetchCoinPaprikaMetadata removed in favor of imported adapter version

/**
 * Fetch NewsData FREE News
 */
export async function fetchNewsDataFree(symbol: string, integrations: any): Promise<FreeModeProviderResult> {
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
      sentiment: calculateUnifiedSentiment(article.title + ' ' + (article.description || ''))
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
export async function fetchCryptoPanicFree(symbol: string, integrations: any): Promise<FreeModeProviderResult> {
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
      sentiment: calculateUnifiedSentiment(post.title + ' ' + (post.description || ''))
    }));

    return {
      success: true,
      data: {
        articles,
        sentimentScore: calculateWeightedSentiment(articles)
      },
      latencyMs: 0,
      provider: 'cryptopanic'
    };
  } catch (error: any) {
    console.error("[HTTP-ERR]", "CryptoPanic", `https://cryptopanic.com/api/v3/posts/`, error.message, error.stack);
    // CRITICAL: Do NOT throw - return failure result instead (FreeMode must never throw)
    return {
      success: false,
      data: null,
      latencyMs: 0,
      provider: 'cryptopanic',
      error: error.message || 'CryptoPanic fetch failed'
    };
  }
}

/**
 * Fetch Reddit News via scraping (Backup for News)
 */
export async function fetchRedditNews(symbol: string): Promise<FreeModeProviderResult> {
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
              sentiment: calculateUnifiedSentiment(post.data.title + ' ' + (post.data.selftext || ''))
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
        sentimentScore: calculateWeightedSentiment(articles)
      },
      latencyMs: 0,
      provider: 'reddit'
    };
  } catch (error: any) {
    console.error("[HTTP-ERR]", "Reddit", "General error", error.message, error.stack);
    // CRITICAL: Do NOT throw - return failure result instead (FreeMode must never throw)
    return {
      success: false,
      data: null,
      latencyMs: 0,
      provider: 'reddit',
      error: error.message || 'Reddit fetch failed'
    };
  }
}

/**
 * Fetch GNews (Backup)
 */
export async function fetchGNews(symbol: string): Promise<FreeModeProviderResult> {
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
      sentiment: calculateUnifiedSentiment(article.title + ' ' + (article.description || ''))
    }));

    return {
      success: true,
      data: {
        articles,
        sentimentScore: calculateWeightedSentiment(articles)
      },
      latencyMs: 0,
      provider: 'gnews'
    };
  } catch (error: any) {
    console.error("[HTTP-ERR]", "GNews", `https://gnews.io/api/v4/search`, error.message, error.stack);
    // CRITICAL: Do NOT throw - return failure result instead (FreeMode must never throw)
    return {
      success: false,
      data: null,
      latencyMs: 0,
      provider: 'gnews',
      error: error.message || 'GNews fetch failed'
    };
  }
}

/**
 * Fetch CryptoCompare Market Data (Primary)
 */
export async function fetchCryptoCompareMarketData(symbol: string, integrations: any): Promise<FreeModeProviderResult> {
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
    // CRITICAL: Do NOT throw - return failure result instead (FreeMode must never throw)
    return {
      success: false,
      data: null,
      latencyMs: 0,
      provider: 'cryptocompare',
      error: error.message || 'CryptoCompare fetch failed'
    };
  }
}

/**
 * Fetch CoinGecko Market Data (Backup)
 */
export async function fetchCoinGeckoMarketData(symbol: string): Promise<FreeModeProviderResult> {
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
    // CRITICAL: Do NOT throw - return failure result instead (FreeMode must never throw)
    return {
      success: false,
      data: null,
      latencyMs: 0,
      provider: 'coingecko',
      error: error.message || 'CoinGecko market data fetch failed'
    };
  }
}

/**
 * Fetch KuCoin Market Data (Backup)
 */
export async function fetchKuCoinMarketData(symbol: string): Promise<FreeModeProviderResult> {
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
    // CRITICAL: Do NOT throw - return failure result instead (FreeMode must never throw)
    return {
      success: false,
      data: null,
      latencyMs: 0,
      provider: 'kucoin',
      error: error.message || 'KuCoin market data fetch failed'
    };
  }
}

/**
 * Fetch Bybit Market Data (Backup)
 */
export async function fetchBybitMarketData(symbol: string): Promise<FreeModeProviderResult> {
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
    // CRITICAL: Do NOT throw - return failure result instead (FreeMode must never throw)
    return {
      success: false,
      data: null,
      latencyMs: 0,
      provider: 'bybit',
      error: error.message || 'Bybit market data fetch failed'
    };
  }
}

/**
 * Fetch OKX Market Data (Backup)
 */
export async function fetchOKXMarketData(symbol: string): Promise<FreeModeProviderResult> {
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
    // CRITICAL: Do NOT throw - return failure result instead (FreeMode must never throw)
    return {
      success: false,
      data: null,
      latencyMs: 0,
      provider: 'okx',
      error: error.message || 'OKX market data fetch failed'
    };
  }
}

/**
 * Fetch Bitget Market Data (Backup)
 */
export async function fetchBitgetMarketData(symbol: string): Promise<FreeModeProviderResult> {
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
    // CRITICAL: Do NOT throw - return failure result instead (FreeMode must never throw)
    return {
      success: false,
      data: null,
      latencyMs: 0,
      provider: 'bitget',
      error: error.message || 'Bitget market data fetch failed'
    };
  }
}

/**
 * Fetch Cointelegraph RSS News
 */
export async function fetchCointelegraphRSS(symbol: string): Promise<FreeModeProviderResult> {
  const startTime = Date.now();
  try {
    const result = await getCointelegraphNews();
    if (!result.success) {
      return { success: false, data: null, latencyMs: Date.now() - startTime, provider: 'cointelegraph_rss', error: result.reason || 'Failed to fetch RSS' };
    }

    const articles = result.articles;
    const cleanSymbol = symbol.replace('USDT', '').replace('USD', '');
    const filtered = articles.filter(a =>
      new RegExp(cleanSymbol, 'i').test(a.title + a.summary)
    ).slice(0, 10);

    // If no filtered articles, but we have articles, use them as general market news
    const finalArticles = filtered.length > 0 ? filtered : articles.slice(0, 5);

    return {
      success: finalArticles.length > 0,
      data: {
        articles: finalArticles.map(a => ({
          ...a,
          sentiment: calculateUnifiedSentiment(a.title + ' ' + a.summary)
        })),
        sentimentScore: calculateWeightedSentiment(finalArticles)
      },
      latencyMs: Date.now() - startTime,
      provider: 'cointelegraph_rss'
    };
  } catch (error: any) {
    return { success: false, data: null, latencyMs: Date.now() - startTime, provider: 'cointelegraph_rss', error: error.message };
  }
}

/**
 * Fetch Altcoin Buzz RSS News
 */
export async function fetchAltcoinBuzzRSS(symbol: string): Promise<FreeModeProviderResult> {
  const startTime = Date.now();
  try {
    const result = await getAltcoinBuzzNews();
    if (!result.success) {
      return { success: false, data: null, latencyMs: Date.now() - startTime, provider: 'altcoinbuzz_rss', error: result.reason || 'Failed to fetch RSS' };
    }

    const articles = result.articles;
    const cleanSymbol = symbol.replace('USDT', '').replace('USD', '');
    const filtered = articles.filter(a =>
      new RegExp(cleanSymbol, 'i').test(a.title + a.summary)
    ).slice(0, 10);

    const finalArticles = filtered.length > 0 ? filtered : articles.slice(0, 5);

    return {
      success: finalArticles.length > 0,
      data: {
        articles: finalArticles.map(a => ({
          ...a,
          sentiment: calculateUnifiedSentiment(a.title + ' ' + a.summary)
        })),
        sentimentScore: calculateWeightedSentiment(finalArticles)
      },
      latencyMs: Date.now() - startTime,
      provider: 'altcoinbuzz_rss'
    };
  } catch (error: any) {
    return { success: false, data: null, latencyMs: Date.now() - startTime, provider: 'altcoinbuzz_rss', error: error.message };
  }
}

/**
 * Fetch CoinStats RSS News
 */
export async function fetchCoinStatsRSS(symbol: string): Promise<FreeModeProviderResult> {
  const startTime = Date.now();
  try {
    const result = await getCoinStatsNews();
    if (!result.success) {
      return { success: false, data: null, latencyMs: Date.now() - startTime, provider: 'coinstatsnews', error: result.reason || 'Failed to fetch RSS' };
    }

    const articles = result.articles;
    const cleanSymbol = symbol.replace('USDT', '').replace('USD', '');
    const filtered = articles.filter(a =>
      new RegExp(cleanSymbol, 'i').test(a.title + a.summary)
    ).slice(0, 10);

    const finalArticles = filtered.length > 0 ? filtered : articles.slice(0, 5);

    return {
      success: finalArticles.length > 0,
      data: {
        articles: finalArticles.map(a => ({
          ...a,
          sentiment: calculateUnifiedSentiment(a.title + ' ' + a.summary)
        })),
        sentimentScore: calculateWeightedSentiment(finalArticles)
      },
      latencyMs: Date.now() - startTime,
      provider: 'coinstatsnews'
    };
  } catch (error: any) {
    return { success: false, data: null, latencyMs: Date.now() - startTime, provider: 'coinstatsnews', error: error.message };
  }
}
