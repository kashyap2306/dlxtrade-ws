import { AdapterError } from '../utils/adapterErrorHandler';
import axios from 'axios';

const BASE_URL = 'https://pro-api.coinmarketcap.com/v1';

// Parse trading pair symbols to base symbols for CoinMarketCap
// BTCUSDT → BTC, ETHUSDT → ETH, etc.
function parseCoinMarketCapSymbol(symbol: string): string {
  // Common trading pairs - extract base symbol
  const pairs = [
    'BTCUSDT', 'BTC', 'ETHUSDT', 'ETH', 'BNBUSDT', 'BNB',
    'ADAUSDT', 'ADA', 'SOLUSDT', 'SOL', 'DOTUSDT', 'DOT',
    'DOGEUSDT', 'DOGE', 'AVAXUSDT', 'AVAX', 'LTCUSDT', 'LTC',
    'LINKUSDT', 'LINK', 'UNIUSDT', 'UNI', 'ALGOUSDT', 'ALGO'
  ];

  // If it's already a base symbol, return as-is
  if (pairs.includes(symbol.toUpperCase())) {
    return symbol.toUpperCase();
  }

  // Extract base symbol from trading pairs
  for (const pair of pairs) {
    if (pair.endsWith('USDT') && symbol.toUpperCase() === pair) {
      return pair.replace('USDT', '');
    }
  }

  // Fallback: remove common quote currencies
  let baseSymbol = symbol.toUpperCase();
  baseSymbol = baseSymbol.replace(/USDT$/, '');
  baseSymbol = baseSymbol.replace(/USD$/, '');
  baseSymbol = baseSymbol.replace(/BTC$/, '');
  baseSymbol = baseSymbol.replace(/ETH$/, '');

  return baseSymbol;
}

// Simple in-memory cache for CoinMarketCap results
interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

const coinMarketCapCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours for metadata

function makeRequest(url: string, apiKey?: string): Promise<any> {
  const headers: any = {
    'Accept': 'application/json',
    'User-Agent': 'DLXTrade/1.0'
  };

  if (apiKey) {
    headers['X-CMC_PRO_API_KEY'] = apiKey;
  }

  return axios.get(url, {
    timeout: 10000,
    headers
  });
}

async function attemptWithRetry(url: string, apiKey?: string): Promise<any> {
  // Try 1
  try {
    return await makeRequest(url, apiKey);
  } catch (error: any) {
    if (error.response?.status === 429) {
      console.log('[CoinMarketCap] RETRY 1 - Rate limited, waiting 500ms');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Try 2
      try {
        return await makeRequest(url, apiKey);
      } catch (error2: any) {
        if (error2.response?.status === 429) {
          console.log('[CoinMarketCap] RETRY 2 - Rate limited again, waiting 1000ms');
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Try 3
          try {
            return await makeRequest(url, apiKey);
          } catch (error3: any) {
            if (error3.response?.status === 429) {
              console.log('[CoinMarketCap] RETRY 3 FAILED - Rate limited, using fallback');
              return null; // Signal to use fallback
            }
            throw error3;
          }
        }
        throw error2;
      }
    }
    throw error;
  }
}

export async function fetchCoinMarketCapMetadata(symbol: string, apiKey?: string): Promise<any> {
  const startTime = Date.now();

  // Parse symbol for CoinMarketCap (BTCUSDT → BTC)
  const cmcSymbol = parseCoinMarketCapSymbol(symbol);
  console.log('[CoinMarketCap] START - Fetching metadata for', symbol, `(parsed: ${cmcSymbol})`);

  // Check cache first
  const cacheKey = `cmc_metadata_${symbol}`;
  const cached = coinMarketCapCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < cached.ttl) {
    console.log('[CoinMarketCap] CACHE HIT - Returning cached metadata');
    return cached.data;
  }

  try {
    // First get the coin ID from symbol
    const mapUrl = `${BASE_URL}/cryptocurrency/map?symbol=${cmcSymbol}`;
    const mapResponse = await attemptWithRetry(mapUrl, apiKey);

    if (mapResponse === null) {
      console.log('[CoinMarketCap] FALLBACK - Rate limited during map request');
      return {
        success: true,
        metadata: {},
        latency: Date.now() - startTime,
        message: "Rate-limited, using fallback empty metadata"
      };
    }

    const mapData = mapResponse.data;
    const coinData = mapData?.data?.[0];

    if (!coinData) {
      console.log('[CoinMarketCap] NO DATA - Symbol not found');
      return {
        success: true,
        metadata: {},
        latency: Date.now() - startTime,
        message: "Symbol not found in CoinMarketCap"
      };
    }

    // Now get detailed metadata
    const metadataUrl = `${BASE_URL}/cryptocurrency/info?id=${coinData.id}`;
    const metadataResponse = await attemptWithRetry(metadataUrl, apiKey);

    if (metadataResponse === null) {
      console.log('[CoinMarketCap] FALLBACK - Rate limited during metadata request');
      return {
        success: true,
        metadata: {
          id: coinData.id,
          name: coinData.name,
          symbol: coinData.symbol,
          slug: coinData.slug
        },
        latency: Date.now() - startTime,
        message: "Rate-limited, using basic metadata"
      };
    }

    const metadataData = metadataResponse.data;
    const coinInfo = metadataData?.data?.[coinData.id];

    const result = {
      success: true,
      metadata: {
        id: coinData.id,
        name: coinData.name,
        symbol: coinData.symbol,
        slug: coinData.slug,
        description: coinInfo?.description,
        logo: coinInfo?.logo,
        website: coinInfo?.urls?.website?.[0],
        twitter: coinInfo?.urls?.twitter?.[0],
        reddit: coinInfo?.urls?.reddit?.[0],
        categories: coinInfo?.category,
        date_added: coinInfo?.date_added,
        tags: coinInfo?.tags
      },
      latency: Date.now() - startTime
    };

    // Cache the result
    coinMarketCapCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
      ttl: CACHE_TTL_MS
    });

    console.log('[CoinMarketCap] SUCCESS - Cached metadata');
    return result;

  } catch (error: any) {
    console.log('[CoinMarketCap] FAILED');

    // For auth errors, still throw them
    if (error.response?.status === 401 || error.response?.status === 403) {
      throw new AdapterError({
        adapter: 'CoinMarketCap',
        method: 'GET',
        url: BASE_URL,
        errorMessage: 'Authentication failed - invalid CoinMarketCap API key',
        statusCode: error.response.status,
        isAuthError: true
      });
    }

    // For other errors, return empty success to not break research
    console.log('[CoinMarketCap] FALLBACK - Error occurred, returning empty metadata');
    return {
      success: true,
      metadata: {},
      latency: Date.now() - startTime,
      message: "Error occurred, using fallback empty metadata"
    };
  }
}

export async function fetchCoinMarketCapMarketData(symbol: string, apiKey?: string): Promise<any> {
  const startTime = Date.now();

  // Parse symbol for CoinMarketCap (BTCUSDT → BTC)
  const cmcSymbol = parseCoinMarketCapSymbol(symbol);
  console.log('[CoinMarketCap] START - Fetching market data for', symbol, `(parsed: ${cmcSymbol})`);

  // Check cache first (shorter TTL for market data)
  const cacheKey = `cmc_market_${symbol}`;
  const cached = coinMarketCapCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < 300000) { // 5 minutes for market data
    console.log('[CoinMarketCap] CACHE HIT - Returning cached market data');
    return cached.data;
  }

  try {
    // Get latest quotes
    const quotesUrl = `${BASE_URL}/cryptocurrency/quotes/latest?symbol=${cmcSymbol}&convert=USD`;
    const quotesResponse = await attemptWithRetry(quotesUrl, apiKey);

    if (quotesResponse === null) {
      console.log('[CoinMarketCap] FALLBACK - Rate limited during quotes request');
      return {
        success: true,
        marketData: {},
        latency: Date.now() - startTime,
        message: "Rate-limited, using fallback empty market data"
      };
    }

    const quotesData = quotesResponse.data;
    const coinQuotes = quotesData?.data?.[cmcSymbol]?.[0];

    if (!coinQuotes) {
      console.log('[CoinMarketCap] NO DATA - Symbol not found:', cmcSymbol);
      return {
        success: true,
        marketData: {},
        latency: Date.now() - startTime,
        message: `Symbol ${cmcSymbol} not found in CoinMarketCap`
      };
    }

    const result = {
      success: true,
      marketData: {
        price: coinQuotes.quote?.USD?.price,
        volume24h: coinQuotes.quote?.USD?.volume_24h,
        marketCap: coinQuotes.quote?.USD?.market_cap,
        priceChangePercent24h: coinQuotes.quote?.USD?.percent_change_24h,
        priceChangePercent7d: coinQuotes.quote?.USD?.percent_change_7d,
        priceChangePercent30d: coinQuotes.quote?.USD?.percent_change_30d,
        circulatingSupply: coinQuotes.circulating_supply,
        totalSupply: coinQuotes.total_supply,
        maxSupply: coinQuotes.max_supply,
        lastUpdated: coinQuotes.quote?.USD?.last_updated
      },
      latency: Date.now() - startTime
    };

    // Cache the result
    coinMarketCapCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
      ttl: 300000 // 5 minutes for market data
    });

    console.log('[CoinMarketCap] SUCCESS - Cached market data');
    return result;

  } catch (error: any) {
    console.log('[CoinMarketCap] FAILED');

    // For auth errors, still throw them
    if (error.response?.status === 401 || error.response?.status === 403) {
      throw new AdapterError({
        adapter: 'CoinMarketCap',
        method: 'GET',
        url: BASE_URL,
        errorMessage: 'Authentication failed - invalid CoinMarketCap API key',
        statusCode: error.response.status,
        isAuthError: true
      });
    }

    // For other errors, return empty success to not break research
    console.log('[CoinMarketCap] FALLBACK - Error occurred, returning empty market data');
    return {
      success: true,
      marketData: {},
      latency: Date.now() - startTime,
      message: "Error occurred, using fallback empty market data"
    };
  }
}
