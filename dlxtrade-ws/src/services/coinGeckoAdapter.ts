import axios from 'axios';
import { retryWithBackoff } from '../utils/rateLimiter';
import { logger } from '../utils/logger';

// Map common symbols to CoinGecko IDs
function getCoinGeckoId(symbol: string): string {
  const map: Record<string, string> = {
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'USDT': 'tether',
    'BNB': 'binancecoin',
    'XRP': 'ripple',
    'SOL': 'solana',
    'ADA': 'cardano',
    'DOGE': 'dogecoin',
    'TRX': 'tron',
    'DOT': 'polkadot',
    'MATIC': 'matic-network',
    'LTC': 'litecoin',
    'AVAX': 'avalanche-2',
    'SHIB': 'shiba-inu',
    'LINK': 'chainlink',
    'ATOM': 'cosmos',
    'UNI': 'uniswap'
  };
  const clean = symbol.replace('USDT', '').replace('USD', '').toUpperCase();
  return map[clean] || clean.toLowerCase();
}

export const fetchCoinGeckoMarketData = async (symbol: string, apiKey?: string) => {
  const startTime = Date.now();
  try {
    const id = getCoinGeckoId(symbol);
    // Include 24h change and volume
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true&include_market_cap=true`;

    // Use retry logic
    const response = await retryWithBackoff(async () => {
      return await axios.get(url, { timeout: 10000 });
    });

    if (response.data && response.data[id]) {
      const d = response.data[id];
      return {
        provider: 'coingecko',
        success: true,
        data: {
          hasData: true,
          price: d.usd,
          volume24h: d.usd_24h_vol,
          change24h: d.usd_24h_change,
          marketCap: d.usd_market_cap,
          high24h: 0, // Not in simple/price
          low24h: 0
        },
        latencyMs: Date.now() - startTime
      };
    }

    return {
      provider: 'coingecko',
      success: false,
      data: null,
      error: 'No data for symbol',
      latencyMs: Date.now() - startTime
    };
  } catch (error: any) {
    return {
      provider: 'coingecko',
      success: false,
      data: null,
      error: error.message,
      latencyMs: Date.now() - startTime
    };
  }
};

export const fetchCoinGeckoMetadata = async (symbol: string) => {
  const startTime = Date.now();
  try {
    const id = getCoinGeckoId(symbol);
    const url = `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`;

    const response = await retryWithBackoff(async () => {
      return await axios.get(url, { timeout: 10000 });
    });

    const data = response.data;
    if (data) {
      return {
        success: true,
        data: {
          name: data.name,
          symbol: data.symbol?.toUpperCase(),
          description: data.description?.en || '',
          logo: data.image?.large,
          rank: data.market_cap_rank,
          website: data.links?.homepage?.[0],
          supply: {
            circulating: data.market_data?.circulating_supply,
            total: data.market_data?.total_supply
          },
          // Map tags
          tags: data.categories || []
        },
        latencyMs: Date.now() - startTime,
        provider: 'coingecko'
      };
    }

    return { success: false, data: null, error: 'No data', latencyMs: Date.now() - startTime, provider: 'coingecko' };
  } catch (error: any) {
    return { success: false, data: null, error: error.message, latencyMs: Date.now() - startTime, provider: 'coingecko' };
  }
};

export default {
  fetchCoinGeckoMarketData,
  fetchCoinGeckoMetadata
};
