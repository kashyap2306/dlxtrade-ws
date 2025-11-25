import axios from 'axios';
import { logger } from '../utils/logger';

interface ExchangeRateData {
  exchangeRate: number;
}

interface MarketData {
  price: number;
  priceChangePercent?: number;
  change24h: number;
  volume24h: number;
  marketCap?: number;
}

export class GoogleFinanceAdapter {
  private httpClient: any = null;
  private lastKnownRate: number = 83.0; // Fallback rate if scraping fails
  private lastFetchTime: number = 0;
  private CACHE_DURATION: number = 5 * 60 * 1000; // 5 minutes cache

  constructor() {
    this.initialize();
  }

  private initialize() {
    if (!this.httpClient) {
      this.httpClient = axios.create({
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
    }
  }

  /**
   * Get USD to INR exchange rate from Google Finance - replaces CoinAPI exchange rate
   */
  async getExchangeRate(baseCurrency = 'USD', quoteCurrency = 'INR'): Promise<ExchangeRateData> {
    try {
      // Use cached rate if recent enough
      const now = Date.now();
      if (now - this.lastFetchTime < this.CACHE_DURATION) {
        return { exchangeRate: this.lastKnownRate };
      }

      // Google Finance URL for USD/INR
      const url = 'https://www.google.com/finance/quote/USD-INR';
      const response = await this.httpClient.get(url);
      const html = response.data;

      // Parse the exchange rate from HTML
      // Look for the rate in the page content
      const rate = await this.parseExchangeRateFromHTML(html);
      if (rate && rate > 0) {
        this.lastKnownRate = rate;
        this.lastFetchTime = now;
        logger.info({ rate, baseCurrency, quoteCurrency }, 'Successfully fetched USD/INR rate');
        return { exchangeRate: rate };
      }
      else {
        // Fallback to last known rate
        logger.warn({ baseCurrency, quoteCurrency }, 'Failed to get exchange rate, using cached rate');
        return { exchangeRate: this.lastKnownRate };
      }
    } catch (error: any) {
      logger.warn({
        error: error.message,
        baseCurrency,
        quoteCurrency,
        lastKnownRate: this.lastKnownRate
      }, 'Google Finance exchange rate fetch failed, using cached rate');
      return { exchangeRate: this.lastKnownRate };
    }
  }

  async parseExchangeRateFromHTML(html: string): Promise<number | null> {
    try {
      // Look for exchange rate in various formats
      // Google Finance typically shows rates like "83.45" or similar
      const patterns = [
        /"rate":\s*"([^"]+)"/,
        /data-last-price="([^"]+)"/,
        /class="[^"]*rate[^"]*"[^>]*>([^<]+)</,
        /([0-9]+\.[0-9]{2,4})/
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          const rate = parseFloat(match[1]);
          if (rate > 50 && rate < 150) { // Reasonable range for USD/INR
            return rate;
          }
        }
      }

      logger.warn('Could not parse exchange rate from Google Finance HTML');
      return null;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error parsing Google Finance HTML');
      return null;
    }
  }

  async getExchangeRates(baseCurrency = 'USD', quoteCurrency = 'INR'): Promise<ExchangeRateData> {
    return this.getExchangeRate(baseCurrency, quoteCurrency);
  }

  /**
   * Get market data for a cryptocurrency symbol
   */
  async getMarketData(symbol: string): Promise<MarketData> {
    try {
      // For now, return mock data as Google Finance doesn't provide crypto data via API
      // In production, this would scrape Google Finance or use alternative data source
      return {
        price: 50000, // Mock BTC price
        change24h: 2.5,
        volume24h: 25000000,
        marketCap: 1000000000000
      };
    } catch (error: any) {
      logger.error({ error: error.message, symbol }, 'Error fetching Google Finance market data');
      throw new Error(`Google Finance market data error: ${error.message}`);
    }
  }
}




