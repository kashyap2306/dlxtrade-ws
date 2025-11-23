import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

export interface GoogleFinanceData {
  exchangeRate?: number;
}

const googleFinanceAdapter = {
  httpClient: null as AxiosInstance | null,
  lastKnownRate: 83.0, // Fallback rate if scraping fails
  lastFetchTime: 0,
  CACHE_DURATION: 5 * 60 * 1000, // 5 minutes cache

  initialize() {
    if (!this.httpClient) {
      this.httpClient = axios.create({
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
    }
  },

  /**
   * Get USD to INR exchange rate from Google Finance - replaces CoinAPI exchange rate
   */
  getExchangeRate: async function(baseCurrency: string = 'USD', quoteCurrency: string = 'INR'): Promise<GoogleFinanceData> {
    this.initialize();
    try {
      // Use cached rate if recent enough
      const now = Date.now();
      if (now - this.lastFetchTime < this.CACHE_DURATION) {
        return { exchangeRate: this.lastKnownRate };
      }

      // Google Finance URL for USD/INR
      const url = 'https://www.google.com/finance/quote/USD-INR';

      const response = await this.httpClient!.get(url);
      const html = response.data;

      // Parse the exchange rate from HTML
      // Look for the rate in the page content
      const rate = this.parseExchangeRateFromHTML(html);

      if (rate && rate > 0) {
        this.lastKnownRate = rate;
        this.lastFetchTime = now;
        logger.info({ rate, baseCurrency, quoteCurrency }, 'Successfully fetched USD/INR rate from Google Finance');
        return { exchangeRate: rate };
      } else {
        // Fallback to last known rate
        logger.warn({ baseCurrency, quoteCurrency }, 'Failed to parse rate from Google Finance, using cached rate');
        return { exchangeRate: this.lastKnownRate };
      }
    } catch (error: any) {
      logger.warn({
        error: error.message,
        status: error.response?.status,
        baseCurrency,
        quoteCurrency
      }, 'Google Finance exchange rate API error, using cached rate');

      // Return last known rate as fallback - don't fail completely
      return { exchangeRate: this.lastKnownRate };
    }
  },

  /**
   * Parse exchange rate from Google Finance HTML
   */
  parseExchangeRateFromHTML: function(html: string): number | null {
    try {
      // Look for the rate in various possible patterns in the HTML
      // Google Finance typically shows the rate in a span or div with specific classes

      // Try to find patterns like "83.25" or "83.25 USD"
      const ratePatterns = [
        /"rate":\s*"([0-9.]+)"/,  // JSON-like pattern
        /([0-9]{2}\.[0-9]{2,4})\s*INR/,  // Rate followed by INR
        /([0-9]{2}\.[0-9]{2,4})\s*USD/,  // Rate followed by USD
        /data-value="([0-9.]+)"/,  // Data attribute
        /class="[^"]*rate[^"]*"[^>]*>([0-9.]+)/,  // Rate class
      ];

      for (const pattern of ratePatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          const rate = parseFloat(match[1]);
          if (rate > 10 && rate < 200) { // Sanity check for USD/INR rate
            return rate;
          }
        }
      }

      // Try a more direct approach - look for the main rate display
      // Google Finance often has the rate in a specific div
      const rateDivMatch = html.match(/<div[^>]*class="[^"]*rate[^"]*"[^>]*>([^<]+)</);
      if (rateDivMatch) {
        const rateText = rateDivMatch[1].replace(/[^0-9.]/g, '');
        const rate = parseFloat(rateText);
        if (rate > 10 && rate < 200) {
          return rate;
        }
      }

      logger.warn('Could not parse exchange rate from Google Finance HTML');
      return null;
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Error parsing Google Finance HTML');
      return null;
    }
  },

  /**
   * Get last known exchange rate (for when API fails)
   */
  getLastKnownRate: function(): number {
    return this.lastKnownRate;
  },

  /**
   * Force refresh the exchange rate
   */
  refreshRate: async function(): Promise<number> {
    const result = await this.getExchangeRate();
    return result.exchangeRate || this.lastKnownRate;
  },
};

export const GoogleFinanceAdapter = googleFinanceAdapter;
