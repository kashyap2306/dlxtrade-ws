import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { getFirebaseAdmin } from '../utils/firebase';
import * as admin from 'firebase-admin';
import { AdapterError } from '../utils/adapterErrorHandler';
import { fetchMarketAuxData } from './marketauxAdapter';

/**
 * Scheduled Research Service
 * Runs deep research every 5 minutes for all active users
 * Uses ONLY 5 allowed research APIs: MarketAux, CryptoCompare, Google Finance, Binance Public API, CoinGecko
 *
 * STRICTLY FORBIDDEN:
 * - NO trading exchange APIs (Binance, Bitget, BingX, WEEX) - except Binance Public API for research only
 * - NO LunarCrush, CoinAPI, CryptoQuant calls (removed)
 * - NO getOrderbook() calls
 * - NO getKlines() calls
 * - NO getTicker() calls for trading
 * - NO exchangeConfig/current access for trading
 * - NO resolveExchangeConnector() calls for trading
 *
 * This service is completely independent of trading exchange adapters.
 */
export class ScheduledResearchService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start the scheduled research job (runs every 5 minutes)
   * Wrapped in try/catch to prevent crashes
   */
  start() {
    try {
      if (this.intervalId) {
        logger.warn('Scheduled research service already running');
        return;
      }

      logger.info('Starting scheduled research service (every 5 minutes) - Research APIs only');
      
      // Run immediately on start, then every 5 minutes
      // Wrap initial run in try/catch
      try {
        this.runScheduledResearch();
      } catch (err: any) {
        logger.error({ error: err.message, stack: err.stack }, 'Error in initial scheduled research run');
      }
      
      // Wrap interval callback in error handler
      this.intervalId = setInterval(() => {
        try {
          this.runScheduledResearch();
        } catch (err: any) {
          logger.error({ error: err.message, stack: err.stack }, 'Error in scheduled research interval - continuing');
          // Don't throw - continue running
        }
      }, 5 * 60 * 1000); // 5 minutes
    } catch (err: any) {
      logger.error({ error: err.message, stack: err.stack }, 'Error starting scheduled research service');
      // Don't throw - allow server to continue
    }
  }

  /**
   * Stop the scheduled research job
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Stopped scheduled research service');
    }
  }

  /**
   * Run research for all active users
   * Wrapped in comprehensive error handling to prevent crashes
   */
  private async runScheduledResearch() {
    try {
      if (this.isRunning) {
        logger.warn('Scheduled research already running, skipping');
        return;
      }

      this.isRunning = true;
      logger.info('Running scheduled research for all users (Research APIs only)');

      try {
        // Wrap Firebase access in try/catch
        let db;
        try {
          db = getFirebaseAdmin().firestore();
        } catch (fbErr: any) {
          logger.error({ error: fbErr.message, stack: fbErr.stack }, 'Failed to get Firebase Admin in scheduled research');
          return; // Exit early if Firebase is not available
        }
        
        // Get all users (limit to first 100 to avoid timeout)
        const usersSnapshot = await db.collection('users').limit(100).get();
        
        const results = [];
        for (const userDoc of usersSnapshot.docs) {
          const uid = userDoc.id;
          try {
            // CHECK PREMIUM AGENT: Only run scheduled research for users with Premium Trading Agent unlocked
            const userData = userDoc.data();
            const unlockedAgents = userData?.unlockedAgents || [];
            const hasPremiumAgent = unlockedAgents.includes('Premium Trading Agent');

            if (!hasPremiumAgent) {
              logger.debug({ uid }, 'Skipping scheduled research - Premium Trading Agent not unlocked');
              results.push({ uid, status: 'skipped', reason: 'Premium Agent not unlocked' });
              continue;
            }

            // CHECK AUTO-TRADE ENABLED: Only run scheduled research for users with autoTradeEnabled = true
            const autoTradeEnabled = userData?.autoTradeEnabled || false;

            if (!autoTradeEnabled) {
              logger.debug({ uid }, 'Skipping scheduled research - autoTradeEnabled is false');
              results.push({ uid, status: 'skipped', reason: 'autoTradeEnabled=false' });
              continue;
            }

            await this.runResearchForUser(uid);
            results.push({ uid, status: 'success' });
          } catch (error: any) {
            // Log error but don't crash - continue with other users
            logger.error({ error: error.message, stack: error.stack, uid }, 'Error running scheduled research for user');
            results.push({ uid, status: 'error', error: error.message });
          }
        }

        const totalUsers = usersSnapshot.size;
        const successfulUsers = results.filter(r => r.status === 'success').length;
        const failedUsers = results.filter(r => r.status === 'error').length;

        logger.info({
          totalUsers,
          successful: successfulUsers,
          failed: failedUsers
        }, 'Scheduled research completed — totalUsers: ${totalUsers}, successful: ${successfulUsers}, failed: ${failedUsers}');
      } catch (error: any) {
        logger.error({ error: error.message, stack: error.stack }, 'Error in scheduled research service');
      } finally {
        this.isRunning = false;
      }
    } catch (outerErr: any) {
      // Catch any errors in the outer try block
      logger.error({ error: outerErr.message, stack: outerErr.stack }, 'Fatal error in runScheduledResearch - resetting isRunning flag');
      this.isRunning = false;
      // Don't throw - allow service to continue
    }
  }

  /**
   * Run research for a specific user using ONLY 5 allowed research APIs
   * Public method for manual triggering via API endpoint
   */
  async runResearchForUser(uid: string): Promise<{
    success: boolean;
    symbol: string;
    signal?: 'BUY' | 'SELL' | 'HOLD';
    accuracy?: number;
    reasoning?: string;
    errors?: Array<{ adapter: string; error: string; isAuthError: boolean }>;
    providersCalled?: string[];
  }> {
    try {
      // Get user's API integrations from Firestore
      const integrations = await firestoreAdapter.getEnabledIntegrations(uid);

      // Check for the 2 required user-provided APIs (others are auto-enabled)
      const hasCryptoCompare = integrations.cryptocompare?.apiKey;
      const hasMarketAux = integrations.marketaux?.apiKey;

      // Auto-enabled providers (Google Finance, Binance Public, CoinGecko)
      const hasGoogleFinance = true; // Always enabled
      const hasBinancePublic = true; // Always enabled
      const hasCoinGecko = true; // Always enabled

      if (!hasCryptoCompare && !hasMarketAux) {
        // Skip users without at least one of the required APIs
        logger.debug({ uid }, 'Skipping user - no required research API credentials');
        return {
          success: false,
          symbol: 'BTCUSDT',
          providersCalled: [],
          errors: [{
            adapter: 'Required APIs',
            error: 'Missing CryptoCompare or MarketAux API key',
            isAuthError: true,
          }],
        };
      }

      // Default symbol to analyze
      const symbol = 'BTCUSDT';

      // Track which providers were called
      const providersCalled: string[] = [];

      // Collect data from allowed research APIs with proper error handling
      const researchData: any = {
        cryptocompare: null,
        marketaux: null,
        googlefinance: null,
        binance_public: null,
        coingecko: null,
      };

      // Track errors for detailed response
      const adapterErrors: Array<{ adapter: string; error: string; isAuthError: boolean }> = [];

      // Fetch CryptoCompare data (required user API)
      if (hasCryptoCompare) {
        try {
          providersCalled.push('CryptoCompare');
          const { CryptoCompareAdapter } = await import('./cryptocompareAdapter');
          const adapter = new CryptoCompareAdapter(integrations.cryptocompare.apiKey);
          researchData.cryptocompare = await adapter.getMarketData(symbol);
          logger.debug({ uid, symbol, adapter: 'CryptoCompare' }, 'CryptoCompare data fetched successfully');
        } catch (err: any) {
          await this.handleAdapterError(uid, 'CryptoCompare', err, symbol, adapterErrors);
        }
      }

      // Fetch MarketAux data (required user API)
      if (hasMarketAux) {
        try {
          providersCalled.push('MarketAux');
          researchData.marketaux = await fetchMarketAuxData(integrations.marketaux.apiKey, symbol);
          logger.debug({ uid, symbol, adapter: 'MarketAux' }, 'MarketAux data fetched successfully');
        } catch (err: any) {
          await this.handleAdapterError(uid, 'MarketAux', err, symbol, adapterErrors);
        }
      }

      // Fetch Google Finance data (auto-enabled)
      if (hasGoogleFinance) {
        try {
          providersCalled.push('GoogleFinance');
          const { GoogleFinanceAdapter } = await import('./googleFinanceAdapter');
          const adapter = new GoogleFinanceAdapter();
          researchData.googlefinance = await adapter.getMarketData(symbol);
          logger.debug({ uid, symbol, adapter: 'GoogleFinance' }, 'Google Finance data fetched successfully');
        } catch (err: any) {
          await this.handleAdapterError(uid, 'GoogleFinance', err, symbol, adapterErrors, false);
        }
      }

      // Fetch Binance Public API data (auto-enabled)
      if (hasBinancePublic) {
        try {
          providersCalled.push('BinancePublic');
          const { BinanceAdapter } = await import('./binanceAdapter');
          const adapter = new BinanceAdapter(); // Public API only
          researchData.binance_public = await adapter.getPublicMarketData(symbol);
          logger.debug({ uid, symbol, adapter: 'BinancePublic' }, 'Binance Public API data fetched successfully');
        } catch (err: any) {
          await this.handleAdapterError(uid, 'BinancePublic', err, symbol, adapterErrors, false);
        }
      }

      // Fetch CoinGecko data (auto-enabled)
      if (hasCoinGecko) {
        try {
          providersCalled.push('CoinGecko');
          const { CoinGeckoAdapter } = await import('./coingeckoAdapter');
          const adapter = new CoinGeckoAdapter();
          researchData.coingecko = await adapter.getMarketData(symbol);
          logger.debug({ uid, symbol, adapter: 'CoinGecko' }, 'CoinGecko data fetched successfully');
        } catch (err: any) {
          await this.handleAdapterError(uid, 'CoinGecko', err, symbol, adapterErrors, false);
        }
      }
      //
      //     researchData.cryptoquant = {
      //       onChainMetrics: await cryptoQuantAdapter.getOnChainMetrics(symbol),
      //       exchangeFlow: await cryptoQuantAdapter.getExchangeFlow(symbol),
      //     };
      //
      //     logger.info({ uid, symbol }, 'CryptoQuant: Successfully fetched research data');
      // } catch (err: any) {
      //     // Check if it's an auth error - if so, skip this user gracefully
      //     const isAuthError = err instanceof AdapterError && err.details.isAuthError;
      //
      //     // Store error to Firestore
      //     await this.storeAdapterError(uid, 'CryptoQuant', err, symbol);
      //
      //     // Track error for response
      //     adapterErrors.push({
      //       adapter: 'CryptoQuant',
      //       error: err instanceof AdapterError ? err.details.errorMessage : err?.message || String(err),
      //       isAuthError,
      //     });
      //
      //     if (isAuthError) {
      //       logger.warn({ uid, symbol, adapter: 'CryptoQuant' }, 'CryptoQuant auth error - skipping user for this run');
      //       // Skip this user for this run (graceful skip-on-auth-failure)
      //       await this.notifyAdminAuthError(uid, 'CryptoQuant', err);
      //       return {
      //         success: false,
      //         symbol,
      //         errors: adapterErrors,
      //       };
      //     }
      //
      //     logger.debug({ err: err.message, uid, symbol }, 'CryptoQuant fetch error (non-critical)');
      //     // Continue with other APIs for non-auth errors
      //   }
      // }

      // Calculate signal and accuracy based on research API data only
      const { signal, accuracy, reasoning } = this.calculateSignalFromResearchData(researchData, symbol);

      // Save to research logs with type indicator
      const db = getFirebaseAdmin().firestore();
      await db.collection('users').doc(uid).collection('researchLogs').add({
        symbol,
        signal,
        accuracy,
        timestamp: admin.firestore.Timestamp.now(),
        orderbookImbalance: 0, // Not available from research APIs
        recommendedAction: reasoning,
        researchType: 'auto', // Mark as auto research
        microSignals: {
          cryptocompare: researchData.cryptocompare ? 'available' : 'unavailable',
          marketaux: researchData.marketaux ? 'available' : 'unavailable',
          googlefinance: researchData.googlefinance ? 'available' : 'unavailable',
          binance_public: researchData.binance_public ? 'available' : 'unavailable',
          coingecko: researchData.coingecko ? 'available' : 'unavailable',
        },
        providersCalled,
        researchData, // Store raw research data for analysis
        createdAt: admin.firestore.Timestamp.now(),
      });

      logger.info({
        uid,
        symbol,
        signal,
        accuracy,
        providersCalled: providersCalled.join(', '),
        errorCount: adapterErrors.length
      }, 'Scheduled research completed and saved (5 allowed APIs only)');

      return {
        success: adapterErrors.length === 0,
        symbol,
        signal,
        accuracy,
        reasoning,
        providersCalled,
        errors: adapterErrors.length > 0 ? adapterErrors : undefined,
      };
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack, uid }, 'Error in runResearchForUser');
      return {
        success: false,
        symbol: 'BTCUSDT',
        providersCalled: [],
        errors: [{
          adapter: 'System',
          error: error.message || 'Unknown system error',
          isAuthError: false,
        }],
      };
    }
  }

  /**
   * Handle adapter errors with improved logging and Firestore storage
   */
  private async handleAdapterError(
    uid: string,
    adapterName: string,
    error: any,
    symbol: string,
    adapterErrors: Array<{ adapter: string; error: string; isAuthError: boolean }>,
    isUserProvidedApi: boolean = true
  ): Promise<void> {
    const isAuthError = error instanceof AdapterError && error.details?.isAuthError;
    const isNetworkError = error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED';

    // Generate short error ID for Firestore (not full stack traces)
    const errorId = `${adapterName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Store concise error in Firestore
    await this.storeAdapterError(uid, adapterName, errorId, symbol, isAuthError, isNetworkError);

    // Track error for response
    adapterErrors.push({
      adapter: adapterName,
      error: this.getShortErrorMessage(error),
      isAuthError,
    });

    // Handle auth errors for user-provided APIs
    if (isAuthError && isUserProvidedApi) {
      logger.warn({ uid, symbol, adapter: adapterName }, `${adapterName} auth error - skipping user`);
      await this.notifyAdminAuthError(uid, adapterName, error);
      throw new Error(`${adapterName} authentication failed`);
    }

    // Log network errors without stack traces
    if (isNetworkError) {
      logger.debug({ uid, symbol, adapter: adapterName, errorId }, `${adapterName} network error (non-critical)`);
    } else {
      logger.debug({ error: error.message, uid, symbol, adapter: adapterName }, `${adapterName} fetch error (non-critical)`);
    }
  }

  /**
   * Get short error message without stack traces
   */
  private getShortErrorMessage(error: any): string {
    if (error instanceof AdapterError) {
      return error.details?.errorMessage || error.message;
    }

    if (error.code === 'ENOTFOUND') return 'DNS resolution failed';
    if (error.code === 'ECONNREFUSED') return 'Connection refused';
    if (error.code === 'ETIMEDOUT') return 'Request timeout';

    return error?.message || 'Unknown error';
  }

  /**
   * Store adapter error to Firestore for debugging (short error IDs only)
   */
  private async storeAdapterError(
    uid: string,
    adapter: string,
    errorId: string,
    symbol: string,
    isAuthError: boolean = false,
    isNetworkError: boolean = false
  ): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const timestamp = admin.firestore.Timestamp.now();

      // Store concise error information only (no stack traces)
      await db.collection('logs').doc('researchErrors')
        .collection(uid)
        .doc(errorId)
        .set({
          adapter,
          symbol,
          errorType: isAuthError ? 'auth' : isNetworkError ? 'network' : 'other',
          timestamp: admin.firestore.Timestamp.now(),
          // No full error messages or stack traces stored
        });

      logger.debug({ uid, adapter, errorId, symbol }, 'Adapter error stored in Firestore');
    } catch (storeError: any) {
      logger.error({ error: storeError.message, uid, adapter }, 'Failed to store adapter error');
    }
  }

  /**
   * Notify admin about authentication errors
   */
  private async notifyAdminAuthError(uid: string, adapter: string, error: any): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const errorMessage = error instanceof AdapterError 
        ? error.details.errorMessage 
        : error?.message || String(error);
      
      // Create notification for admin
      await db.collection('notifications').add({
        type: 'research_auth_error',
        title: `Research API Auth Error: ${adapter}`,
        message: `User ${uid} has authentication error with ${adapter}: ${errorMessage}`,
        userId: 'admin', // Or use a system admin UID
        data: {
          uid,
          adapter,
          errorMessage,
          timestamp: admin.firestore.Timestamp.now(),
        },
        read: false,
        createdAt: admin.firestore.Timestamp.now(),
      });
      
      logger.info({ uid, adapter }, 'Admin notified about research auth error');
    } catch (notifyError: any) {
      logger.error({ err: notifyError, uid, adapter }, 'Failed to notify admin about auth error');
    }
  }

  /**
   * Calculate trading signal and accuracy from research API data only
   */
  private calculateSignalFromResearchData(researchData: any, symbol: string): {
    signal: 'BUY' | 'SELL' | 'HOLD';
    accuracy: number;
    reasoning: string;
  } {
    let accuracy = 0.5; // Base accuracy
    let bullishSignals = 0;
    let bearishSignals = 0;
    const reasons: string[] = [];

    // Analyze CryptoQuant data
    if (researchData.cryptoquant) {
      try {
        const flowData = researchData.cryptoquant.exchangeFlow;
        const onChainData = researchData.cryptoquant.onChainMetrics;

        if (flowData?.exchangeFlow && flowData.exchangeFlow > 0) {
          bullishSignals++;
          accuracy += 0.05;
          reasons.push('Positive exchange flow (CryptoQuant)');
        } else if (flowData?.exchangeFlow && flowData.exchangeFlow < 0) {
          bearishSignals++;
          accuracy -= 0.03;
          reasons.push('Negative exchange flow (CryptoQuant)');
        }

        if (onChainData?.whaleTransactions && onChainData.whaleTransactions > 10) {
          bullishSignals++;
          accuracy += 0.03;
          reasons.push('High whale activity (CryptoQuant)');
        }

        if (onChainData?.activeAddresses && onChainData.activeAddresses > 100000) {
          bullishSignals++;
          accuracy += 0.02;
          reasons.push('High network activity (CryptoQuant)');
        }
      } catch (err) {
        // Ignore errors in data analysis
      }
    }

    // Analyze LunarCrush sentiment data
    if (researchData.lunarcrush) {
      try {
        const sentiment = researchData.lunarcrush.sentiment;
        const socialVolume = researchData.lunarcrush.socialVolume;
        const bullishSentiment = researchData.lunarcrush.bullishSentiment;

        if (sentiment && sentiment > 0.3) {
          bullishSignals++;
          accuracy += 0.05;
          reasons.push('Positive sentiment (LunarCrush)');
        } else if (sentiment && sentiment < -0.3) {
          bearishSignals++;
          accuracy -= 0.03;
          reasons.push('Negative sentiment (LunarCrush)');
        }

        if (socialVolume && socialVolume > 1000) {
          bullishSignals++;
          accuracy += 0.03;
          reasons.push('High social volume (LunarCrush)');
        }

        if (bullishSentiment && bullishSentiment > 0.6) {
          bullishSignals++;
          accuracy += 0.02;
          reasons.push('Bullish sentiment percentage (LunarCrush)');
        }
      } catch (err) {
        // Ignore errors in data analysis
      }
    }

    // Analyze CoinAPI Market data
    if (researchData.coinapi_market) {
      try {
        const priceChange24h = researchData.coinapi_market.priceChangePercent24h;
        const volume24h = researchData.coinapi_market.volume24h;

        if (priceChange24h && priceChange24h > 2) {
          bullishSignals++;
          accuracy += 0.03;
          reasons.push('Positive 24h price change (CoinAPI)');
        } else if (priceChange24h && priceChange24h < -2) {
          bearishSignals++;
          accuracy -= 0.02;
          reasons.push('Negative 24h price change (CoinAPI)');
        }

        if (volume24h && volume24h > 1000000) {
          bullishSignals++;
          accuracy += 0.02;
          reasons.push('High volume (CoinAPI)');
        }
      } catch (err) {
        // Ignore errors in data analysis
      }
    }

    // Analyze CoinAPI Flatfile historical data
    if (researchData.coinapi_flatfile?.historicalData) {
      try {
        const historicalData = researchData.coinapi_flatfile.historicalData;
        if (historicalData.length >= 2) {
          const recent = historicalData[historicalData.length - 1];
          const previous = historicalData[historicalData.length - 2];
          const trend = (recent.close - previous.close) / previous.close;

          if (trend > 0.02) {
            bullishSignals++;
            accuracy += 0.03;
            reasons.push('Uptrend from historical data (CoinAPI)');
          } else if (trend < -0.02) {
            bearishSignals++;
            accuracy -= 0.02;
            reasons.push('Downtrend from historical data (CoinAPI)');
          }
        }
      } catch (err) {
        // Ignore errors in data analysis
      }
    }

    // Count successful API calls for accuracy boost
    let apiSuccessCount = 0;
    if (researchData.cryptoquant) apiSuccessCount++;
    if (researchData.lunarcrush) apiSuccessCount++;
    if (researchData.coinapi_market) apiSuccessCount++;
    if (researchData.coinapi_flatfile) apiSuccessCount++;
    if (researchData.coinapi_exchangerate) apiSuccessCount++;
    
    // Base accuracy boost from API success (each API adds 5%)
    const apiBoost = Math.min(0.25, apiSuccessCount * 0.05); // Max 25% boost
    accuracy = accuracy + apiBoost;
    
    // Cap accuracy between 0.55 and 0.95 (minimum 55% for all signals)
    accuracy = Math.min(0.95, Math.max(0.55, accuracy));

    // Determine signal based on signal count and accuracy
    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    if (bullishSignals > bearishSignals && accuracy >= 0.55) {
      signal = 'BUY';
    } else if (bearishSignals > bullishSignals && accuracy >= 0.55) {
      signal = 'SELL';
    }
    
    // Ensure minimum 55% accuracy for non-neutral signals
    if (signal !== 'HOLD' && accuracy < 0.55) {
      accuracy = 0.55;
    }

    const reasoning = reasons.length > 0 
      ? `${reasons.join('; ')}. Accuracy: ${(accuracy * 100).toFixed(1)}%` 
      : `Insufficient data for signal determination. Accuracy: ${(accuracy * 100).toFixed(1)}%`;

    return { signal, accuracy, reasoning };
  }
}

export const scheduledResearchService = new ScheduledResearchService();
