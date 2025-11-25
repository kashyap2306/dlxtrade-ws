import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { getFirebaseAdmin } from '../utils/firebase';
import * as admin from 'firebase-admin';
import { AdapterError } from '../utils/adapterErrorHandler';

/**
 * Scheduled Research Service
 * Runs deep research every 5 minutes for all active users
 * Uses ONLY research APIs: CryptoQuant, LunarCrush, CoinAPI
 * 
 * STRICTLY FORBIDDEN:
 * - NO trading exchange APIs (Binance, Bitget, BingX, WEEX)
 * - NO getOrderbook() calls
 * - NO getKlines() calls
 * - NO getTicker() calls
 * - NO exchangeConfig/current access
 * - NO resolveExchangeConnector() calls
 * - NO WeexAdapter, BinanceAdapter, BitgetAdapter, BingXAdapter usage
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

        logger.info({ 
          totalUsers: usersSnapshot.size, 
          successful: results.filter(r => r.status === 'success').length,
          failed: results.filter(r => r.status === 'error').length,
        }, 'Scheduled research completed');
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
   * Run research for a specific user using ONLY research APIs
   * Public method for manual triggering via API endpoint
   */
  async runResearchForUser(uid: string): Promise<{
    success: boolean;
    symbol: string;
    signal?: 'BUY' | 'SELL' | 'HOLD';
    accuracy?: number;
    reasoning?: string;
    errors?: Array<{ adapter: string; error: string; isAuthError: boolean }>;
  }> {
    try {
      // Get enabled research integrations (NO trading exchange credentials needed)
      const integrations = await firestoreAdapter.getEnabledIntegrations(uid);
      
      // Check if at least one research API is configured
      const hasCryptoQuant = integrations.cryptoquant?.apiKey;
      const hasLunarCrush = integrations.lunarcrush?.apiKey;
      const hasCoinAPIMarket = integrations['coinapi_market']?.apiKey;
      const hasCoinAPIFlatfile = integrations['coinapi_flatfile']?.apiKey;
      const hasCoinAPIExchangerate = integrations['coinapi_exchangerate']?.apiKey;
      
      if (!hasCryptoQuant && !hasLunarCrush && !hasCoinAPIMarket && !hasCoinAPIFlatfile && !hasCoinAPIExchangerate) {
        // Silently skip users without research API credentials (no log spam)
        return {
          success: false,
          symbol: 'BTCUSDT',
          errors: [{
            adapter: 'All',
            error: 'No research API credentials configured',
            isAuthError: false,
          }],
        };
      }

      // Default symbol to analyze
      const symbol = 'BTCUSDT';

      // Collect data from research APIs with proper error handling
      const researchData: any = {
        cryptoquant: null,
        lunarcrush: null,
        coinapi_market: null,
        coinapi_flatfile: null,
        coinapi_exchangerate: null,
      };

      // Track errors for detailed response
      const adapterErrors: Array<{ adapter: string; error: string; isAuthError: boolean }> = [];

      // DISABLED: Fetch CryptoQuant data (if available) - CryptoQuant removed
      // if (hasCryptoQuant) {
      //   try {
      //     // Log API key status before creating adapter (for debugging)
      //     const cryptoquantApiKey = integrations.cryptoquant.apiKey;
      //     logger.info({
      //       uid,
      //       symbol,
      //       hasApiKey: !!cryptoquantApiKey,
      //       apiKeyLength: cryptoquantApiKey?.length || 0,
      //       apiKeyPrefix: cryptoquantApiKey?.substring(0, 4) || 'N/A',
      //     }, 'CryptoQuant: Loading adapter with API key');
      //
      //     const { CryptoQuantAdapter } = await import('./cryptoquantAdapter');
      //     const cryptoQuantAdapter = new CryptoQuantAdapter(cryptoquantApiKey);
      //
      //     logger.debug({ uid, symbol }, 'CryptoQuant: Fetching on-chain metrics and exchange flow');
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

      // Fetch LunarCrush data (if available)
      if (hasLunarCrush) {
        try {
          const { LunarCrushAdapter } = await import('./lunarcrushAdapter');
          const lunarcrushAdapter = new LunarCrushAdapter(integrations.lunarcrush.apiKey);
          researchData.lunarcrush = await lunarcrushAdapter.getCoinData(symbol);
      } catch (err: any) {
          const isAuthError = err instanceof AdapterError && err.isAuthError;
          
          await this.storeAdapterError(uid, 'LunarCrush', err, symbol);
          
          adapterErrors.push({
            adapter: 'LunarCrush',
            error: err instanceof AdapterError ? err.details.errorMessage : err?.message || String(err),
            isAuthError,
          });
          
          if (isAuthError) {
            logger.warn({ uid, symbol, adapter: 'LunarCrush' }, 'LunarCrush auth error - skipping user for this run');
            await this.notifyAdminAuthError(uid, 'LunarCrush', err);
            return {
              success: false,
              symbol,
              errors: adapterErrors,
            };
          }
          
          logger.debug({ err: err.message, uid, symbol }, 'LunarCrush fetch error (non-critical)');
        }
      }

      // Fetch CoinAPI Market data (if available)
      if (hasCoinAPIMarket) {
        try {
          const { CoinAPIAdapter } = await import('./coinapiAdapter');
          const marketAdapter = new CoinAPIAdapter(integrations['coinapi_market'].apiKey, 'market');
          researchData.coinapi_market = await marketAdapter.getMarketData(symbol);
        } catch (err: any) {
          const isAuthError = err instanceof AdapterError && err.isAuthError;
          
          await this.storeAdapterError(uid, 'CoinAPI_market', err, symbol);
          
          adapterErrors.push({
            adapter: 'CoinAPI_market',
            error: err instanceof AdapterError ? err.details.errorMessage : err?.message || String(err),
            isAuthError,
          });
          
          if (isAuthError) {
            logger.warn({ uid, symbol, adapter: 'CoinAPI_market' }, 'CoinAPI Market auth error - skipping user for this run');
            await this.notifyAdminAuthError(uid, 'CoinAPI_market', err);
            return {
              success: false,
              symbol,
              errors: adapterErrors,
            };
          }
          
          logger.debug({ err: err.message, uid, symbol }, 'CoinAPI Market fetch error (non-critical)');
        }
      }

      // Fetch CoinAPI Flatfile data (if available)
      if (hasCoinAPIFlatfile) {
        try {
          const { CoinAPIAdapter } = await import('./coinapiAdapter');
          const flatfileAdapter = new CoinAPIAdapter(integrations['coinapi_flatfile'].apiKey, 'flatfile');
          researchData.coinapi_flatfile = await flatfileAdapter.getHistoricalData(symbol, 7);
      } catch (err: any) {
          const isAuthError = err instanceof AdapterError && err.isAuthError;
          
          await this.storeAdapterError(uid, 'CoinAPI_flatfile', err, symbol);
          
          adapterErrors.push({
            adapter: 'CoinAPI_flatfile',
            error: err instanceof AdapterError ? err.details.errorMessage : err?.message || String(err),
            isAuthError,
          });
          
          if (isAuthError) {
            logger.warn({ uid, symbol, adapter: 'CoinAPI_flatfile' }, 'CoinAPI Flatfile auth error - skipping user for this run');
            await this.notifyAdminAuthError(uid, 'CoinAPI_flatfile', err);
            return {
              success: false,
              symbol,
              errors: adapterErrors,
            };
          }
          
          logger.debug({ err: err.message, uid, symbol }, 'CoinAPI Flatfile fetch error (non-critical)');
        }
      }

      // Fetch CoinAPI Exchange Rate data (if available)
      if (hasCoinAPIExchangerate) {
        try {
          const { CoinAPIAdapter } = await import('./coinapiAdapter');
          const baseAsset = symbol.replace('USDT', '').replace('USD', '');
          const exchangerateAdapter = new CoinAPIAdapter(integrations['coinapi_exchangerate'].apiKey, 'exchangerate');
          researchData.coinapi_exchangerate = await exchangerateAdapter.getExchangeRate(baseAsset, 'USD');
        } catch (err: any) {
          const isAuthError = err instanceof AdapterError && err.isAuthError;
          
          await this.storeAdapterError(uid, 'CoinAPI_exchangerate', err, symbol);
          
          adapterErrors.push({
            adapter: 'CoinAPI_exchangerate',
            error: err instanceof AdapterError ? err.details.errorMessage : err?.message || String(err),
            isAuthError,
          });
          
          if (isAuthError) {
            logger.warn({ uid, symbol, adapter: 'CoinAPI_exchangerate' }, 'CoinAPI ExchangeRate auth error - skipping user for this run');
            await this.notifyAdminAuthError(uid, 'CoinAPI_exchangerate', err);
            return {
              success: false,
              symbol,
              errors: adapterErrors,
            };
          }
          
          logger.debug({ err: err.message, uid, symbol }, 'CoinAPI ExchangeRate fetch error (non-critical)');
        }
      }

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
          cryptoquant: researchData.cryptoquant ? 'available' : 'unavailable',
          lunarcrush: researchData.lunarcrush ? 'available' : 'unavailable',
          coinapi_market: researchData.coinapi_market ? 'available' : 'unavailable',
          coinapi_flatfile: researchData.coinapi_flatfile ? 'available' : 'unavailable',
          coinapi_exchangerate: researchData.coinapi_exchangerate ? 'available' : 'unavailable',
        },
        researchData, // Store raw research data for analysis
        createdAt: admin.firestore.Timestamp.now(),
      });

      logger.info({ uid, symbol, signal, accuracy }, 'Scheduled research completed and saved (Research APIs only)');
      
      return {
        success: true,
        symbol,
        signal,
        accuracy,
        reasoning,
        errors: adapterErrors.length > 0 ? adapterErrors : undefined,
      };
    } catch (error: any) {
      // Log error but don't throw - let the service continue
      logger.error({ error: error.message, uid }, 'Error running research for user (non-critical)');
      
      // Store error if it's an AdapterError
      if (error instanceof AdapterError) {
        await this.storeAdapterError(uid, error.adapter, error, 'BTCUSDT');
      }
      
      return {
        success: false,
        symbol: 'BTCUSDT',
        errors: [{
          adapter: error instanceof AdapterError ? error.adapter : 'Unknown',
          error: error?.message || String(error),
          isAuthError: error instanceof AdapterError ? error.isAuthError : false,
        }],
      };
    }
  }

  /**
   * Store adapter error to Firestore for debugging
   */
  private async storeAdapterError(uid: string, adapter: string, error: any, symbol: string): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const timestamp = admin.firestore.Timestamp.now();
      const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Extract error details
      let statusCode: number | undefined;
      let responseSnippet: string | undefined;
      let errorMessage: string;
      let stack: string | undefined;
      let isAuthError = false;
      
      if (error instanceof AdapterError) {
        statusCode = error.details.statusCode;
        responseSnippet = error.details.responseSnippet?.substring(0, 2000); // First 2000 chars
        errorMessage = error.details.errorMessage;
        stack = error.stack;
        isAuthError = error.details.isAuthError;
      } else {
        errorMessage = error?.message || String(error);
        stack = error?.stack;
        statusCode = error?.response?.status || error?.statusCode;
        if (error?.response?.data) {
          try {
            responseSnippet = JSON.stringify(error.response.data).substring(0, 2000);
          } catch (e) {
            responseSnippet = String(error.response.data).substring(0, 2000);
          }
        }
        // Check if it's an auth error
        const errorStr = errorMessage.toLowerCase();
        isAuthError = 
          statusCode === 401 || 
          statusCode === 403 ||
          errorStr.includes('unsupported state') ||
          errorStr.includes('unable to authenticate') ||
          errorStr.includes('authentication') ||
          errorStr.includes('unauthorized');
      }
      
      // Store to logs/researchErrors/{uid}/{timestamp}
      await db.collection('logs').doc('researchErrors')
        .collection(uid)
        .doc(errorId)
        .set({
          adapter,
          symbol,
          statusCode,
          responseSnippet,
          errorMessage,
          stack,
          isAuthError,
          timestamp,
          createdAt: timestamp,
        });
      
      // Increment researchErrorCount and update lastErrorAt
      const userRef = db.collection('users').doc(uid);
      await userRef.update({
        researchErrorCount: admin.firestore.FieldValue.increment(1),
        lastErrorAt: timestamp,
      });
      
      logger.info({ uid, adapter, errorId, isAuthError }, 'Adapter error stored to Firestore');
    } catch (storeError: any) {
      logger.error({ err: storeError, uid, adapter }, 'Failed to store adapter error to Firestore');
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
