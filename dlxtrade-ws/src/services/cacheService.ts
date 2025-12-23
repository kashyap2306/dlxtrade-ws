import { logger } from '../utils/logger';

/**
 * Centralized Cache Service with TTL support for different data types
 */
export class CacheService {
  private caches = new Map<string, Map<string, CacheEntry>>();
  private cleanupInterval: NodeJS.Timeout;

  // TTL configurations (in milliseconds)
  private readonly TTLS = {
    price: 30 * 1000,        // 15-60s for price data
    ohlc: 10 * 60 * 1000,    // 5-15m for OHLC data
    news: 15 * 60 * 1000,    // 5-30m for news
    metadata: 24 * 60 * 60 * 1000, // 24h for metadata
  };

  constructor() {
    // Periodic cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Get cache entry for a specific data type and key
   */
  get(dataType: keyof typeof this.TTLS, key: string): any | null {
    const cache = this.getCache(dataType);
    const entry = cache.get(key);

    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Set cache entry for a specific data type and key
   */
  set(dataType: keyof typeof this.TTLS, key: string, data: any): void {
    const cache = this.getCache(dataType);
    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
      ttl: this.TTLS[dataType]
    };

    cache.set(key, entry);

    logger.debug({ dataType, key, ttl: entry.ttl }, 'Cache entry set');
  }

  /**
   * Check if cache has valid entry
   */
  has(dataType: keyof typeof this.TTLS, key: string): boolean {
    const cache = this.getCache(dataType);
    const entry = cache.get(key);

    if (!entry) return false;

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Clear all cache entries for a data type
   */
  clear(dataType: keyof typeof this.TTLS): void {
    this.caches.delete(dataType);
    logger.debug({ dataType }, 'Cache cleared');
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.caches.clear();
    logger.debug('All caches cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): Record<string, { entries: number; size: number }> {
    const stats: Record<string, { entries: number; size: number }> = {};

    for (const [dataType, cache] of this.caches.entries()) {
      stats[dataType] = {
        entries: cache.size,
        size: this.estimateSize(cache)
      };
    }

    return stats;
  }

  /**
   * Get or create cache for data type
   */
  private getCache(dataType: string): Map<string, CacheEntry> {
    if (!this.caches.has(dataType)) {
      this.caches.set(dataType, new Map());
    }
    return this.caches.get(dataType)!;
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let totalCleaned = 0;

    for (const [dataType, cache] of this.caches.entries()) {
      for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp > entry.ttl) {
          cache.delete(key);
          totalCleaned++;
        }
      }

      // Remove empty caches
      if (cache.size === 0) {
        this.caches.delete(dataType);
      }
    }

    if (totalCleaned > 0) {
      logger.debug({ totalCleaned }, 'Cache cleanup completed');
    }
  }

  /**
   * Estimate cache size (rough approximation)
   */
  private estimateSize(cache: Map<string, CacheEntry>): number {
    let size = 0;
    for (const [key, entry] of cache.entries()) {
      size += key.length + JSON.stringify(entry.data).length;
    }
    return size;
  }

  /**
   * Cleanup on destroy
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clearAll();
  }
}

interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

export const cacheService = new CacheService();
