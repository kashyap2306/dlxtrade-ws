import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { API_PROVIDERS_CONFIG, providerRequiresApiKey } from '../config/apiProviders';
import { getUserIntegrationsByUid } from '../routes/users/providerConfig';
import { apiUsageTracker } from './apiUsageTracker';
import { FreeModeProviderResult, ProviderBackupConfig } from './researchTypes';
import {
  fetchMarketDataFromProvider,
  fetchCryptoCompareFreeData,
  fetchAlphaVantageFreeData,
  fetchCoinGeckoFreeData,
  fetchMetadataFromProvider,
  fetchNewsFromProvider
} from './providerFetchers';

/**
 * Execute provider with automatic backup fallback
 */
// executeProviderWithBackups REMOVED - Logic inlined into specific providers for better control and usage tracking

/**
 * Update provider usage statistics in user settings
 */
export async function updateProviderUsageStats(
  uid: string,
  providerId: string,
  providerType: 'marketData' | 'news' | 'metadata',
  success: boolean,
  latencyMs: number
): Promise<void> {
  try {
    // 1. UPDATE DASHBOARD STATS (Source of Truth: users/{uid}/integrations)
    // This updates the 'usageStats' field used by the Profile Dashboard
    await apiUsageTracker.recordUsage(uid, providerId);

    // 2. OPTIONAL: Update performance metrics (latency/success rate)
    // Note: This legacy logic writes to 'settings/providers' which might be disjoint from 'integrations'.
    // We keep it for now for backward compatibility with any other components reading settings directly.
    /*
    const userProviderSettings = await firestoreAdapter.getUserProviderSettings(uid) || {};

    if (!userProviderSettings[providerType]) {
      userProviderSettings[providerType] = { primary: {}, backups: {} };
    }
    // ... existing logic ...
    */
    // For now, we trust apiUsageTracker handles the critical "Usage Count" for the dashboard.
    // If we need latency stats, we should add recordLatency to apiUsageTracker.

  } catch (error: any) {
    logger.error({ error: error.message, providerId, providerType }, 'Failed to update provider usage stats');
  }
}

/**
 * Execute Market Data provider with backups
 * Priority: 1) CoinGecko (DEFAULT), 2) User-enabled backup providers
 */
export async function executeMarketDataProvider(
  symbol: string,
  config: ProviderBackupConfig,
  integrations: any,
  uid: string,
  backgroundMode?: boolean
): Promise<FreeModeProviderResult> {
  console.log('🔄 EXECUTE MARKET DATA PROVIDER: Called for symbol', symbol);

  try {
    // Get user provider config from integrations (single source of truth)
    const providerConfig = await getUserIntegrationsByUid(uid);
    const marketDataProviders = providerConfig.marketData || {};

    // Build enabled providers list with priority order
    const enabledProviders: Array<{ id: string; hasKey: boolean; priority: number }> = [];

    // PRIORITY 1: CoinGecko (DEFAULT PROVIDER - always enabled)
    if (marketDataProviders.coingecko?.enabled) {
      enabledProviders.push({
        id: 'coingecko',
        hasKey: false, // CoinGecko doesn't require API key
        priority: 1
      });
      console.log('✅ MARKET DATA: CoinGecko added as default provider (priority 1)');
    } else {
      // CoinGecko should always be enabled, but if not in config, add it anyway
      enabledProviders.push({
        id: 'coingecko',
        hasKey: false,
        priority: 1
      });
      console.log('✅ MARKET DATA: CoinGecko added as default provider (fallback)');
    }

    // PRIORITY 2: User-enabled backup providers (in defined priority order)
    const backupProviderPriority = [
      'coinpaprika',    // FREE
      'coinlore',       // FREE
      'coincheckup',    // FREE
      'coinmarketcap',  // API KEY REQUIRED
      'coinapi',        // API KEY REQUIRED
      'bravenewcoin',   // API KEY REQUIRED
      'messari',        // API KEY REQUIRED
      'kaiko',          // API KEY REQUIRED
      'livecoinwatch',  // API KEY REQUIRED
      'coinstats'       // API KEY REQUIRED
    ];

    let priorityCounter = 2;
    for (const providerId of backupProviderPriority) {
      const provider = marketDataProviders[providerId];
      if (provider && provider.enabled) {
        const requiresKey = providerRequiresApiKey(providerId);
        const hasKey = !!(provider.apiKey && provider.apiKey.trim());

        // For providers that require API key, only add if key exists
        if (requiresKey && !hasKey) {
          console.log(`⚠️ MARKET DATA: Skipping ${providerId} - requires API key but none provided`);
          continue;
        }

        enabledProviders.push({
          id: providerId,
          hasKey: hasKey,
          priority: priorityCounter++
        });
        console.log(`✅ MARKET DATA: Added ${providerId} as backup provider (priority ${priorityCounter - 1})`);
      }
    }

    // CRITICAL: Ensure at least one system fallback provider is always available
    const hasSystemProvider = enabledProviders.some(p =>
      p.id === 'coingecko' || p.id === 'coinpaprika' || p.id === 'coinlore'
    );

    if (!hasSystemProvider) {
      console.log('⚠️ MARKET DATA: No system providers found, injecting CoinGecko fallback');
      enabledProviders.unshift({
        id: 'coingecko',
        hasKey: false,
        priority: 0 // Highest priority
      });
    }

    // CRITICAL: Validate provider count before proceeding
    if (enabledProviders.length === 0) {
      const errorMsg = 'No market data providers available for research';
      logger.error({ symbol, uid, error: errorMsg }, 'Provider validation failed');
      // CRITICAL: Do NOT throw - return failure result instead (FreeMode must never throw)
      return {
        success: false,
        data: null,
        latencyMs: 0,
        provider: 'none',
        error: errorMsg
      };
    }

    console.log(`🔄 MARKET DATA: Trying ${enabledProviders.length} enabled providers for ${symbol} in priority order`);
    console.log(`📊 MARKET DATA: Provider list:`, enabledProviders.map(p => `${p.id} (priority ${p.priority}, keyed: ${p.hasKey})`).join(', '));

    // Try each enabled provider in priority order (CoinGecko first, then backups)
    for (const provider of enabledProviders) {
      const startTime = Date.now();
      try {
        console.log(`🔄 MARKET DATA: Trying ${provider.id} (priority ${provider.priority}, keyed: ${provider.hasKey}) for ${symbol}`);

        // Get API key from provider config if needed
        const providerConfigData = marketDataProviders[provider.id];
        const apiKey = providerConfigData?.apiKey || '';

        const result = await fetchMarketDataFromProvider(provider.id, symbol, integrations, apiKey);

        if (result.success) {
          console.log(`✅ MARKET DATA: ${provider.id} succeeded in ${Date.now() - startTime}ms`);
          result.latencyMs = Date.now() - startTime;
          // Update usage statistics
          await updateProviderUsageStats(uid, provider.id, 'marketData', true, result.latencyMs);
          return result;
        } else {
          console.log(`⚠️ MARKET DATA: ${provider.id} returned success=false: ${result.error}`);
          // Update usage statistics for failed attempt
          await updateProviderUsageStats(uid, provider.id, 'marketData', false, Date.now() - startTime);
          // Continue to next provider (automatic fallback)
        }
      } catch (error: any) {
        console.error(`❌ MARKET DATA: ${provider.id} failed:`, error.message);
        // Log failure reason for diagnostics
        logger.warn({
          provider: provider.id,
          symbol,
          error: error.message,
          errorType: error.name
        }, 'Market data provider failure');
        // Continue to next provider (automatic fallback)
      }
    }

    // All enabled providers failed - CRITICAL: This should never happen if system providers are available
    const providersTried = enabledProviders.map(p => p.id);
    logger.error({
      symbol,
      uid,
      providersTried,
      providerCount: enabledProviders.length
    }, 'All market data providers failed - this indicates a system configuration issue');

    // Last resort: try CoinGecko directly (should never reach here if system providers work)
    console.log('🔄 MARKET DATA: Last resort - trying CoinGecko directly');
    try {
      const lastResortResult = await fetchMarketDataFromProvider('coingecko', symbol, integrations, '');
      if (lastResortResult.success) {
        console.log('✅ MARKET DATA: CoinGecko last resort succeeded');
        return lastResortResult;
      }
    } catch (lastResortErr: any) {
      console.error('❌ MARKET DATA: CoinGecko last resort also failed:', lastResortErr.message);
    }

    return {
      success: false,
      data: null,
      latencyMs: 0,
      provider: 'none',
      error: `All ${providersTried.length} market data providers failed (tried: ${providersTried.join(', ')})`
    };

  } catch (error: any) {
    console.error('❌ MARKET DATA: Error getting user provider config:', error.message);
    logger.error({ error: error.message, symbol, uid }, 'Error in executeMarketDataProvider');

    // CRITICAL FALLBACK: Always try CoinGecko even if config fails
    console.log('🔄 MARKET DATA: Fallback - trying CoinGecko directly');
    try {
      const result = await fetchMarketDataFromProvider('coingecko', symbol, integrations, '');
      if (result.success) {
        console.log('✅ MARKET DATA: CoinGecko fallback succeeded');
        return result;
      }
    } catch (fallbackError: any) {
      console.error('❌ MARKET DATA: CoinGecko fallback also failed:', fallbackError.message);
    }

    return {
      success: false,
      data: null,
      latencyMs: 0,
      provider: 'none',
      error: `Failed to fetch market data: ${error.message}`
    };
  }
}

/**
 * Execute CryptoCompare provider with backups (AlphaVantage, CoinGecko)
 */
export async function executeCryptoCompareProvider(
  symbol: string,
  config: ProviderBackupConfig,
  integrations: any,
  uid?: string
): Promise<FreeModeProviderResult> {
  // Use config to determine order
  const providers = [config.primary, ...config.backups];
  const start = Date.now();

  console.log(`🔄 CRYPTOCOMPARE: Trying providers for ${symbol}: ${providers.join(', ')}`);

  for (const provider of providers) {
    const providerStart = Date.now();
    try {
      console.log(`🔄 CRYPTOCOMPARE: Attempting ${provider}`);
      let result: FreeModeProviderResult;

      switch (provider) {
        case 'cryptocompare':
          result = await fetchCryptoCompareFreeData(symbol, integrations);
          break;
        case 'alphavantage':
          result = await fetchAlphaVantageFreeData(symbol);
          break;
        case 'coingecko':
          result = await fetchCoinGeckoFreeData(symbol);
          break;
        default:
          result = {
            success: false,
            data: null,
            latencyMs: 0,
            provider,
            error: `Unknown CryptoCompare backup provider: ${provider}`
          };
      }

      if (result.success) {
        result.latencyMs = Date.now() - providerStart;
        console.log(`✅ CRYPTOCOMPARE: ${provider} succeeded in ${result.latencyMs}ms`);
        // Track usage if UID is provided
        if (uid) {
          await updateProviderUsageStats(uid, provider, 'marketData', true, result.latencyMs);
        }
        return result;
      } else {
        console.log(`⚠️ CRYPTOCOMPARE: ${provider} failed: ${result.error}`);
        if (uid && provider !== 'none') {
          await updateProviderUsageStats(uid, provider, 'marketData', false, Date.now() - providerStart);
        }
      }
    } catch (error: any) {
      console.error(`❌ CRYPTOCOMPARE: ${provider} exception:`, error.message);
      if (uid) {
        await updateProviderUsageStats(uid, provider, 'marketData', false, Date.now() - providerStart);
      }
    }
  }

  return {
    success: false,
    data: null,
    latencyMs: Date.now() - start,
    provider: 'none',
    error: `All CryptoCompare providers failed`
  };
}

/**
 * Execute Metadata provider with backups
 */
export async function executeCMCProvider(
  symbol: string,
  config: ProviderBackupConfig,
  integrations: any,
  uid: string,
  backgroundMode?: boolean
): Promise<FreeModeProviderResult> {
  console.log('🔄 EXECUTE METADATA PROVIDER: Called for symbol', symbol);

  try {
    // Get user provider config from integrations (single source of truth)
    const providerConfig = await getUserIntegrationsByUid(uid);
    const metadataProviders = providerConfig.metadata || {};

    // Get enabled metadata providers
    const enabledProviders: Array<{ id: string; hasKey: boolean; isPrimary: boolean }> = [];

    // PRIORITY 1: System fallback providers (always available, no API key required)
    const systemMetadataProviders = [
      { id: 'coingecko', apiKeyRequired: false },
      { id: 'coinpaprika', apiKeyRequired: false },
      { id: 'coinlore', apiKeyRequired: false },
      { id: 'coincheckup', apiKeyRequired: false },
      { id: 'coincap', apiKeyRequired: false }
    ];

    // Add system providers first (they work without API keys)
    for (const sysProvider of systemMetadataProviders) {
      const providerData = metadataProviders[sysProvider.id];
      // System providers are enabled if user hasn't disabled them OR if they're not in config
      const isEnabled = providerData === undefined || providerData.enabled !== false;
      if (isEnabled) {
        enabledProviders.push({
          id: sysProvider.id,
          hasKey: false,
          isPrimary: sysProvider.id === 'coingecko' // CoinGecko is primary system provider
        });
        console.log(`✅ METADATA: Added system provider ${sysProvider.id} (no API key required)`);
      }
    }

    // PRIORITY 2: User-enabled providers (API key required ones)
    const apiKeyRequiredProviders = ['coinmarketcap', 'coinstats', 'cryptocompare', 'livecoinwatch', 'messari'];
    for (const providerId of apiKeyRequiredProviders) {
      const provider = metadataProviders[providerId];
      if (provider && provider.enabled) {
        const hasKey = !!(provider.apiKey && provider.apiKey.trim());
        if (hasKey) {
          enabledProviders.push({
            id: providerId,
            hasKey: true,
            isPrimary: false
          });
          console.log(`✅ METADATA: Added user provider ${providerId} (with API key)`);
        } else {
          console.log(`⚠️ METADATA: Skipping ${providerId} - enabled but no API key`);
        }
      }
    }

    // Sort providers: keyed providers first, then free providers
    enabledProviders.sort((a, b) => {
      if (a.hasKey && !b.hasKey) return -1;
      if (!a.hasKey && b.hasKey) return 1;
      return 0;
    });

    console.log(`🔄 METADATA: Trying ${enabledProviders.length} enabled providers for ${symbol}`);

    // Try each enabled provider in priority order
    for (const provider of enabledProviders) {
      const startTime = Date.now();
      try {
        console.log(`🔄 METADATA: Trying ${provider.id} (keyed: ${provider.hasKey}) for ${symbol}`);
        const result = await fetchMetadataFromProvider(provider.id, symbol, integrations);

        if (result.success) {
          console.log(`✅ METADATA: ${provider.id} succeeded in ${Date.now() - startTime}ms`);
          result.latencyMs = Date.now() - startTime;
          // Update usage statistics
          await updateProviderUsageStats(uid, provider.id, 'metadata', true, result.latencyMs);
          return result;
        } else {
          console.log(`⚠️ METADATA: ${provider.id} returned success=false: ${result.error}`);
          // Update usage statistics for failed attempt
          await updateProviderUsageStats(uid, provider.id, 'metadata', false, Date.now() - startTime);
        }
      } catch (error: any) {
        console.error(`❌ METADATA: ${provider.id} failed:`, error.message);
      }
    }

    // All enabled providers failed - CRITICAL: Try system fallbacks
    const providersTried = enabledProviders.map(p => p.id);
    logger.error({
      symbol,
      uid,
      providersTried,
      providerCount: enabledProviders.length
    }, 'All metadata providers failed - trying system fallbacks');

    // Last resort: try system fallback providers directly
    const fallbackProviders = ['coingecko', 'coinpaprika'];
    for (const fallbackId of fallbackProviders) {
      if (!providersTried.includes(fallbackId)) {
        console.log(`🔄 METADATA: Last resort - trying ${fallbackId} directly`);
        try {
          const fallbackResult = await fetchMetadataFromProvider(fallbackId, symbol, integrations);
          if (fallbackResult.success) {
            console.log(`✅ METADATA: ${fallbackId} fallback succeeded`);
            return fallbackResult;
          }
        } catch (fallbackErr: any) {
          console.error(`❌ METADATA: ${fallbackId} fallback failed:`, fallbackErr.message);
        }
      }
    }

    return {
      success: false,
      data: null,
      latencyMs: 0,
      provider: 'none',
      error: `All ${providersTried.length} metadata providers failed (tried: ${providersTried.join(', ')})`
    };

  } catch (error: any) {
    console.error('❌ METADATA: Error getting user provider settings:', error.message);
    // Fallback to old behavior if settings can't be loaded
    const providers = ['cryptocompare', 'coingecko', 'coinpaprika'];

    for (const provider of providers) {
      const startTime = Date.now();
      try {
        console.log(`🔄 METADATA: Fallback trying ${provider} for ${symbol}`);
        const result = await fetchMetadataFromProvider(provider, symbol, integrations);

        if (result.success) {
          console.log(`✅ METADATA: ${provider} succeeded in ${Date.now() - startTime}ms`);
          result.latencyMs = Date.now() - startTime;
          return result;
        }
      } catch (error: any) {
        console.error(`❌ METADATA: ${provider} failed:`, error.message);
      }
    }

    return {
      success: false,
      data: null,
      latencyMs: 0,
      provider: 'none',
      error: 'All metadata providers failed'
    };
  }
}

/**
 * Execute News provider with backups (NewsData, CryptoPanic, Reddit, GNews)
 */
export async function executeNewsProvider(
  symbol: string,
  config: ProviderBackupConfig,
  integrations: any,
  uid: string,
  backgroundMode?: boolean,
  forceAllProviders?: boolean
): Promise<FreeModeProviderResult> {
  console.log('🔄 EXECUTE NEWS PROVIDER: Called for symbol', symbol, 'forceAll:', forceAllProviders);

  try {
    // Get user provider config from integrations (single source of truth)
    const providerConfig = await getUserIntegrationsByUid(uid);
    const newsProviders = providerConfig.news || {};

    // Get enabled news providers
    const enabledProviders: Array<{ id: string; hasKey: boolean; isPrimary: boolean }> = [];

    // 1. SYSTEM FALLBACKS (Free, No Key)
    const { SYSTEM_NEWS_PROVIDER_IDS, ALL_NEWS_PROVIDER_IDS } = await import('../config/apiProviders');

    // Add system providers first (canonical source)
    for (const sysId of SYSTEM_NEWS_PROVIDER_IDS) {
      const providerData = newsProviders[sysId];
      // System providers enabled if: forceAll (Deep Research) OR not disabled in config
      const isEnabled = forceAllProviders || providerData?.enabled !== false;
      if (isEnabled) {
        enabledProviders.push({
          id: sysId,
          hasKey: false,
          isPrimary: sysId === 'cointelegraph_rss'
        });
        console.log(`✅ NEWS: Added canonical system provider ${sysId}`);
      }
    }

    // 2. USER PROVIDERS (Key Required)
    for (const providerId of ALL_NEWS_PROVIDER_IDS) {
      if (SYSTEM_NEWS_PROVIDER_IDS.has(providerId)) continue; // Skip already added

      const provider = newsProviders[providerId];
      if (provider && (provider.enabled || forceAllProviders)) {
        const hasKey = !!(provider.apiKey && provider.apiKey.trim());
        if (hasKey) {
          enabledProviders.push({
            id: providerId,
            hasKey: true,
            isPrimary: false
          });
          console.log(`✅ NEWS: Added user provider ${providerId} (with API key)`);
        }
      }
    }

    // Sort providers: keyed providers first, then free providers
    enabledProviders.sort((a, b) => {
      if (a.hasKey && !b.hasKey) return -1;
      if (!a.hasKey && b.hasKey) return 1;
      return 0;
    });

    // CRITICAL: Ensure at least one system fallback provider is always available
    const hasSystemProvider = enabledProviders.some(p => SYSTEM_NEWS_PROVIDER_IDS.has(p.id));

    if (!hasSystemProvider) {
      console.log('⚠️ NEWS: No system providers found, injecting Cointelegraph fallback');
      enabledProviders.unshift({
        id: 'cointelegraph_rss',
        hasKey: false,
        isPrimary: false
      });
    }

    // CRITICAL: Validate provider count before proceeding
    if (enabledProviders.length === 0) {
      const errorMsg = 'No news providers available for research';
      logger.error({ symbol, uid, error: errorMsg }, 'Provider validation failed');
      // CRITICAL: Do NOT throw - return failure result instead (FreeMode must never throw)
      return {
        success: false,
        data: null,
        latencyMs: 0,
        provider: 'none',
        error: errorMsg
      };
    }

    console.log(`🔄 NEWS: Trying ${enabledProviders.length} enabled providers for ${symbol}`);
    console.log(`📊 NEWS: Provider list:`, enabledProviders.map(p => `${p.id} (keyed: ${p.hasKey})`).join(', '));

    // Try each enabled provider in priority order
    for (const provider of enabledProviders) {
      const startTime = Date.now();
      try {
        console.log(`🔄 NEWS: Trying ${provider.id} (keyed: ${provider.hasKey}) for ${symbol}`);
        const result = await fetchNewsFromProvider(provider.id, symbol, integrations);

        if (result.success) {
          console.log(`✅ NEWS: ${provider.id} succeeded in ${Date.now() - startTime}ms`);
          result.latencyMs = Date.now() - startTime;
          // Update usage statistics
          await updateProviderUsageStats(uid, provider.id, 'news', true, result.latencyMs);
          return result;
        } else {
          console.log(`⚠️ NEWS: ${provider.id} returned success=false: ${result.error}`);
          // Update usage statistics for failed attempt
          await updateProviderUsageStats(uid, provider.id, 'news', false, Date.now() - startTime);
        }
      } catch (error: any) {
        console.error(`❌ NEWS: ${provider.id} failed:`, error.message);
      }
    }

    // All enabled providers failed - CRITICAL: Try system fallbacks
    const providersTried = enabledProviders.map(p => p.id);
    logger.error({
      symbol,
      uid,
      providersTried,
      providerCount: enabledProviders.length
    }, 'All news providers failed - trying system fallbacks');

    // Last resort: try system fallback providers directly
    const fallbackProviders = Array.from(SYSTEM_NEWS_PROVIDER_IDS);
    for (const fallbackId of fallbackProviders) {
      if (!providersTried.includes(fallbackId)) {
        console.log(`🔄 NEWS: Last resort - trying ${fallbackId} directly`);
        try {
          const fallbackResult = await fetchNewsFromProvider(fallbackId, symbol, integrations);
          if (fallbackResult.success) {
            console.log(`✅ NEWS: ${fallbackId} fallback succeeded`);
            return fallbackResult;
          }
        } catch (fallbackErr: any) {
          console.error(`❌ NEWS: ${fallbackId} fallback failed:`, fallbackErr.message);
        }
      }
    }

    return {
      success: false,
      data: null,
      latencyMs: 0,
      provider: 'none',
      error: `All ${providersTried.length} news providers failed (tried: ${providersTried.join(', ')})`
    };

  } catch (error: any) {
    console.error('❌ NEWS: Error getting user provider settings:', error.message);
    // Fallback to old behavior if settings can't be loaded
    const providers = ['newsdata', 'cryptopanic', 'cointelegraph_rss', 'altcoinbuzz_rss', 'coinstatsnews'];

    for (const provider of providers) {
      const startTime = Date.now();
      try {
        console.log(`🔄 NEWS: Fallback trying ${provider} for ${symbol}`);
        const result = await fetchNewsFromProvider(provider, symbol, integrations);

        if (result.success) {
          console.log(`✅ NEWS: ${provider} succeeded in ${Date.now() - startTime}ms`);
          result.latencyMs = Date.now() - startTime;
          return result;
        }
      } catch (error: any) {
        console.error(`❌ NEWS: ${provider} failed:`, error.message);
      }
    }

    return {
      success: false,
      data: null,
      latencyMs: 0,
      provider: 'none',
      error: 'All news providers failed'
    };
  }
}

// Global retry budget context (set per research run)
let globalRetryBudgetContext: { getBudget: () => number; consume: () => boolean } | null = null;

export function setGlobalRetryBudgetContext(context: { getBudget: () => number; consume: () => boolean } | null) {
  globalRetryBudgetContext = context;
}

/**
 * Try a provider with timeout and retry logic
 * Respects global retry budget and handles 429 rate limits
 */
export async function tryProviderWithRetry<T>(
  providerFunction: () => Promise<T>,
  providerName: string,
  symbol: string,
  timeoutMs: number,
  maxRetries: number
): Promise<{ success: boolean; data?: T; error?: string; latency: number }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startTime = Date.now();

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
      });

      // Race between the provider call and timeout
      const data = await Promise.race([providerFunction(), timeoutPromise]);

      return {
        success: true,
        data,
        latency: Date.now() - startTime
      };

    } catch (error: any) {
      const latency = Date.now() - startTime;

      // HARD RATE-LIMIT BACKOFF: On HTTP 429, skip provider immediately
      if (error.response?.status === 429) {
        logger.warn({ symbol, provider: providerName }, '[PROVIDER_RATE_LIMITED_SKIP] Skipping provider due to 429 rate limit');
        return {
          success: false,
          error: 'Rate limited (429)',
          latency
        };
      }

      // Check global retry budget before retrying
      const hasRetryBudget = globalRetryBudgetContext?.getBudget() > 0;
      const isRetryable = attempt < maxRetries && hasRetryBudget && (
        error.message?.includes('timeout') ||
        error.message?.includes('network') ||
        error.response?.status >= 500
      );

      if (isRetryable) {
        // Consume global retry budget
        if (globalRetryBudgetContext && !globalRetryBudgetContext.consume()) {
          logger.warn({ symbol, provider: providerName }, '[GLOBAL_RETRY_BUDGET_EXHAUSTED] No retries remaining');
          return {
            success: false,
            error: error.message || 'Unknown error',
            latency
          };
        }

        logger.warn({
          symbol,
          provider: providerName,
          attempt: attempt + 1,
          maxRetries,
          remainingBudget: globalRetryBudgetContext?.getBudget() || 0,
          error: error.message,
          latency
        }, `Provider ${providerName} failed, retrying in 400ms`);

        // Wait 400ms before retry
        await new Promise(resolve => setTimeout(resolve, 400));
        continue;
      }

      return {
        success: false,
        error: error.message || 'Unknown error',
        latency
      };
    }
  }

  return {
    success: false,
    error: 'Max retries exceeded',
    latency: 0
  };
}



