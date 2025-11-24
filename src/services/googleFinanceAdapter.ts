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
      const rate = await this.parseExchangeRateFromHTML(html);

      if (rate && rate > 0) {
        this.lastKnownRate = rate;
        this.lastFetchTime = now;
        logger.info({ rate, baseCurrency, quoteCurrency }, 'Successfully fetched USD/INR rate');
        return { exchangeRate: rate };
      } else {
        // Fallback to last known rate
        logger.warn({ baseCurrency, quoteCurrency }, 'Failed to get exchange rate, using cached rate');
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
   * Parse exchange rate from Google Finance HTML with multiple fallback strategies
   */
  parseExchangeRateFromHTML: function(html: string): number | null {
    try {
      // Strategy 1: Look for JSON data in script tags (most reliable)
      const jsonMatches = html.match(/\{[^}]*"rate"[^}]*\}/g);
      if (jsonMatches) {
        for (const jsonStr of jsonMatches) {
          try {
            const data = JSON.parse(jsonStr);
            if (data.rate && typeof data.rate === 'number') {
              if (data.rate > 10 && data.rate < 200) {
                return data.rate;
              }
            }
          } catch (e) {
            // Continue to next match
          }
        }
      }

      // Strategy 2: Look for rate in data attributes
      const dataValueMatches = html.match(/data-value="([0-9.]+)"/g);
      if (dataValueMatches) {
        for (const match of dataValueMatches) {
          const rateMatch = match.match(/data-value="([0-9.]+)"/);
          if (rateMatch) {
            const rate = parseFloat(rateMatch[1]);
            if (rate > 10 && rate < 200) {
              return rate;
            }
          }
        }
      }

      // Strategy 3: Regex patterns for visible text
      const ratePatterns = [
        /([0-9]{2}\.[0-9]{2,4})\s*INR/,  // Rate followed by INR
        /([0-9]{2}\.[0-9]{2,4})\s*USD/,  // Rate followed by USD
        /([0-9]{2}\.[0-9]{2,4})\s*Indian Rupee/,  // Rate followed by currency name
        />?\s*([0-9]{2}\.[0-9]{2,4})\s*</,  // Rate in HTML tags
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

      // Strategy 4: Try alternative API endpoint (exchangerate-api.com as backup)
      logger.warn('Primary Google Finance parsing failed, attempting fallback API');
      return this.getFallbackExchangeRate();

    } catch (error: any) {
      logger.warn({ error: error.message }, 'Error parsing Google Finance HTML');
      return this.getFallbackExchangeRate();
    }
  },

  /**
   * Get exchange rate from fallback API when Google Finance fails
   */
  getFallbackExchangeRate: async function(): Promise<number | null> {
    try {
      const response = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', {
        timeout: 5000
      });

      const rate = response.data?.rates?.INR;
      if (rate && rate > 10 && rate < 200) {
        logger.info({ rate }, 'Successfully fetched fallback exchange rate');
        return rate;
      }
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Fallback exchange rate API also failed');
    }

    // Ultimate fallback - return cached rate
    logger.warn({ cachedRate: this.lastKnownRate }, 'Using cached exchange rate as final fallback');
    return this.lastKnownRate;
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
