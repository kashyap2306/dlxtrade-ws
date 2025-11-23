import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

export interface CoinGeckoData {
  historicalData?: Array<{ time: string; price: number; volume?: number }>;
}

const coinGeckoAdapter = {
  httpClient: null as AxiosInstance | null,

  initialize() {
    if (!this.httpClient) {
      this.httpClient = axios.create({
        baseURL: 'https://api.coingecko.com/api/v3',
        timeout: 15000, // Longer timeout for historical data
      });
    }
  },

  /**
   * Get historical price and volume data - replaces CoinAPI historical data
   */
  getHistoricalData: async function(symbol: string, days: number = 90): Promise<CoinGeckoData> {
    this.initialize();
    try {
      // Map symbol to CoinGecko format (bitcoin for BTC, ethereum for ETH, etc.)
      const coinId = this.mapSymbolToCoinId(symbol);

      if (!coinId) {
        logger.warn({ symbol }, 'Could not map symbol to CoinGecko coin ID');
        return {};
      }

      const response = await this.httpClient!.get(`/coins/${coinId}/market_chart`, {
        params: {
          vs_currency: 'usd',
          days: Math.min(days, 365), // CoinGecko limits to 365 days
          interval: days > 90 ? 'daily' : 'hourly' // Use hourly for recent data, daily for longer periods
        }
      });

      const data = response.data;
      if (!data?.prices) {
        return {};
      }

      // CoinGecko returns separate arrays for prices and volumes
      const historicalData = data.prices.map((pricePoint: [number, number], index: number) => {
        const volumePoint = data.total_volumes?.[index];
        return {
          time: new Date(pricePoint[0]).toISOString(),
          price: pricePoint[1],
          volume: volumePoint ? volumePoint[1] : 0
        };
      });

      return { historicalData };
    } catch (error: any) {
      logger.warn({
        error: error.message,
        status: error.response?.status,
        symbol,
        days
      }, 'CoinGecko historical data API error');
      return {};
    }
  },

  /**
   * Get current price data
   */
  getCurrentPrice: async function(coinId: string): Promise<{ usd?: number }> {
    try {
      const response = await this.httpClient.get('/simple/price', {
        params: {
          ids: coinId,
          vs_currencies: 'usd'
        }
      });

      return response.data?.[coinId] || {};
    } catch (error: any) {
      logger.warn({
        error: error.message,
        status: error.response?.status,
        coinId
      }, 'CoinGecko current price API error');
      return {};
    }
  },

  /**
   * Map trading symbol to CoinGecko coin ID
   */
  mapSymbolToCoinId: function(symbol: string): string | null {
    const symbolMap: Record<string, string> = {
      'BTC': 'bitcoin',
      'BTCUSDT': 'bitcoin',
      'ETH': 'ethereum',
      'ETHUSDT': 'ethereum',
      'BNB': 'binancecoin',
      'BNBUSDT': 'binancecoin',
      'ADA': 'cardano',
      'ADAUSDT': 'cardano',
      'SOL': 'solana',
      'SOLUSDT': 'solana',
      'DOT': 'polkadot',
      'DOTUSDT': 'polkadot',
      'DOGE': 'dogecoin',
      'DOGEUSDT': 'dogecoin',
      'AVAX': 'avalanche-2',
      'AVAXUSDT': 'avalanche-2',
      'MATIC': 'matic-network',
      'MATICUSDT': 'matic-network',
      'LINK': 'chainlink',
      'LINKUSDT': 'chainlink',
      'UNI': 'uniswap',
      'UNIUSDT': 'uniswap',
      'AAVE': 'aave',
      'AAVEUSDT': 'aave',
      'SUSHI': 'sushi',
      'SUSHIUSDT': 'sushi',
      'COMP': 'compound-governance-token',
      'COMPUSDT': 'compound-governance-token',
      'MKR': 'maker',
      'MKRUSDT': 'maker',
      'YFI': 'yearn-finance',
      'YFIUSDT': 'yearn-finance',
      'BAL': 'balancer',
      'BALUSDT': 'balancer',
      'CRV': 'curve-dao-token',
      'CRVUSDT': 'curve-dao-token',
    };

    // Try exact match first
    const cleanSymbol = symbol.replace('USDT', '');
    return symbolMap[symbol] || symbolMap[cleanSymbol] || null;
  },
};

export const CoinGeckoAdapter = coinGeckoAdapter;
