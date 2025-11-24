import { logger } from '../utils/logger';

interface ApiUsageCounter {
  used: number;
  limit: number;
  resetAt: number; // Timestamp when counter resets
}

class ApiUsageTracker {
  private counters: Map<string, ApiUsageCounter> = new Map();
  private resetIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    // Initialize counters for all supported APIs
    this.initializeCounters();
    // Start auto-reset timers
    this.startAutoReset();
  }

  private initializeCounters(): void {
    // Exchange APIs - reset every minute (60 seconds)
    const exchangeApis = ['binance', 'bitget', 'kucoin', 'bingx', 'weex', 'bybit', 'okx'];
    const now = Date.now();
    exchangeApis.forEach(api => {
      this.counters.set(api, {
        used: 0,
        limit: this.getLimit(api),
        resetAt: now + 60000, // Reset in 1 minute
      });
    });

    // External APIs - reset daily (24 hours)
    const externalApis = ['cryptocompare', 'marketaux', 'coinapi', 'coingecko'];
    externalApis.forEach(api => {
      this.counters.set(api, {
        used: 0,
        limit: this.getLimit(api),
        resetAt: now + 24 * 60 * 60 * 1000, // Reset in 24 hours
      });
    });
  }

  private getLimit(api: string): number {
    const limits: { [key: string]: number } = {
      binance: 1200,
      bitget: 1000,
      kucoin: 1000,
      bingx: 1000,
      weex: 1000,
      bybit: 1000,
      okx: 1000,
      cryptocompare: 1000,
      marketaux: 1000,
      coinapi: 1000,
    };
    return limits[api.toLowerCase()] || 1000;
  }

  private startAutoReset(): void {
    // Exchange APIs - reset every minute
    const exchangeApis = ['binance', 'bitget', 'kucoin', 'bingx', 'weex', 'bybit', 'okx'];
    exchangeApis.forEach(api => {
      const interval = setInterval(() => {
        this.resetCounter(api, 60000); // Reset with 1 minute window
      }, 60000); // Every minute
      this.resetIntervals.set(api, interval);
    });

    // External APIs - reset daily
    const externalApis = ['cryptoquant', 'coinapi', 'coingecko'];
    externalApis.forEach(api => {
      const interval = setInterval(() => {
        this.resetCounter(api, 24 * 60 * 60 * 1000); // Reset with 24 hour window
      }, 24 * 60 * 60 * 1000); // Every 24 hours
      this.resetIntervals.set(api, interval);
    });
  }

  private resetCounter(api: string, windowMs: number): void {
    const counter = this.counters.get(api);
    if (counter) {
      counter.used = 0;
      counter.resetAt = Date.now() + windowMs;
      logger.debug({ api, windowMs }, 'API usage counter reset');
    }
  }

  /**
   * Increment API usage counter
   * @param api - API name (e.g., 'binance', 'cryptoquant')
   * @returns true if within limit, false if limit exceeded
   */
  increment(api: string): boolean {
    const apiKey = api.toLowerCase();
    let counter = this.counters.get(apiKey);

    if (!counter) {
      // Auto-initialize if not found
      const isExchange = ['binance', 'bitget', 'kucoin', 'bingx', 'weex', 'bybit', 'okx'].includes(apiKey);
      counter = {
        used: 0,
        limit: this.getLimit(apiKey),
        resetAt: Date.now() + (isExchange ? 60000 : 24 * 60 * 60 * 1000),
      };
      this.counters.set(apiKey, counter);
    }

    // Check if reset time has passed
    if (Date.now() >= counter.resetAt) {
      const isExchange = ['binance', 'bitget', 'kucoin', 'bingx', 'weex', 'bybit', 'okx'].includes(apiKey);
      this.resetCounter(apiKey, isExchange ? 60000 : 24 * 60 * 60 * 1000);
      counter = this.counters.get(apiKey)!;
    }

    // Increment if within limit
    if (counter.used < counter.limit) {
      counter.used++;
      return true;
    }

    logger.warn({ api: apiKey, used: counter.used, limit: counter.limit }, 'API usage limit exceeded');
    return false;
  }

  /**
   * Get current usage stats for all APIs
   */
  getStats(): { [api: string]: { used: number; limit: number; remaining: number; resetAt: number } } {
    const stats: { [api: string]: { used: number; limit: number; remaining: number; resetAt: number } } = {};
    
    this.counters.forEach((counter, api) => {
      stats[api] = {
        used: counter.used,
        limit: counter.limit,
        remaining: Math.max(0, counter.limit - counter.used),
        resetAt: counter.resetAt,
      };
    });

    return stats;
  }

  /**
   * Get usage stats for a specific API
   */
  getApiStats(api: string): { used: number; limit: number; remaining: number; resetAt: number } | null {
    const counter = this.counters.get(api.toLowerCase());
    if (!counter) return null;

    return {
      used: counter.used,
      limit: counter.limit,
      remaining: Math.max(0, counter.limit - counter.used),
      resetAt: counter.resetAt,
    };
  }

  /**
   * Check if API has remaining quota
   */
  hasQuota(api: string): boolean {
    const counter = this.counters.get(api.toLowerCase());
    if (!counter) return true; // Unknown API, allow

    // Check if reset time has passed
    if (Date.now() >= counter.resetAt) {
      const isExchange = ['binance', 'bitget', 'kucoin', 'bingx', 'weex', 'bybit', 'okx'].includes(api.toLowerCase());
      this.resetCounter(api.toLowerCase(), isExchange ? 60000 : 24 * 60 * 60 * 1000);
      return true;
    }

    return counter.used < counter.limit;
  }

  /**
   * Cleanup - clear all intervals
   */
  destroy(): void {
    this.resetIntervals.forEach(interval => clearInterval(interval));
    this.resetIntervals.clear();
    this.counters.clear();
  }
}

export const apiUsageTracker = new ApiUsageTracker();
