import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { getFirebaseAdmin } from '../utils/firebase';
import { deepResearchEngine } from './deepResearchEngine';
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

      // Check for at least one of the required user-provided APIs (others are auto-enabled)
      const hasCryptoCompare = integrations.cryptocompare?.apiKey;
      const hasMarketAux = integrations.marketaux?.apiKey;

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

      logger.info({ uid, symbol }, 'Running comprehensive deep research analysis for scheduled job');

      // Use the new deep research engine for full strategy analysis
      const deepResult = await deepResearchEngine.runDeepResearch(symbol, uid);

      logger.info({
        uid,
        symbol,
        signal: deepResult.combinedSignal,
        accuracy: deepResult.accuracy,
        providersCalled: deepResult.providersCalled.join(', '),
        strategies: deepResult.signals.length
      }, 'Scheduled deep research completed with full strategy analysis');

      return {
        success: true,
        symbol,
        signal: deepResult.combinedSignal,
        accuracy: deepResult.accuracy,
        reasoning: `Full strategy analysis completed with ${deepResult.signals.length} strategies`,
        providersCalled: deepResult.providersCalled,
        errors: undefined,
      };
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack, uid }, 'Error in runResearchForUser with deep research engine');

      // Return minimal fallback response
      return {
        success: false,
        symbol: 'BTCUSDT',
        signal: 'HOLD',
        accuracy: 0.5,
        providersCalled: [],
        errors: [{
          adapter: 'System',
          error: error.message || 'Deep research engine error',
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
}

export const scheduledResearchService = new ScheduledResearchService();
