import { AdapterError } from '../utils/adapterErrorHandler';
import { retryWithBackoff } from '../utils/rateLimiter';
import axios from 'axios';
import { logger } from '../utils/logger';

const BASE_URL = 'https://api.coinpaprika.com/v1';

// Map common symbols to CoinPaprika IDs
function getCoinPaprikaId(symbol: string): string {
  const map: Record<string, string> = {
    'BTC': 'btc-bitcoin',
    'ETH': 'eth-ethereum',
    'USDT': 'usdt-tether',
    'BNB': 'bnb-binance-coin',
    'XRP': 'xrp-xrp',
    'USDC': 'usdc-usd-coin',
    'SOL': 'sol-solana',
    'ADA': 'ada-cardano',
    'DOGE': 'doge-dogecoin',
    'TRX': 'trx-tron',
    'MATIC': 'matic-polygon',
    'DOT': 'dot-polkadot',
    'LTC': 'ltc-litecoin',
    'SHIB': 'shib-shiba-inu',
    'AVAX': 'avax-avalanche',
    'DAI': 'dai-dai',
    'WBTC': 'wbtc-wrapped-bitcoin',
    'ATOM': 'atom-cosmos',
    'LINK': 'link-chainlink',
    'UNI': 'uni-uniswap'
  };

  // Clean symbol
  const cleanSymbol = symbol.replace('USDT', '').replace('USD', '').toUpperCase();
  return map[cleanSymbol] || `${cleanSymbol.toLowerCase()}-${cleanSymbol.toLowerCase()}`; // Fallback guess
}

export async function fetchCoinPaprikaMarketData(symbol: string): Promise<any> {
  const startTime = Date.now();
  try {
    const coinId = getCoinPaprikaId(symbol);
    const url = `${BASE_URL}/tickers/${coinId}`;

    const response = await retryWithBackoff(async () => {
      return await axios.get(url, { timeout: 10000 });
    });

    if (response.data) {
      const data = response.data;
      return {
        provider: 'coinpaprika',
        success: true,
        data: {
          hasData: true,
          price: data.quotes?.USD?.price || 0,
          volume24h: data.quotes?.USD?.volume_24h || 0,
          high24h: 0, // Not provided directly by ticker endpoint
          low24h: 0,
          priceChangePercent24h: data.quotes?.USD?.percent_change_24h || 0,
          marketCap: data.quotes?.USD?.market_cap || 0
        },
        latencyMs: Date.now() - startTime
      };
    }

    return {
      provider: 'coinpaprika',
      success: false,
      data: null,
      error: 'Invalid response from CoinPaprika',
      latencyMs: Date.now() - startTime
    };
  } catch (error: any) {
    if (error.response?.status === 404) {
      return { provider: 'coinpaprika', success: false, data: null, error: 'Symbol not found', latencyMs: Date.now() - startTime };
    }
    logger.error({ error: error.message, symbol }, 'CoinPaprika market data error');
    return {
      provider: 'coinpaprika',
      success: false,
      data: null,
      error: error.message,
      latencyMs: Date.now() - startTime
    };
  }
}

export async function fetchCoinPaprikaMetadata(symbol: string): Promise<any> {
  const startTime = Date.now();
  try {
    const coinId = getCoinPaprikaId(symbol);
    const url = `${BASE_URL}/coins/${coinId}`;

    const response = await retryWithBackoff(async () => {
      return await axios.get(url, { timeout: 10000 });
    });

    if (response.data) {
      const data = response.data;
      return {
        success: true,
        data: {
          name: data.name,
          symbol: data.symbol,
          description: data.description,
          rank: data.rank,
          logo: data.logo, // CoinPaprika provides logo here
          website: data.links?.website?.[0],
          explorer: data.links?.explorer?.[0],
          supply: {
            circulating: 0, // Need ticker for this usually, but might be in coin details
            total: 0
          },
          tags: data.tags?.map((t: any) => t.name) || []
        },
        latencyMs: Date.now() - startTime,
        provider: 'coinpaprika'
      };
    }

    return {
      success: false,
      data: null,
      error: 'Invalid response from CoinPaprika',
      latencyMs: Date.now() - startTime,
      provider: 'coinpaprika'
    };
  } catch (error: any) {
    return {
      success: false,
      data: null,
      error: error.message,
      latencyMs: Date.now() - startTime,
      provider: 'coinpaprika'
    };
  }
}
