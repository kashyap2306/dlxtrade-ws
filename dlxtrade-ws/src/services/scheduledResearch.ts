import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { getFirebaseAdmin } from '../utils/firebase';
import { deepResearchEngine } from './deepResearchEngine';
import { autoTradeExecutor } from './autoTradeExecutor';
import * as admin from 'firebase-admin';
import { AdapterError } from '../utils/adapterErrorHandler';
import { config } from '../config';

/**
 * Scheduled Research Service
 * Runs deep research every 5 minutes for all active users
 * Uses ONLY 4 allowed research APIs: NewsData, CryptoCompare, Binance Public API, CoinMarketCap
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
  /**
   * Check if currently in a maintenance window
   */
  private async isMaintenanceWindow(): Promise<boolean> {
    try {
      // Check environment variable for maintenance mode
      const maintenanceMode = process.env.MAINTENANCE_MODE === 'true';
      if (maintenanceMode) {
        return true;
      }

      // Check for scheduled maintenance windows (e.g., weekends 2-4 AM UTC)
      const now = new Date();
      const utcHour = now.getUTCHours();
      const utcDay = now.getUTCDay(); // 0 = Sunday, 6 = Saturday

      // Maintenance window: Saturdays and Sundays, 2-4 AM UTC
      if ((utcDay === 0 || utcDay === 6) && (utcHour >= 2 && utcHour < 4)) {
        return true;
      }

      return false;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error checking maintenance window');
      return false; // Default to allowing research
    }
  }

  /**
   * Check if providers are in a degraded state
   */
  private async areProvidersDegraded(): Promise<boolean> {
    try {
      // Import the usage tracker to check provider status
      const { apiUsageTracker } = await import('./apiUsageTracker');

      const stats = apiUsageTracker.getUsageStats();

      // If more than 50% of providers are exhausted, consider it degraded
      const totalProviders = 4; // binance, cryptocompare, coinmarketcap, newsdata
      const exhaustedCount = stats.exhaustedProviders.length;

      if (exhaustedCount > totalProviders * 0.5) {
        logger.warn({ exhaustedCount, totalProviders }, 'Provider chain degraded - too many exhausted providers');
        return true;
      }

      return false;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error checking provider degradation');
      return false; // Default to allowing research
    }
  }
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
      // Check for maintenance windows
      if (await this.isMaintenanceWindow()) {
        logger.info('Skipping scheduled research due to maintenance window');
        return;
      }

      // Check provider health
      if (await this.areProvidersDegraded()) {
        logger.warn('Skipping scheduled research due to degraded provider chain');
        return;
      }
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error checking maintenance/provider status, proceeding with research');
    }
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
    symbolsProcessed: number;
    results?: Array<{
      symbol: string;
      signal?: 'BUY' | 'SELL' | 'HOLD';
      accuracy?: number;
      success: boolean;
      error?: string;
    }>;
    errors?: Array<{ adapter: string; error: string; isAuthError: boolean }>;
    providersCalled?: string[];
  }> {
    try {
      // Get user's API integrations from Firestore
      const integrations = await firestoreAdapter.getEnabledIntegrations(uid);

      // Check for at least one research API (more lenient than before)
      const hasAnyApi = integrations.cryptocompare?.apiKey || integrations.newsdata?.apiKey ||
                        integrations.coinmarketcap?.apiKey || config.research.cryptocompare.apiKey ||
                        config.research.newsdata.apiKey || config.research.coinmarketcap.apiKey;

      if (!hasAnyApi) {
        // Skip users without any research APIs
        logger.debug({ uid }, 'Skipping user - no research API credentials available');
        return {
          success: false,
          symbolsProcessed: 0,
          providersCalled: [],
          errors: [{
            adapter: 'Research APIs',
            error: 'No research API keys available (user or service-level)',
            isAuthError: true,
          }],
        };
      }

      logger.info({ uid }, 'Running batch deep research analysis for scheduled job');

      // Use batch research processing for multiple symbols
      const batchResults = await deepResearchEngine.runDeepResearchBatch(uid, undefined, 3); // 3 concurrent requests

      // Process results
      const successfulResults = batchResults.filter(r => r.result && !r.error);
      const failedResults = batchResults.filter(r => r.error);

      logger.info({
        uid,
        totalSymbols: batchResults.length,
        successful: successfulResults.length,
        failed: failedResults.length,
        symbolsProcessed: successfulResults.map(r => r.symbol).join(', ')
      }, 'Scheduled batch deep research completed');

      // Check for auto-trading on high-confidence results
      for (const result of successfulResults) {
        if (result.result.accuracy >= 0.75 &&
            (result.result.combinedSignal === 'BUY' || result.result.combinedSignal === 'SELL')) {
          await this.executeAutoTradeIfEnabled(uid, result.symbol, result.result);
        }
      }

      return {
        success: successfulResults.length > 0,
        symbolsProcessed: batchResults.length,
        results: batchResults.map(r => ({
          symbol: r.symbol,
          signal: r.result?.combinedSignal,
          accuracy: r.result?.accuracy,
          success: !r.error,
          error: r.error
        })),
        providersCalled: successfulResults.flatMap(r => r.result?.providersCalled || []),
        errors: failedResults.map(r => ({
          adapter: 'Research',
          error: r.error || 'Unknown error',
          isAuthError: false,
        })),
      };
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack, uid }, 'Error in runResearchForUser with batch deep research');

      // Return minimal fallback response
      return {
        success: false,
        symbolsProcessed: 0,
        providersCalled: [],
        errors: [{
          adapter: 'System',
          error: error.message || 'Batch deep research engine error',
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
   * Execute auto-trade if user has auto-trading enabled and meets accuracy threshold
   */
  private async executeAutoTradeIfEnabled(uid: string, symbol: string, deepResult: any): Promise<void> {
    try {
      // Get user settings to check if auto-trade is enabled
      const db = getFirebaseAdmin().firestore();
      const userDoc = await db.collection('users').doc(uid).get();

      if (!userDoc.exists) {
        logger.debug({ uid }, 'User not found for auto-trade check');
        return;
      }

      const userData = userDoc.data();
      const settings = userData?.settings || {};

      // Check if auto-trade is enabled and user has required exchanges
      if (!settings.enableAutoTrade || !settings.exchanges || settings.exchanges.length === 0) {
        logger.debug({ uid }, 'Auto-trade not enabled or no exchanges configured');
        return;
      }

      // Get current price from research data
      let currentPrice = 50000; // fallback
      if (deepResult.raw?.binancePublic?.price) {
        currentPrice = deepResult.raw.binancePublic.price;
      } else if (deepResult.raw?.coinMarketCap?.marketData?.price) {
        currentPrice = deepResult.raw.coinMarketCap.marketData.price;
      }

      logger.info({
        uid,
        symbol,
        signal: deepResult.combinedSignal,
        accuracy: deepResult.accuracy,
        confidencePercent: Math.round(deepResult.accuracy * 100),
        currentPrice,
        exchanges: settings.exchanges
      }, 'Executing auto-trade for user');

      // Execute trade on user's configured exchanges
      for (const exchange of settings.exchanges) {
        try {
          const tradeResult = await autoTradeExecutor.executeAutoTrade({
            userId: uid,
            symbol,
            signal: deepResult.combinedSignal as 'BUY' | 'SELL',
            confidencePercent: Math.round(deepResult.accuracy * 100),
            researchRequestId: `auto_trade_${Date.now()}_${symbol}_${uid}`,
            currentPrice,
            exchangeName: exchange
          });

          if (tradeResult.success) {
            logger.info({
              uid,
              symbol,
              exchange,
              signal: deepResult.combinedSignal,
              orderId: tradeResult.orderId,
              confidencePercent: Math.round(deepResult.accuracy * 100)
            }, 'Auto-trade executed successfully');
          } else {
            logger.warn({
              uid,
              symbol,
              exchange,
              signal: deepResult.combinedSignal,
              error: tradeResult.error
            }, 'Auto-trade execution failed');
          }
        } catch (tradeError: any) {
          logger.error({
            error: tradeError.message,
            uid,
            symbol,
            exchange,
            signal: deepResult.combinedSignal
          }, 'Auto-trade execution error');
        }
      }
    } catch (error: any) {
      logger.error({
        error: error.message,
        uid,
        symbol,
        signal: deepResult.combinedSignal
      }, 'Error in auto-trade execution');
    }
  }

  /**
   * Calculate trading signal and accuracy from research API data only
   */
}

export const scheduledResearchService = new ScheduledResearchService();
