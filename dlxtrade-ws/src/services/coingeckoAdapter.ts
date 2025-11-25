import { AdapterError, extractAdapterError } from '../utils/adapterErrorHandler';
import axios from 'axios';

export class CoinGeckoAdapter {
  private baseUrl = 'https://api.coingecko.com/api/v3';

  constructor() {
    // CoinGecko works without API key for basic endpoints
  }

  async getMarketData(symbol: string): Promise<any> {
    // Convert symbol to CoinGecko format (e.g., BTCUSDT -> bitcoin)
    const coinId = this.symbolToCoinId(symbol);
    const url = `${this.baseUrl}/coins/${coinId}`;

    try {

      const response = await axios.get(url, {
        params: {
          localization: false,
          tickers: false,
          market_data: true,
          community_data: false,
          developer_data: false,
          sparkline: false
        },
        timeout: 10000
      });

      if (response.status !== 200) {
        const errorDetails = extractAdapterError('CoinGecko', 'GET', url, { response });
        throw new AdapterError(errorDetails);
      }

      const data = response.data;
      const marketData = data.market_data;

      return {
        price: marketData?.current_price?.usd,
        volume24h: marketData?.total_volume?.usd,
        change24h: marketData?.price_change_percentage_24h,
        marketCap: marketData?.market_cap?.usd,
        rank: data.market_cap_rank,
        ath: marketData?.ath?.usd,
        atl: marketData?.atl?.usd
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new AdapterError({
          adapter: 'CoinGecko',
          method: 'GET',
          url: url,
          statusCode: 404,
          errorMessage: 'Coin not found',
          isAuthError: false
        });
      }

      // CoinGecko rate-limit safe mode: auto-skip on 429 errors
      if (error.response?.status === 429) {
        console.warn(`CoinGecko rate limit hit for ${symbol}, skipping...`);
        return {
          price: null,
          volume24h: null,
          change24h: null,
          marketCap: null,
          rank: null,
          ath: null,
          atl: null,
          rateLimited: true
        };
      }

      const errorDetails = extractAdapterError('CoinGecko', 'GET', url, error);
      throw new AdapterError(errorDetails);
    }
  }

  private symbolToCoinId(symbol: string): string {
    const coinMap: { [key: string]: string } = {
      'BTCUSDT': 'bitcoin',
      'ETHUSDT': 'ethereum',
      'ADAUSDT': 'cardano',
      'DOTUSDT': 'polkadot',
      'LINKUSDT': 'chainlink',
      'LTCUSDT': 'litecoin',
      'XRPUSDT': 'ripple',
      'BCHUSDT': 'bitcoin-cash',
      'BNBUSDT': 'binancecoin',
      'SOLUSDT': 'solana'
    };

    const baseSymbol = symbol.replace('USDT', '').replace('USD', '');
    return coinMap[symbol] || baseSymbol.toLowerCase();
  }
}
