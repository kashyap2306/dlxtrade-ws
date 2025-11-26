/**
 * Central Provider Priority Configuration
 * Defines the priority order and fallback chains for all data providers
 */

export interface ProviderConfig {
  name: string;
  type: 'price' | 'historical' | 'metadata' | 'news' | 'sentiment';
  priority: number;
  enabled: boolean;
  rateLimitPerMinute: number;
  backupProviders?: string[];
}

export interface PriorityConfig {
  providers: Record<string, ProviderConfig>;
  fallbackChains: {
    price: string[];
    historical: string[];
    metadata: string[];
    news: string[];
    sentiment: string[];
  };
  rotation: {
    enabled: boolean;
    maxRequestsPerHour: number;
    exhaustionThreshold: number; // percentage (0-1)
    cooldownMinutes: number;
  };
}

// Single source of truth for provider priorities and configurations
export const PROVIDER_PRIORITY_CONFIG: PriorityConfig = {
  providers: {
    // Price data providers
    binance: {
      name: 'binance',
      type: 'price',
      priority: 1,
      enabled: true,
      rateLimitPerMinute: 1200,
      backupProviders: ['coingecko', 'cryptocompare']
    },
    coingecko: {
      name: 'coingecko',
      type: 'price',
      priority: 2,
      enabled: true,
      rateLimitPerMinute: 30,
      backupProviders: ['cryptocompare']
    },

    // Historical/OHLC data providers
    cryptocompare: {
      name: 'cryptocompare',
      type: 'historical',
      priority: 1,
      enabled: true,
      rateLimitPerMinute: 100,
      backupProviders: ['coingecko']
    },

    // Metadata providers
    coinmarketcap: {
      name: 'coinmarketcap',
      type: 'metadata',
      priority: 1,
      enabled: true,
      rateLimitPerMinute: 333,
      backupProviders: ['cryptocompare', 'coingecko']
    },

    // News providers
    cryptopanic: {
      name: 'cryptopanic',
      type: 'news',
      priority: 1,
      enabled: true,
      rateLimitPerMinute: 60,
      backupProviders: ['newsdata']
    },
    newsdata: {
      name: 'newsdata',
      type: 'news',
      priority: 2,
      enabled: true,
      rateLimitPerMinute: 100,
      backupProviders: ['cryptopanic']
    },

    // Sentiment providers (same as news for now)
    cryptopanic_sentiment: {
      name: 'cryptopanic',
      type: 'sentiment',
      priority: 1,
      enabled: true,
      rateLimitPerMinute: 60,
      backupProviders: ['newsdata']
    }
  },

  fallbackChains: {
    price: ['binance', 'coingecko', 'cryptocompare'],
    historical: ['cryptocompare', 'coingecko'],
    metadata: ['coinmarketcap', 'cryptocompare', 'coingecko'],
    news: ['cryptopanic', 'newsdata'],
    sentiment: ['cryptopanic', 'newsdata']
  },

  rotation: {
    enabled: true,
    maxRequestsPerHour: 1000,
    exhaustionThreshold: 0.8, // 80% of rate limit
    cooldownMinutes: 5
  }
};

/**
 * Get providers for a specific data type, ordered by priority
 */
export function getProvidersForType(type: keyof PriorityConfig['fallbackChains']): ProviderConfig[] {
  const providerNames = PROVIDER_PRIORITY_CONFIG.fallbackChains[type];
  return providerNames
    .map(name => PROVIDER_PRIORITY_CONFIG.providers[name])
    .filter(provider => provider && provider.enabled)
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Get backup providers for a given provider
 */
export function getBackupProviders(providerName: string): ProviderConfig[] {
  const provider = PROVIDER_PRIORITY_CONFIG.providers[providerName];
  if (!provider || !provider.backupProviders) return [];

  return provider.backupProviders
    .map(name => PROVIDER_PRIORITY_CONFIG.providers[name])
    .filter(backup => backup && backup.enabled);
}

/**
 * Check if a provider is exhausted based on usage
 */
export function isProviderExhausted(providerName: string, currentUsage: number): boolean {
  const provider = PROVIDER_PRIORITY_CONFIG.providers[providerName];
  if (!provider) return false;

  const threshold = provider.rateLimitPerMinute * PROVIDER_PRIORITY_CONFIG.rotation.exhaustionThreshold;
  return currentUsage >= threshold;
}

export default PROVIDER_PRIORITY_CONFIG;
