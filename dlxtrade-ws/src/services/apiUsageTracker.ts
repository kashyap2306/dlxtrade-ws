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
      // Import estimated limits dynamically to avoid circular dependencies if any
      const { ESTIMATED_FREE_TIER_LIMITS } = await import('../config/apiProviders');
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

      // --- DASHBOARD INTEGRATION LOGIC START ---
      // Update persistent integration usage stats for Dashboard
      try {
        const integrationDoc = await firestoreAdapter.getIntegration(userId, providerName);

        const nowObj = new Date();
        const todayStart = new Date(nowObj).setHours(0, 0, 0, 0);
        const thisMonthStart = new Date(nowObj.getFullYear(), nowObj.getMonth(), 1).getTime();

        // 1. Initialize stats with defaults if missing
        const currentStats = integrationDoc?.usageStats || {
          usedToday: 0,
          usedThisMonth: 0,
          totalUsed: 0,
          lastReset: 0,
          lastMonthlyReset: 0,
          dailyLimit: null,
          monthlyLimit: null,
          limitSource: 'estimated'
        };

        // Ensure new fields exist even if object existed
        if (currentStats.usedThisMonth === undefined) currentStats.usedThisMonth = currentStats.usedToday || 0;
        if (currentStats.totalUsed === undefined) currentStats.totalUsed = currentStats.usedToday || 0; // approximatiom if missing
        if (currentStats.limitSource === undefined) currentStats.limitSource = 'estimated';


        // 2. Lazy Resets
        // Daily Reset
        const lastResetTime = currentStats.lastReset || 0;
        if (lastResetTime < todayStart) {
          currentStats.usedToday = 0;
          currentStats.lastReset = now;
        }

        // Monthly Reset
        const lastMonthlyResetTime = currentStats.lastMonthlyReset || 0;
        if (lastMonthlyResetTime < thisMonthStart) {
          currentStats.usedThisMonth = 0;
          currentStats.lastMonthlyReset = now;
        }

        // 3. Increment counters
        currentStats.usedToday = (currentStats.usedToday || 0) + 1;
        currentStats.usedThisMonth = (currentStats.usedThisMonth || 0) + 1;
        currentStats.totalUsed = (currentStats.totalUsed || 0) + 1; // Lifetime never resets
        currentStats.lastReset = now; // Update last activity time

        // 4. Apply Fixed Limits for Primary APIs
        const lowerProvider = providerName.toLowerCase();

        // Normalize provider ID if needed (e.g. newsdataio -> newsdata)
        const normalizedProvider = lowerProvider === 'newsdataio' ? 'newsdata' : lowerProvider;

        // CRITICAL: Explicit hardcoded limits for Primary APIs to ensure they are never missed
        const PRIMARY_LIMITS: Record<string, { daily: number; monthly: number }> = {
          'coingecko': { daily: 10000, monthly: 300000 },
          'cryptocompare': { daily: 100000, monthly: 3000000 },
          'newsdata': { daily: 200, monthly: 6000 }
        };

        if (PRIMARY_LIMITS[normalizedProvider]) {
          // Rule: If source is 'api', NEVER overwrite.
          // If source is 'fixed', we can refresh the values in case we changed them in code.
          const canApplyFixed = currentStats.limitSource !== 'api';

          if (canApplyFixed) {
            currentStats.dailyLimit = PRIMARY_LIMITS[normalizedProvider].daily;
            currentStats.monthlyLimit = PRIMARY_LIMITS[normalizedProvider].monthly;
            currentStats.limitSource = 'fixed'; // Enforce 'fixed' source
          }
        } else if (ESTIMATED_FREE_TIER_LIMITS[normalizedProvider]) {
          // Fallback for other providers
          const canApplyEstimated = currentStats.limitSource !== 'api' && currentStats.limitSource !== 'fixed';
          if (canApplyEstimated) {
            currentStats.dailyLimit = ESTIMATED_FREE_TIER_LIMITS[normalizedProvider].daily;
            currentStats.monthlyLimit = ESTIMATED_FREE_TIER_LIMITS[normalizedProvider].monthly;
            currentStats.limitSource = 'estimated';
          }
        }

        // 5. Calculate derived metrics with strict clamping
        // Daily
        if (currentStats.dailyLimit && currentStats.dailyLimit > 0) {
          const limit = currentStats.dailyLimit;
          const used = currentStats.usedToday || 0;
          currentStats.remaining = Math.max(0, limit - used);
          // Clamp to 100 max
          currentStats.usagePercent = Math.min(100, Math.round((used / limit) * 100));
        } else {
          currentStats.remaining = null;
          currentStats.usagePercent = null;
        }

        // Monthly
        if (currentStats.monthlyLimit && currentStats.monthlyLimit > 0) {
          const mLimit = currentStats.monthlyLimit;
          const mUsed = currentStats.usedThisMonth || 0;
          currentStats.monthlyRemaining = Math.max(0, mLimit - mUsed);
          // Clamp to 100 max
          currentStats.monthlyUsagePercent = Math.min(100, Math.round((mUsed / mLimit) * 100));
        } else {
          currentStats.monthlyRemaining = null;
          currentStats.monthlyUsagePercent = null;
        }

        // Add pre-calculated derived fields for frontend
        currentStats.dailyUsagePercent = currentStats.usagePercent; // Alias for clarity
        currentStats.remainingToday = currentStats.remaining;       // Alias for clarity
        currentStats.remainingThisMonth = currentStats.monthlyRemaining;

        currentStats.isEstimated = currentStats.limitSource === 'estimated';

        // Update usage in Firestore
        await firestoreAdapter.updateIntegrationUsageStats(userId, providerName, currentStats);

      } catch (dashError: any) {
        // Non-blocking error for dashboard stats
        logger.warn({ userId, providerName, error: dashError.message }, 'Failed to update dashboard usage stats');
      }
      // --- DASHBOARD INTEGRATION LOGIC END ---

      logger.debug({ userId, providerName, totalHourly: this.getHourlyUsage(userId, providerName) }, 'API usage recorded');

    } catch (error: any) {
      logger.error({ error: error.message, userId, providerName }, 'Failed to record API usage');
    }
  }

  /**
   * Initialize usage stats for a provider with estimated limits if not already set
   */
  async initializeProviderStats(userId: string, providerName: string): Promise<any> {
    try {
      // Import estimated limits dynamically
      const { ESTIMATED_FREE_TIER_LIMITS } = await import('../config/apiProviders');

      const lowerProvider = providerName.toLowerCase();
      // Normalize provider ID
      const normalizedProvider = lowerProvider === 'newsdataio' ? 'newsdata' : lowerProvider;

      // CRITICAL: Explicit hardcoded limits for Primary APIs to ensure they are never missed
      const PRIMARY_LIMITS: Record<string, { daily: number; monthly: number }> = {
        'coingecko': { daily: 10000, monthly: 300000 },
        'cryptocompare': { daily: 100000, monthly: 3000000 },
        'newsdata': { daily: 200, monthly: 6000 }
      };

      // Determine limits to use: Priority to hardcoded, then config, then null
      const limits = PRIMARY_LIMITS[normalizedProvider] || ESTIMATED_FREE_TIER_LIMITS[normalizedProvider];

      if (!limits) {
        return null; // No estimated limits available
      }

      const integrationDoc = await firestoreAdapter.getIntegration(userId, providerName);
      const now = Date.now();

      // Check if stats already exist
      let stats = integrationDoc?.usageStats;

      if (stats) {
        let needsUpdate = false;

        // CRITICAL STRICT RULE: For Primary APIs, ALWAYS enforce "fixed" source and limits
        // We do not trust "api" or "estimated" for these specific providers in this version.
        if (limits === PRIMARY_LIMITS[normalizedProvider]) {
          // It is a primary provider
          if (stats.limitSource !== 'fixed' || stats.dailyLimit !== limits.daily || stats.monthlyLimit !== limits.monthly) {
            stats.dailyLimit = limits.daily;
            stats.monthlyLimit = limits.monthly;
            stats.limitSource = 'fixed';
            needsUpdate = true;
          }
        } else {
          // For non-primary (backups), use standard backfill logic
          if (!stats.dailyLimit || !stats.monthlyLimit) {
            stats.dailyLimit = limits.daily;
            stats.monthlyLimit = limits.monthly;
            if (!stats.limitSource || stats.limitSource !== 'api') {
              stats.limitSource = 'estimated';
            }
            needsUpdate = true;
          }
        }

        // Clean up text fields if they slipped in (sanity check)
        if (typeof stats.dailyLimit !== 'number') stats.dailyLimit = limits.daily;
        if (typeof stats.monthlyLimit !== 'number') stats.monthlyLimit = limits.monthly;

        if (needsUpdate) {
          // Fix 4: Recompute derived fields
          stats.remainingToday = Math.max(0, stats.dailyLimit - (stats.usedToday || 0));
          stats.remainingThisMonth = Math.max(0, stats.monthlyLimit - (stats.usedThisMonth || 0));
          stats.dailyUsagePercent = Math.min(100, Math.round(((stats.usedToday || 0) / stats.dailyLimit) * 100));
          stats.monthlyUsagePercent = Math.min(100, Math.round(((stats.usedThisMonth || 0) / stats.monthlyLimit) * 100));
          stats.isEstimated = stats.limitSource === 'estimated' || stats.limitSource === 'fixed';

          await firestoreAdapter.updateIntegrationUsageStats(userId, providerName, stats);
          logger.info({ userId, providerName }, 'Enforced fixed limits for API usage stats');
        }

        return stats;
      }

      // New initialization (Fix 2: Never set limitSource = 'api' here)
      const newStats = {
        usedToday: 0,
        usedThisMonth: 0,
        totalUsed: 0,
        lastReset: now,
        lastMonthlyReset: now,
        dailyLimit: limits.daily,
        monthlyLimit: limits.monthly,
        // For primary APIs we are certain about the limits we set, so we call them 'fixed'
        limitSource: 'fixed',
        remainingToday: limits.daily,
        remainingThisMonth: limits.monthly,
        dailyUsagePercent: 0,
        monthlyUsagePercent: 0,
        isEstimated: true
      };

      // Initial save to Firestore
      await firestoreAdapter.updateIntegrationUsageStats(userId, providerName, newStats);

      logger.info({ userId, providerName }, 'Initialized API usage stats with estimated limits');
      return newStats;
    } catch (error: any) {
      logger.warn({ userId, providerName, error: error.message }, 'Failed to initialize API usage stats');
      return null;
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
