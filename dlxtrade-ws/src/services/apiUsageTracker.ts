import { firestoreAdapter } from './firestoreAdapter';
import { logger } from '../utils/logger';
import { PROVIDER_PRIORITY_CONFIG, isProviderExhausted } from '../config/providerPriority';

interface UsageRecord {
  timestamp: number;
  count: number;
}

interface ProviderUsage {
  provider: string;
  hourlyUsage: UsageRecord[];
  dailyUsage: UsageRecord[];
  lastRotation: number;
}

interface UserApiUsage {
  userId: string;
  providers: Record<string, ProviderUsage>;
  lastUpdated: number;
}

/**
 * API Usage Tracker - manages per-user, per-provider usage counters with rolling windows
 */
export class ApiUsageTracker {
  private cache = new Map<string, UserApiUsage>();
  private readonly WINDOW_HOURS = 24; // Rolling window for usage tracking
  private readonly CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

  constructor() {
    // Periodic cleanup of old usage data
    setInterval(() => this.cleanupOldData(), this.CLEANUP_INTERVAL);
  }

  /**
   * Record API usage for a user and provider
   */
  async recordUsage(userId: string, providerName: string): Promise<void> {
    try {
      const now = Date.now();
      const userUsage = await this.getUserUsage(userId);

      if (!userUsage.providers[providerName]) {
        userUsage.providers[providerName] = {
          provider: providerName,
          hourlyUsage: [],
          dailyUsage: [],
          lastRotation: 0
        };
      }

      const providerUsage = userUsage.providers[providerName];

      // Add to hourly usage (rolling window)
      providerUsage.hourlyUsage.push({ timestamp: now, count: 1 });

      // Add to daily usage
      providerUsage.dailyUsage.push({ timestamp: now, count: 1 });

      // Clean old records (keep last 24 hours)
      const oneDayAgo = now - (24 * 60 * 60 * 1000);
      providerUsage.hourlyUsage = providerUsage.hourlyUsage.filter(record => record.timestamp > oneDayAgo);
      providerUsage.dailyUsage = providerUsage.dailyUsage.filter(record => record.timestamp > oneDayAgo);

      userUsage.lastUpdated = now;

      // Save to cache and Firestore
      this.cache.set(userId, userUsage);
      await this.saveToFirestore(userId, userUsage);

      logger.debug({ userId, providerName, totalHourly: this.getHourlyUsage(userId, providerName) }, 'API usage recorded');

    } catch (error: any) {
      logger.error({ error: error.message, userId, providerName }, 'Failed to record API usage');
    }
  }

  /**
   * Get hourly usage count for a user and provider
   */
  getHourlyUsage(userId: string, providerName: string): number {
    const userUsage = this.cache.get(userId);
    if (!userUsage || !userUsage.providers[providerName]) return 0;

    return userUsage.providers[providerName].hourlyUsage.reduce((sum, record) => sum + record.count, 0);
  }

  /**
   * Get daily usage count for a user and provider
   */
  getDailyUsage(userId: string, providerName: string): number {
    const userUsage = this.cache.get(userId);
    if (!userUsage || !userUsage.providers[providerName]) return 0;

    return userUsage.providers[providerName].dailyUsage.reduce((sum, record) => sum + record.count, 0);
  }

  /**
   * Check if a provider is exhausted for a user
   */
  isProviderExhaustedForUser(userId: string, providerName: string): boolean {
    const hourlyUsage = this.getHourlyUsage(userId, providerName);
    return isProviderExhausted(providerName, hourlyUsage);
  }

  /**
   * Get the next available provider for a user (auto-rotation)
   */
  async getNextAvailableProvider(userId: string, dataType: 'price' | 'historical' | 'metadata' | 'news' | 'sentiment'): Promise<string | null> {
    const { getProvidersForType, getBackupProviders } = await import('../config/providerPriority');

    const providers = getProvidersForType(dataType);
    const userUsage = await this.getUserUsage(userId);

    // First, try primary providers in priority order
    for (const provider of providers) {
      if (!this.isProviderExhaustedForUser(userId, provider.name)) {
        return provider.name;
      }
    }

    // If all primary providers are exhausted, try backups with round-robin
    for (const primaryProvider of providers) {
      const backups = getBackupProviders(primaryProvider.name);
      for (const backup of backups) {
        if (!this.isProviderExhaustedForUser(userId, backup.name)) {
          // Mark primary as rotated
          if (userUsage.providers[primaryProvider.name]) {
            userUsage.providers[primaryProvider.name].lastRotation = Date.now();
          }
          return backup.name;
        }
      }
    }

    return null; // All providers exhausted
  }

  /**
   * Mark a provider as rotated for a user
   */
  async markProviderRotated(userId: string, providerName: string): Promise<void> {
    const userUsage = await this.getUserUsage(userId);

    if (!userUsage.providers[providerName]) {
      userUsage.providers[providerName] = {
        provider: providerName,
        hourlyUsage: [],
        dailyUsage: [],
        lastRotation: 0
      };
    }

    userUsage.providers[providerName].lastRotation = Date.now();
    await this.saveToFirestore(userId, userUsage);

    logger.info({ userId, providerName }, 'Provider marked as rotated');
  }

  /**
   * Get user usage data (from cache or Firestore)
   */
  private async getUserUsage(userId: string): Promise<UserApiUsage> {
    // Check cache first
    const cached = this.cache.get(userId);
    if (cached && (Date.now() - cached.lastUpdated) < 300000) { // 5 minutes cache
      return cached;
    }

    // Load from Firestore
    try {
      const doc = await firestoreAdapter.getApiUsage(userId);
      if (doc) {
        this.cache.set(userId, doc);
        return doc;
      }
    } catch (error: any) {
      logger.warn({ error: error.message, userId }, 'Failed to load API usage from Firestore');
    }

    // Return empty usage if not found
    const emptyUsage: UserApiUsage = {
      userId,
      providers: {},
      lastUpdated: Date.now()
    };

    this.cache.set(userId, emptyUsage);
    return emptyUsage;
  }

  /**
   * Save usage data to Firestore
   */
  private async saveToFirestore(userId: string, usage: UserApiUsage): Promise<void> {
    try {
      await firestoreAdapter.saveApiUsage(userId, usage);
    } catch (error: any) {
      logger.error({ error: error.message, userId }, 'Failed to save API usage to Firestore');
    }
  }

  /**
   * Clean up old usage data
   */
  private cleanupOldData(): void {
    const now = Date.now();
    const cutoffTime = now - (this.WINDOW_HOURS * 60 * 60 * 1000);

    for (const [userId, userUsage] of this.cache.entries()) {
      let hasData = false;

      for (const providerName in userUsage.providers) {
        const provider = userUsage.providers[providerName];

        // Filter out old records
        provider.hourlyUsage = provider.hourlyUsage.filter(record => record.timestamp > cutoffTime);
        provider.dailyUsage = provider.dailyUsage.filter(record => record.timestamp > cutoffTime);

        if (provider.hourlyUsage.length > 0 || provider.dailyUsage.length > 0) {
          hasData = true;
        } else {
          // Remove empty provider entries
          delete userUsage.providers[providerName];
        }
      }

      // Remove users with no data
      if (!hasData) {
        this.cache.delete(userId);
      } else {
        userUsage.lastUpdated = now;
      }
    }

    logger.debug({ cacheSize: this.cache.size }, 'Cleaned up old API usage data');
  }

  /**
   * Get usage statistics for monitoring
   */
  getUsageStats(): { totalUsers: number; totalRequests: number; exhaustedProviders: string[] } {
    let totalRequests = 0;
    const exhaustedProviders = new Set<string>();

    for (const userUsage of this.cache.values()) {
      for (const [providerName, providerUsage] of Object.entries(userUsage.providers)) {
        const hourlyCount = providerUsage.hourlyUsage.reduce((sum, record) => sum + record.count, 0);
        totalRequests += hourlyCount;

        if (isProviderExhausted(providerName, hourlyCount)) {
          exhaustedProviders.add(providerName);
        }
      }
    }

    return {
      totalUsers: this.cache.size,
      totalRequests,
      exhaustedProviders: Array.from(exhaustedProviders)
    };
  }
}

export const apiUsageTracker = new ApiUsageTracker();
