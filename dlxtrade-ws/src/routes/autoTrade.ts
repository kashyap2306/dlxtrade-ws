import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { userEngineManager } from '../services/userEngineManager';
import { autoTradeEngine, AutoTradeEngine, TradeSignal } from '../services/autoTradeEngine';
import { logger } from '../utils/logger';
import { decrypt } from '../services/keyManager';
import { BinanceAdapter } from '../services/binanceAdapter';
import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';
import { adminAuthMiddleware } from '../middleware/adminAuth';
import { getUserIntegrationsByUid } from '../routes/users/providerConfig';
import { routeEntryLog, routeExitLog, firestoreReadWithTimeout } from '../utils/routeGuards';

const toggleAutoTradeSchema = z.object({
  enabled: z.boolean(),
  frequencyMinutes: z.number().optional()
});

const configSchema = z.object({
  autoTradeEnabled: z.boolean().optional(),
  perTradeRiskPct: z.number().min(0.1).max(10).optional(),
  maxConcurrentTrades: z.number().int().min(1).max(10).optional(),
  maxDailyLossPct: z.number().min(0.5).max(50).optional(),
  stopLossPct: z.number().min(0.5).max(10).optional(),
  takeProfitPct: z.number().min(0.5).max(20).optional(),
  manualOverride: z.boolean().optional(),
  mode: z.enum(['AUTO', 'MANUAL']).optional(),
  maxTradesPerDay: z.number().int().min(1).max(500).optional(),
  cooldownSeconds: z.number().int().min(0).max(300).optional(),
  panicStopEnabled: z.boolean().optional(),
  slippageBlocker: z.boolean().optional(),
});

const queueSignalSchema = z.object({
  symbol: z.string(),
  signal: z.enum(['BUY', 'SELL']),
  entryPrice: z.number().positive(),
  accuracy: z.number().min(0).max(1),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  reasoning: z.string().optional(),
  requestId: z.string().optional(),
});

const executeTradeSchema = z.object({
  requestId: z.string(),
  signal: queueSignalSchema,
});

/**
 * Auto-Trade Routes
 * Handles comprehensive auto-trade functionality with risk management
 */
export async function autoTradeRoutes(fastify: FastifyInstance) {
  console.log('[AUTO-TRADE ROUTES] FILE LOADED');
  console.log('[AUTO-TRADE ROUTES] Loaded');

  // Register diagnostic-check route FIRST to ensure it's registered
  console.log('[AUTO-TRADE ROUTES] Registering /diagnostic-check route FIRST...');
  fastify.get('/diagnostic-check', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    console.log('[AUTO-TRADE DIAGNOSTIC] ROUTE HIT');
    console.log("[DIAGNOSTIC_CHECK] Route hit - URL:", request.url, "Method:", request.method, "Headers:", JSON.stringify(request.headers));
    try {
      const user = (request as any).user;
      if (!user || !user.uid) {
        console.error("[DIAGNOSTIC_CHECK] No user in request");
        return reply.code(401).send({ error: 'Authentication required' });
      }
      const uid = user.uid;
      console.log("[DIAGNOSTIC_CHECK] Processing for user:", uid);

      const diagnostics: any = {
        timestamp: new Date().toISOString(),
        systemChecks: {},
        walletChecks: {},
        strategyChecks: {},
        safetyChecks: {},
        primaryBlockingReason: null,
        finalVerdict: 'UNKNOWN',
      };

      // ============================================
      // 1. SYSTEM & USER LEVEL CHECKS
      // ============================================
      const config = await autoTradeEngine.loadConfig(uid);
      const userSettings = await firestoreAdapter.getSettings(uid);

      // Try to resolve exchange connector - catch decryption failures
      // CRITICAL: Runtime decryption success is the source of truth, not ENV check
      let exchangeResolved: any = null;
      let exchangeDecryptionFailed = false;
      let exchangeDecryptionError: string | null = null;

      try {
        const { resolveExchangeConnector } = await import('../services/exchangeResolver');
        exchangeResolved = await resolveExchangeConnector(uid);
      } catch (resolveErr: any) {
        if (resolveErr.message?.includes('EXCHANGE_KEY_DECRYPTION_FAILED')) {
          exchangeDecryptionFailed = true;
          exchangeDecryptionError = resolveErr.message;
          logger.error({ uid, error: resolveErr.message }, 'EXCHANGE_KEY_DECRYPTION_FAILED in diagnostic');
        } else {
          logger.warn({ uid, error: resolveErr.message }, 'Error resolving exchange connector');
        }
      }

      // CRITICAL: Check ENCRYPTION_SECRET/ENCRYPTION_KEY env var (informational only)
      // Runtime decryption success overrides ENV check - if exchangeResolved is not null, decryption worked
      const encryptionKeySet = !!(process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_SECRET || process.env.JWT_SECRET);
      const encryptionKeyHash = encryptionKeySet ? (await import('../services/keyManager')).getEncryptionKeyHash(8) : 'NOT_SET';

      // RUNTIME PROOF: If exchange connector resolved successfully, decryption is working
      // NOTE: This will be updated after futures balance fetch if that also succeeds
      // CRITICAL: If exchangeResolved is truthy, runtime decryption MUST be considered succeeded
      let runtimeDecryptionSucceeded = !!exchangeResolved;

      // CRITICAL: Explicitly set encryptionSecretConfigured based on runtime proof
      // Priority: 1) Explicit failure, 2) Runtime success, 3) ENV check fallback
      if (exchangeDecryptionFailed) {
        // Explicit decryption failure - MUST set to FAIL
        // CRITICAL: Provide clear instructions to user
        const errorMessage = exchangeDecryptionError || 'invalid ENCRYPTION_SECRET';
        const userInstructions = 'Please re-enter your exchange API keys. The ENCRYPTION_SECRET used to encrypt your keys does not match the current backend ENCRYPTION_SECRET.';
        diagnostics.systemChecks.encryptionSecretConfigured = {
          status: 'FAIL',
          message: `❌ Exchange API key decryption failed - ${errorMessage}. ${userInstructions}`,
          value: false,
          keyHash: encryptionKeyHash,
          runtimeProof: false,
          userAction: 'Re-enter exchange API keys in Settings',
          technicalDetails: 'ENCRYPTION_SECRET mismatch - keys were encrypted with a different secret than the current backend secret'
        };
      } else if (runtimeDecryptionSucceeded) {
        // Runtime decryption succeeded - MUST set to PASS (no fallback)
        diagnostics.systemChecks.encryptionSecretConfigured = {
          status: 'PASS',
          message: '✅ Encryption working (runtime proof: exchange connector resolved successfully)',
          value: true,
          keyHash: encryptionKeyHash,
          runtimeProof: true,
        };
      } else {
        // Only use ENV check as fallback if runtime proof doesn't exist and no explicit failure
        diagnostics.systemChecks.encryptionSecretConfigured = {
          status: encryptionKeySet ? 'PASS' : 'WARN',
          message: encryptionKeySet
            ? `Encryption secret configured (hash: ${encryptionKeyHash})`
            : '⚠️ Warning: ENCRYPTION_KEY/ENCRYPTION_SECRET env var not detected, but runtime decryption may still work',
          value: encryptionKeySet,
          keyHash: encryptionKeyHash,
          runtimeProof: false,
        };
      }

      // CRITICAL: Check Firestore exchangeStatus FIRST - no runtime overrides
      let exchangeConfigStatus: string | null = null;
      try {
        const db = getFirebaseAdmin().firestore();
        const exchangeConfigDoc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();
        if (exchangeConfigDoc.exists) {
          const exchangeData = exchangeConfigDoc.data();
          exchangeConfigStatus = exchangeData?.exchangeStatus || null;

          // If Firestore shows INVALID_KEYS, that's the final verdict - no runtime checks
          if (exchangeConfigStatus === 'INVALID_KEYS') {
            exchangeDecryptionFailed = true;
            exchangeDecryptionError = 'EXCHANGE_KEY_DECRYPTION_FAILED: Exchange API keys are invalid or encrypted with an old secret. Please reconnect your exchange.';

            diagnostics.systemChecks.exchangeConnected = {
              status: 'BLOCKED',
              message: 'Encrypted API keys are invalid. Please reconnect.',
              value: false,
              exchangeName: null,
              decryptionFailed: true,
              userAction: 'Reconnect exchange in Settings',
              technicalDetails: 'ENCRYPTION_SECRET mismatch - keys permanently unreadable'
            };
          }
        }
      } catch (statusCheckErr: any) {
        logger.warn({ uid, error: statusCheckErr.message }, 'Error checking exchange status from Firestore');
      }

      // Only do runtime decryption checks if Firestore doesn't show INVALID_KEYS
      if (!exchangeDecryptionFailed && !exchangeResolved) {
        try {
          const db = getFirebaseAdmin().firestore();
          const exchangeConfigDoc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();
          if (exchangeConfigDoc.exists && exchangeConfigDoc.data()?.apiKeyEncrypted) {
            // Exchange config exists but resolveExchangeConnector returned null
            // This likely means decryption failed - try to decrypt to confirm
            try {
              const { decryptOrThrow } = await import('../services/keyManager');
              const testDecrypt = decryptOrThrow(exchangeConfigDoc.data()!.apiKeyEncrypted, 'API key');
              // If we get here, decryption worked - something else is wrong
              logger.warn({ uid }, 'Exchange config exists and decryption works, but connector resolution failed');
            } catch (decryptTestErr: any) {
              // Decryption failed - this is the root cause
              exchangeDecryptionFailed = true;
              exchangeDecryptionError = 'EXCHANGE_KEY_DECRYPTION_FAILED: Failed to decrypt exchange API keys - invalid ENCRYPTION_SECRET. Please re-enter your exchange API keys.';
              runtimeDecryptionSucceeded = false; // Override any previous success

              // CRITICAL: Persist INVALID_KEYS status to Firestore for recovery logic
              try {
                await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').update({
                  exchangeStatus: 'INVALID_KEYS',
                  decryptionFailureReason: exchangeDecryptionError,
                  decryptionFailureTimestamp: admin.firestore.FieldValue.serverTimestamp()
                });
                logger.warn({ uid }, 'Marked exchange keys as INVALID_KEYS due to decryption failure');

                // PHASE 3: One-time cleanup - clear encrypted keys to force reconnection
                const { clearInvalidExchangeKeys } = await import('../services/firestoreAdapter');
                await clearInvalidExchangeKeys(uid);
              } catch (updateErr: any) {
                logger.error({ uid, error: updateErr.message }, 'Failed to persist INVALID_KEYS status and clear keys');
              }

              // FORCE update encryptionSecretConfigured to FAIL
              diagnostics.systemChecks.encryptionSecretConfigured = {
                status: 'FAIL',
                message: `Exchange API key decryption failed - ${exchangeDecryptionError}`,
                value: false,
                keyHash: diagnostics.systemChecks.encryptionSecretConfigured?.keyHash || encryptionKeyHash,
                runtimeProof: false,
              };
              logger.error({ uid, error: decryptTestErr.message }, 'Exchange config exists but decryption failed - invalid ENCRYPTION_SECRET');
            }
          }
        } catch (checkErr: any) {
          logger.warn({ uid, error: checkErr.message }, 'Error checking exchange config');
        }
      }

      // Auto-trade enabled
      const autoTradeEnabled = config.autoTradeEnabled || false;
      diagnostics.systemChecks.autoTradeEnabled = {
        status: autoTradeEnabled ? 'PASS' : 'FAIL',
        message: autoTradeEnabled ? 'Auto-trade is enabled' : 'Auto-trade is disabled',
        value: autoTradeEnabled,
      };

      // Exchange connected - check decryption first
      // NOTE: If exchangeStatus === 'INVALID_KEYS', diagnostics already set above
      if (exchangeDecryptionFailed && !diagnostics.systemChecks.exchangeConnected) {
        const errorMessage = exchangeDecryptionError || 'invalid ENCRYPTION_SECRET';
        diagnostics.systemChecks.exchangeConnected = {
          status: 'BLOCKED',
          message: 'Encrypted API keys are invalid. Please reconnect.',
          value: false,
          exchangeName: null,
          decryptionFailed: true,
          userAction: 'Reconnect exchange in Settings',
          technicalDetails: 'ENCRYPTION_SECRET mismatch - keys permanently unreadable'
        };
      } else if (!exchangeDecryptionFailed) {
        const exchangeConnected = !!exchangeResolved;
        const exchangeName = exchangeResolved?.exchange || 'None';
        diagnostics.systemChecks.exchangeConnected = {
          status: exchangeConnected ? 'PASS' : 'FAIL',
          message: exchangeConnected ? `Exchange connected: ${exchangeName}` : 'No exchange connected',
          value: exchangeConnected,
          exchangeName: exchangeName || null,
        };
      }

      // Futures trading enabled (check if exchange supports futures)
      // CRITICAL: Skip exchange checks if decryption failed
      let futuresEnabled = false;
      let apiPermissionsValid = false;
      if (exchangeDecryptionFailed) {
        // Cannot check futures/API permissions if decryption failed
        futuresEnabled = false;
        apiPermissionsValid = false;
      } else if (exchangeResolved?.connector) {
        try {
          // Check if connector has futures support
          if (typeof exchangeResolved.connector.getAccount === 'function') {
            const accountInfo = await exchangeResolved.connector.getAccount();
            // Check if account has futures wallet or futures trading capability
            futuresEnabled = !!(accountInfo.balances || accountInfo.futuresBalances);
          }
          // Check API permissions
          if (typeof exchangeResolved.connector.validateApiKey === 'function') {
            const validation = await exchangeResolved.connector.validateApiKey();
            apiPermissionsValid = validation.valid && validation.canTrade;
          } else {
            // If no validation method, assume valid if we can get account
            apiPermissionsValid = true;
          }
        } catch (err: any) {
          logger.warn({ uid, error: err.message }, 'Error checking futures/API permissions');
        }
      }

      // NOTE: futuresTradingEnabled will be updated after wallet checks complete
      // to use runtime proof from futures balance fetch
      diagnostics.systemChecks.futuresTradingEnabled = {
        status: exchangeDecryptionFailed ? 'FAIL' : (futuresEnabled ? 'PASS' : 'FAIL'),
        message: exchangeDecryptionFailed
          ? 'Cannot check - exchange key decryption failed'
          : futuresEnabled ? 'Futures trading available' : 'Futures trading not available or not detected',
        value: futuresEnabled,
      };

      diagnostics.systemChecks.apiPermissionsValid = {
        status: exchangeDecryptionFailed ? 'FAIL' : (apiPermissionsValid ? 'PASS' : 'FAIL'),
        message: exchangeDecryptionFailed
          ? 'Cannot check - exchange key decryption failed'
          : apiPermissionsValid ? 'API permissions valid' : 'API permissions invalid or insufficient',
        value: apiPermissionsValid,
      };

      // ============================================
      // 2. WALLET & CAPITAL CHECKS
      // ============================================
      // CRITICAL: Use the SAME balance fetch logic as executeTrade and Real Exchange Balance
      // For Bitget, use getFuturesBalance() to get USDT-M Futures balance
      // For other exchanges, check getAccount() for futures balance
      // CRITICAL: Skip balance checks if decryption failed
      let futuresWalletDetected = false;
      let futuresBalanceFetchSucceeded = false; // Declare at function scope for guard access
      let freeBalance = 0;
      let totalBalance = 0;
      const minRequiredBalance = 10; // Minimum 10 USDT

      if (exchangeDecryptionFailed) {
        // Cannot fetch balance if decryption failed
        futuresWalletDetected = false;
        futuresBalanceFetchSucceeded = false;
        freeBalance = 0;
        totalBalance = 0;
        logger.warn({ uid }, 'Skipping balance check - exchange key decryption failed');
      } else if (exchangeResolved?.connector) {
        let futuresBalanceError: string | null = null;

        try {
          // CRITICAL: ALWAYS use getFuturesBalance() if available - NEVER fall back to spot
          if (typeof exchangeResolved.connector.getFuturesBalance === 'function') {
            try {
              const futuresBalance = await exchangeResolved.connector.getFuturesBalance();
              // CRITICAL: If API call succeeds, futures wallet is detected (even if balance is 0)
              futuresWalletDetected = true;
              futuresBalanceFetchSucceeded = true;
              freeBalance = futuresBalance.availableBalance || 0;
              totalBalance = futuresBalance.totalBalance || futuresBalance.availableBalance || 0;
              logger.info({
                uid,
                exchange: exchangeResolved.exchange,
                freeBalance,
                totalBalance,
                marketType: futuresBalance.marketType
              }, '✅ USDT-M Futures balance fetched successfully');
            } catch (futuresErr: any) {
              futuresBalanceError = futuresErr.message || 'Unknown error';
              // CRITICAL: Check if error is due to decryption failure
              if (futuresErr.message?.includes('EXCHANGE_KEY_DECRYPTION_FAILED') ||
                futuresErr.message?.includes('empty') ||
                futuresErr.message?.includes('decryption failed')) {
                // This is a decryption failure - mark it and update encryptionSecretConfigured
                exchangeDecryptionFailed = true;
                exchangeDecryptionError = futuresErr.message || 'EXCHANGE_KEY_DECRYPTION_FAILED: Failed to decrypt exchange API keys';
                runtimeDecryptionSucceeded = false; // Override any previous success
                // FORCE update encryptionSecretConfigured to FAIL
                diagnostics.systemChecks.encryptionSecretConfigured = {
                  status: 'FAIL',
                  message: `Exchange API key decryption failed - ${exchangeDecryptionError}`,
                  value: false,
                  keyHash: diagnostics.systemChecks.encryptionSecretConfigured?.keyHash || encryptionKeyHash,
                  runtimeProof: false,
                };
                logger.error({ uid, error: futuresErr.message }, '❌ getFuturesBalance() failed due to decryption error');
                // Don't set futuresWalletDetected = false here - let decryption error handling take precedence
              } else {
                logger.warn({ uid, error: futuresErr.message }, '❌ getFuturesBalance() failed');
              }
            }
          } else {
            // Exchange doesn't support getFuturesBalance() - try getAccount() for futures data
            logger.info({ uid, exchange: exchangeResolved.exchange }, 'Exchange does not support getFuturesBalance(), checking getAccount() for futures data');

            if (typeof exchangeResolved.connector.getAccount === 'function') {
              const accountInfo = await exchangeResolved.connector.getAccount();

              // Check for futures balance in account response
              if (accountInfo.futuresBalances && Array.isArray(accountInfo.futuresBalances)) {
                futuresWalletDetected = true;
                futuresBalanceFetchSucceeded = true;
                const usdtBalance = accountInfo.futuresBalances.find((b: any) =>
                  b.asset === 'USDT' || b.asset === 'USDT'
                );
                if (usdtBalance) {
                  freeBalance = parseFloat(usdtBalance.free || usdtBalance.available || '0');
                  totalBalance = parseFloat(usdtBalance.total || (usdtBalance.free || '0') + (usdtBalance.locked || '0'));
                }
              }
              // Check for Bitget futures format in data field
              else if (accountInfo.data && Array.isArray(accountInfo.data)) {
                const usdtAccount = accountInfo.data.find((acc: any) => acc.marginCoin === 'USDT' && acc.productType === 'USDT-FUTURES');
                if (usdtAccount) {
                  futuresWalletDetected = true;
                  futuresBalanceFetchSucceeded = true;
                  freeBalance = parseFloat(usdtAccount.available || '0');
                  totalBalance = parseFloat(usdtAccount.equity || usdtAccount.available || '0');
                }
              }
              // Check for direct equity/available fields (futures balance directly)
              else if (accountInfo.totalEquity !== undefined) {
                // If totalEquity exists (even if 0), assume it's futures balance
                futuresWalletDetected = true;
                futuresBalanceFetchSucceeded = true;
                totalBalance = parseFloat(accountInfo.totalEquity.toString());
                freeBalance = parseFloat(accountInfo.available || accountInfo.availableBalance || accountInfo.totalEquity.toString());
              } else if (accountInfo.equity !== undefined) {
                futuresWalletDetected = true;
                futuresBalanceFetchSucceeded = true;
                totalBalance = parseFloat(accountInfo.equity.toString());
                freeBalance = parseFloat(accountInfo.available || accountInfo.availableBalance || accountInfo.equity.toString());
              }
            }
          }

          // CRITICAL: If futures balance fetch succeeded, that's proof decryption worked
          // FORCE runtimeDecryptionSucceeded = true and FORCE encryptionSecretConfigured = PASS
          if (futuresWalletDetected || futuresBalanceFetchSucceeded) {
            runtimeDecryptionSucceeded = true;
            // FORCE update the diagnostic status to reflect runtime proof
            // This MUST override any previous status
            diagnostics.systemChecks.encryptionSecretConfigured = {
              status: 'PASS',
              message: '✅ Encryption working (runtime proof: USDT-M Futures balance fetched successfully)',
              value: true,
              keyHash: diagnostics.systemChecks.encryptionSecretConfigured?.keyHash || encryptionKeyHash,
              runtimeProof: true,
            };
            logger.info({ uid, exchange: exchangeResolved.exchange }, '✅ Runtime decryption proof: Futures balance fetch succeeded');
          }

          // CRITICAL: If futures balance fetch failed, log the reason
          if (!futuresBalanceFetchSucceeded && !futuresWalletDetected) {
            // Check if failure was due to decryption error
            if (futuresBalanceError?.includes('EXCHANGE_KEY_DECRYPTION_FAILED') ||
              futuresBalanceError?.includes('empty') ||
              futuresBalanceError?.includes('decryption failed')) {
              // Decryption failure - this will be handled by exchangeDecryptionFailed check
              logger.error({
                uid,
                exchange: exchangeResolved.exchange,
                error: futuresBalanceError
              }, '❌ USDT-M Futures balance fetch failed due to decryption error');
            } else {
              logger.warn({
                uid,
                exchange: exchangeResolved.exchange,
                error: futuresBalanceError
              }, '❌ USDT-M Futures balance fetch failed - no futures balance available');
            }
          }
        } catch (err: any) {
          logger.warn({ uid, error: err.message }, 'Error checking wallet balance');
        }
      }

      // CRITICAL: Update futuresTradingEnabled with runtime proof from wallet checks
      // If futures balance fetch succeeded, futures trading MUST be enabled
      const futuresTradingConfirmed = futuresWalletDetected || futuresBalanceFetchSucceeded;
      diagnostics.systemChecks.futuresTradingEnabled = {
        status: exchangeDecryptionFailed ? 'FAIL' : (futuresTradingConfirmed ? 'PASS' : (futuresEnabled ? 'PASS' : 'FAIL')),
        message: exchangeDecryptionFailed
          ? 'Cannot check - exchange key decryption failed'
          : futuresTradingConfirmed
            ? 'Futures trading available (runtime proof: USDT-M Futures balance fetched)'
            : futuresEnabled
              ? 'Futures trading available'
              : 'Futures trading not available or not detected',
        value: futuresTradingConfirmed || futuresEnabled,
      };

      diagnostics.walletChecks.futuresWalletDetected = {
        status: exchangeDecryptionFailed ? 'FAIL' : (futuresWalletDetected ? 'PASS' : 'FAIL'),
        message: exchangeDecryptionFailed
          ? 'Cannot check - exchange key decryption failed'
          : futuresWalletDetected
            ? 'USDT-M Futures wallet detected'
            : 'USDT-M Futures balance fetch failed - no futures wallet available',
        value: futuresWalletDetected,
      };

      diagnostics.walletChecks.freeBalanceAvailable = {
        status: exchangeDecryptionFailed ? 'FAIL' : (futuresWalletDetected && freeBalance >= minRequiredBalance ? 'PASS' : 'FAIL'),
        message: exchangeDecryptionFailed
          ? 'Cannot check - exchange key decryption failed'
          : !futuresWalletDetected
            ? 'USDT-M Futures balance fetch failed'
            : freeBalance >= minRequiredBalance
              ? `USDT-M Futures balance: ${freeBalance.toFixed(2)} USDT`
              : `Insufficient USDT-M Futures balance: ${freeBalance.toFixed(2)} USDT (minimum: ${minRequiredBalance} USDT)`,
        value: freeBalance,
        minRequired: minRequiredBalance,
      };

      diagnostics.walletChecks.minimumBalanceMet = {
        status: exchangeDecryptionFailed ? 'FAIL' : (futuresWalletDetected && freeBalance >= minRequiredBalance ? 'PASS' : 'FAIL'),
        message: exchangeDecryptionFailed
          ? 'Cannot check - exchange key decryption failed'
          : !futuresWalletDetected
            ? 'USDT-M Futures balance fetch failed'
            : freeBalance >= minRequiredBalance
              ? `USDT-M Futures balance meets minimum (${freeBalance.toFixed(2)} >= ${minRequiredBalance})`
              : `USDT-M Futures balance below minimum (${freeBalance.toFixed(2)} < ${minRequiredBalance})`,
        value: freeBalance,
        threshold: minRequiredBalance,
      };

      // ============================================
      // 3. EXECUTION LOOP & SCHEDULER CHECKS (CRITICAL)
      // ============================================
      // These checks determine if auto-trade can actually execute
      let schedulerRunning = false;
      let userJobScheduled = false;
      let userJobState: any = null;
      let disableAutoTradeEnv = false;
      let backgroundTasksEnabled = true;
      let lastResearchRunAge: number | null = null;

      try {
        // Check DISABLE_AUTOTRADE env flag
        disableAutoTradeEnv = process.env.DISABLE_AUTOTRADE === 'true';

        // Check shouldRunBackgroundTasks()
        const { shouldRunBackgroundTasks } = await import('../utils/safeBackgroundRunner');
        backgroundTasksEnabled = shouldRunBackgroundTasks();

        // Check scheduler status
        const { backgroundResearchScheduler } = await import('../services/backgroundResearchScheduler');
        schedulerRunning = (backgroundResearchScheduler as any).isRunning || false;
        userJobState = (backgroundResearchScheduler as any).getUserJobState(uid);
        userJobScheduled = !!userJobState;

        // Calculate last research run age
        if (userJobState?.lastRunAt) {
          lastResearchRunAge = Math.floor((Date.now() - new Date(userJobState.lastRunAt).getTime()) / 60000); // minutes
        }
      } catch (err: any) {
        logger.warn({ uid, error: err.message }, 'Error checking background research scheduler');
      }

      diagnostics.systemChecks.disableAutoTradeEnv = {
        status: !disableAutoTradeEnv ? 'PASS' : 'FAIL',
        message: disableAutoTradeEnv
          ? 'DISABLE_AUTOTRADE env flag is set to true - auto-trade is globally disabled'
          : 'DISABLE_AUTOTRADE env flag is not set',
        value: !disableAutoTradeEnv,
      };

      diagnostics.systemChecks.backgroundTasksEnabled = {
        status: backgroundTasksEnabled ? 'PASS' : 'FAIL',
        message: backgroundTasksEnabled
          ? 'Background tasks are enabled (event loop healthy)'
          : 'Background tasks are paused (event loop lag detected)',
        value: backgroundTasksEnabled,
      };

      diagnostics.systemChecks.schedulerRunning = {
        status: schedulerRunning ? 'PASS' : 'FAIL',
        message: schedulerRunning
          ? 'Background research scheduler is running'
          : 'Background research scheduler is NOT running - auto-trade execution loop cannot start',
        value: schedulerRunning,
      };

      diagnostics.systemChecks.userJobScheduled = {
        status: userJobScheduled ? 'PASS' : 'FAIL',
        message: userJobScheduled
          ? `User job scheduled (last run: ${userJobState?.lastRunAt ? `${lastResearchRunAge} minutes ago` : 'never'})`
          : 'User job NOT scheduled in background research scheduler - enabling auto-trade should trigger job registration',
        value: userJobScheduled,
        lastRunAt: userJobState?.lastRunAt ? new Date(userJobState.lastRunAt).toISOString() : null,
        nextRunAt: userJobState?.nextRunAt ? new Date(userJobState.nextRunAt).toISOString() : null,
        lastRunAgeMinutes: lastResearchRunAge,
      };

      // Check if background research is enabled
      const bgResearchSettings = await firestoreAdapter.getBackgroundResearchSettings(uid);
      const bgResearchEnabled = bgResearchSettings?.backgroundResearchEnabled || false;
      diagnostics.systemChecks.backgroundResearchEnabled = {
        status: bgResearchEnabled ? 'PASS' : 'FAIL',
        message: bgResearchEnabled ? 'Background research is enabled' : 'Background research is disabled',
        value: bgResearchEnabled,
      };

      // Check research API keys
      // CRITICAL: This check is for research keys configuration only, NOT encryption status
      // Provider/background decryption failures are isolated and do NOT affect auto-trade diagnostic
      let hasResearchKeys = false;
      try {
        const { getUserIntegrations } = await import('../routes/integrations');
        const integrationResult = await getUserIntegrations(uid);
        const integrations = (integrationResult as any).providerConfig;
        hasResearchKeys = (integrations?.marketData && Object.keys(integrations.marketData).length > 0) ||
          (integrations?.metadata && Object.keys(integrations.metadata).length > 0);
      } catch (integrationErr: any) {
        // Provider config errors are isolated - log but don't affect diagnostic
        logger.warn({ uid, error: integrationErr.message }, 'Error checking research keys - isolated from exchange encryption status');
        hasResearchKeys = false;
      }
      diagnostics.systemChecks.researchKeysConfigured = {
        status: hasResearchKeys ? 'PASS' : 'FAIL',
        message: hasResearchKeys ? 'Research API keys are configured' : 'No research API keys configured',
        value: hasResearchKeys,
      };

      // ============================================
      // 4. STRATEGY & SIGNAL CHECKS
      // ============================================
      // Get latest research history (more reliable than logs)
      const tradingSettings = await AutoTradeEngine.getTradingSettings(uid);
      const accuracyThreshold = tradingSettings.accuracyTrigger?.min || 75;

      // Get latest research history
      let latestResearch: any = null;
      try {
        const researchHistory = await firestoreAdapter.getResearchHistory(uid, 1);
        latestResearch = researchHistory && researchHistory.length > 0 ? researchHistory[0] : null;
      } catch (err: any) {
        logger.warn({ uid, error: err.message }, 'Error fetching research history');
      }

      // Get latest activity logs as fallback
      const recentLogs = await firestoreAdapter.getAutoTradeLogs(uid, 10);
      const lastSignalLog = recentLogs?.find((l: any) =>
        l.eventType === 'TRADE_SKIPPED' ||
        l.eventType === 'TRADE_REJECTED' ||
        l.eventType === 'TRADE_EXECUTED' ||
        l.eventType === 'TRADE_CONFIRMATION_REQUIRED'
      );

      let signalGenerated = false;
      let signalType: 'BUY' | 'SELL' | 'HOLD' | null = null;
      let signalAccuracy = 0;
      let accuracyPassed = false;
      let lastResearchTime: string | null = null;

      // Prefer research history over logs
      if (latestResearch) {
        signalGenerated = true;
        signalType = latestResearch.signal || 'HOLD';
        signalAccuracy = latestResearch.accuracy || 0;
        accuracyPassed = signalAccuracy >= accuracyThreshold;
        lastResearchTime = latestResearch.timestamp ? new Date(latestResearch.timestamp).toISOString() : null;
      } else if (lastSignalLog?.data?.signal) {
        signalGenerated = true;
        signalType = lastSignalLog.data.signal.signal || lastSignalLog.data.signal;
        signalAccuracy = lastSignalLog.data.signal.accuracy || lastSignalLog.data.accuracy || 0;
        accuracyPassed = signalAccuracy >= accuracyThreshold;
        lastResearchTime = lastSignalLog.timestamp ? new Date(lastSignalLog.timestamp).toISOString() : null;
      }

      diagnostics.strategyChecks.signalGenerated = {
        status: signalGenerated ? 'PASS' : 'FAIL',
        message: signalGenerated
          ? `Signal generated: ${signalType} (${lastResearchTime ? `at ${new Date(lastResearchTime).toLocaleString()}` : 'recent'})`
          : 'No recent signal generated - research cycle may not be running',
        value: signalGenerated,
        signalType: signalType,
        lastResearchTime: lastResearchTime,
      };

      diagnostics.strategyChecks.accuracyTrigger = {
        status: accuracyPassed ? 'PASS' : 'FAIL',
        message: accuracyPassed
          ? `Accuracy passed: ${signalAccuracy.toFixed(1)}% >= ${accuracyThreshold}%`
          : signalGenerated
            ? `Accuracy failed: ${signalAccuracy.toFixed(1)}% < ${accuracyThreshold}% (threshold: ${accuracyThreshold}%)`
            : 'No signal to check accuracy',
        value: signalAccuracy,
        threshold: accuracyThreshold,
        passed: accuracyPassed,
      };

      // CRITICAL: Research Cycle Active diagnostic
      // Rule: PASS if scheduler is running AND user job is scheduled (regardless of accuracy)
      // STALLED only if scheduler not running OR last run > 2× configured interval
      // Accuracy failures must NOT affect research cycle status
      let researchAgeMinutes: number | null = null;
      let researchCycleActive = false;
      let researchStalled = false;

      // Get configured frequency to calculate 2× interval threshold
      const configuredFrequencyMinutes = bgResearchSettings?.researchFrequencyMinutes || 5;
      const stalledThresholdMinutes = configuredFrequencyMinutes * 2; // 2× configured interval

      if (lastResearchTime) {
        researchAgeMinutes = Math.floor((Date.now() - new Date(lastResearchTime).getTime()) / 60000);
      } else if (userJobState?.lastRunAt) {
        // Fallback to scheduler state if no research history
        researchAgeMinutes = lastResearchRunAge;
      }

      // CRITICAL: Research cycle is ACTIVE if scheduler is running AND user job is scheduled
      // This is independent of accuracy or research results
      researchCycleActive = schedulerRunning && userJobScheduled;

      // CRITICAL: STALLED only if:
      // 1. Scheduler is not running, OR
      // 2. Last run time exceeds 2× configured interval
      researchStalled = !schedulerRunning ||
        (researchAgeMinutes !== null && researchAgeMinutes > stalledThresholdMinutes);

      diagnostics.strategyChecks.researchCycleActive = {
        status: researchCycleActive ? 'PASS' : 'FAIL',
        message: researchCycleActive
          ? `Research cycle active (scheduler running, user job scheduled${researchAgeMinutes !== null ? `, last run ${researchAgeMinutes} minutes ago` : ''})`
          : researchStalled
            ? `Research cycle STALLED${!schedulerRunning ? ' - scheduler not running' : ''}${researchAgeMinutes !== null && researchAgeMinutes > stalledThresholdMinutes ? ` (last run ${researchAgeMinutes} minutes ago, threshold: ${stalledThresholdMinutes} minutes)` : ''}`
            : !schedulerRunning
              ? 'Research cycle inactive - scheduler not running'
              : !userJobScheduled
                ? 'Research cycle inactive - user job not scheduled'
                : 'Research cycle status unknown',
        value: researchCycleActive,
        lastResearchAgeMinutes: researchAgeMinutes,
        isStalled: researchStalled,
        schedulerRunning: schedulerRunning,
        userJobScheduled: userJobScheduled,
        configuredFrequencyMinutes: configuredFrequencyMinutes,
        stalledThresholdMinutes: stalledThresholdMinutes,
      };

      // ============================================
      // 5. SAFETY & RULE CHECKS
      // ============================================
      const stats = config.stats || { dailyTrades: 0, dailyPnL: 0 };
      const equity = config.equitySnapshot || freeBalance || 1000;
      const maxDailyLossPct = tradingSettings.maxDailyLossPct || 5;
      const maxDailyLossAmount = equity * (maxDailyLossPct / 100);
      const maxTradesPerDay = tradingSettings.maxTradesPerDay || 5;
      const cooldownSeconds = config.cooldownSeconds || 30;
      const cooldownUntil = config.cooldownUntil;

      // Risk limits
      const dailyLossExceeded = stats.dailyPnL < 0 && Math.abs(stats.dailyPnL) >= maxDailyLossAmount;
      diagnostics.safetyChecks.riskLimits = {
        status: !dailyLossExceeded ? 'PASS' : 'FAIL',
        message: !dailyLossExceeded
          ? `Daily loss within limits (${stats.dailyPnL.toFixed(2)} < ${maxDailyLossAmount.toFixed(2)})`
          : `Daily loss limit exceeded (${Math.abs(stats.dailyPnL).toFixed(2)} >= ${maxDailyLossAmount.toFixed(2)})`,
        value: stats.dailyPnL,
        limit: maxDailyLossAmount,
      };

      // Cooldown
      const cooldownActive = cooldownUntil && new Date() < new Date(cooldownUntil);
      diagnostics.safetyChecks.cooldown = {
        status: !cooldownActive ? 'PASS' : 'FAIL',
        message: !cooldownActive
          ? 'No cooldown active'
          : `Cooldown active until ${new Date(cooldownUntil).toISOString()}`,
        value: cooldownActive,
        cooldownUntil: cooldownUntil ? new Date(cooldownUntil).toISOString() : null,
      };

      // Daily trades limit
      const dailyTradesExceeded = stats.dailyTrades >= maxTradesPerDay;
      diagnostics.safetyChecks.dailyTradesLimit = {
        status: !dailyTradesExceeded ? 'PASS' : 'FAIL',
        message: !dailyTradesExceeded
          ? `Daily trades within limit (${stats.dailyTrades}/${maxTradesPerDay})`
          : `Daily trades limit reached (${stats.dailyTrades}/${maxTradesPerDay})`,
        value: stats.dailyTrades,
        limit: maxTradesPerDay,
      };

      // Get engine status (includes circuit breaker, active trades, etc.)
      const engineStatus = await autoTradeEngine.getStatus(uid);

      // Circuit breaker
      const circuitBreakerActive = engineStatus.circuitBreaker || false;
      diagnostics.safetyChecks.circuitBreaker = {
        status: !circuitBreakerActive ? 'PASS' : 'FAIL',
        message: !circuitBreakerActive
          ? 'Circuit breaker not active'
          : 'Circuit breaker active (daily loss limit exceeded)',
        value: circuitBreakerActive,
      };

      // Manual override
      const manualOverride = engineStatus.manualOverride || false;
      diagnostics.safetyChecks.manualOverride = {
        status: !manualOverride ? 'PASS' : 'FAIL',
        message: !manualOverride
          ? 'No manual override active'
          : 'Manual override active (trading paused by user)',
        value: manualOverride,
      };

      // Max concurrent trades
      const activeTradesCount = engineStatus.activeTrades || 0;
      const maxConcurrentTrades = config.maxConcurrentTrades || 3;
      const concurrentTradesExceeded = activeTradesCount >= maxConcurrentTrades;
      diagnostics.safetyChecks.concurrentTradesLimit = {
        status: !concurrentTradesExceeded ? 'PASS' : 'FAIL',
        message: !concurrentTradesExceeded
          ? `Concurrent trades within limit (${activeTradesCount}/${maxConcurrentTrades})`
          : `Concurrent trades limit reached (${activeTradesCount}/${maxConcurrentTrades})`,
        value: activeTradesCount,
        limit: maxConcurrentTrades,
      };

      // ============================================
      // DETERMINE PRIMARY BLOCKING REASON
      // ============================================
      const blockingReasons: string[] = [];

      // PRIORITY ORDER: Execution blockers first, then signal/accuracy, then balance
      // This ensures we don't blame balance if the loop isn't running

      // CRITICAL: Runtime decryption failures (HIGHEST PRIORITY)
      // RUNTIME PROOF: If exchangeResolved is not null OR futures balance fetched, decryption worked regardless of ENV check
      // ISOLATION: Only exchange decryption failures affect auto-trade diagnostic
      // Provider/background decryption failures are completely isolated and do NOT affect this check
      if (exchangeDecryptionFailed) {
        blockingReasons.push(`Exchange API key decryption failed - ${exchangeDecryptionError || 'invalid ENCRYPTION_SECRET. Please re-enter your exchange API keys.'}`);
      }
      // ENV check is informational only - if runtime decryption succeeded, NEVER block
      // RUNTIME PROOF OVERRIDES ENV CHECK: If runtime decryption succeeded, encryption is working
      if (!runtimeDecryptionSucceeded && !encryptionKeySet && !exchangeDecryptionFailed) {
        // This is a warning, not a blocker - log it but don't add to blocking reasons
        // CRITICAL: Do NOT add to blockingReasons - runtime behavior is the source of truth
        logger.warn({ uid }, 'ENCRYPTION_KEY/ENCRYPTION_SECRET env var not detected, but no runtime decryption proof available');
      }
      // NOTE: Absolute guard to remove ENV-related blocking reasons is placed AFTER all blocking reasons are added
      // See code before primaryBlockingReason assignment (around line 773)

      // CRITICAL: Execution loop blockers
      if (disableAutoTradeEnv) {
        blockingReasons.push('DISABLE_AUTOTRADE env flag is set - auto-trade is globally disabled');
      }
      if (!backgroundTasksEnabled) {
        blockingReasons.push('Background tasks are paused (event loop lag detected)');
      }
      if (!schedulerRunning) {
        blockingReasons.push('Background research scheduler is NOT running - auto-trade execution loop cannot start');
      }
      if (!bgResearchEnabled) {
        blockingReasons.push('Background research is disabled - execution loop will not run');
      }
      if (!userJobScheduled) {
        blockingReasons.push('User job NOT scheduled in scheduler - enabling auto-trade should trigger registration');
      }
      if (!hasResearchKeys) {
        blockingReasons.push('No research API keys configured - research cannot run');
      }

      // EXECUTION PATH: Exchange and permissions (only if decryption succeeded)
      if (!exchangeDecryptionFailed) {
        const exchangeConnected = !!exchangeResolved;
        if (!exchangeConnected) {
          blockingReasons.push('Exchange not connected');
        }
        if (!apiPermissionsValid && exchangeConnected) {
          blockingReasons.push('API permissions invalid');
        }
      }

      // EXECUTION PATH: Research cycle status
      if (researchStalled) {
        blockingReasons.push(`Research cycle STALLED (last run ${researchAgeMinutes} minutes ago) - execution loop may not be running`);
      }
      if (!signalGenerated && !researchStalled) {
        blockingReasons.push('No signal generated - research cycle may not be running or no valid signals found');
      }
      if (signalGenerated && !accuracyPassed) {
        blockingReasons.push(`Accuracy below threshold (${signalAccuracy.toFixed(1)}% < ${accuracyThreshold}%)`);
      }

      // BALANCE: Only check if execution path is clear AND futures balance was fetched
      // Don't blame balance if the loop isn't running or if futures balance fetch failed
      if (schedulerRunning && userJobScheduled && bgResearchEnabled && !researchStalled && futuresWalletDetected) {
        if (freeBalance < minRequiredBalance) {
          blockingReasons.push(`Insufficient USDT-M Futures balance (${freeBalance.toFixed(2)} < ${minRequiredBalance} USDT)`);
        }
      } else if (!futuresWalletDetected && !exchangeDecryptionFailed) {
        // If futures wallet not detected (and decryption didn't fail), that's a blocking reason
        blockingReasons.push('USDT-M Futures balance fetch failed - no futures wallet available');
      }
      if (dailyLossExceeded) {
        blockingReasons.push('Daily loss limit exceeded');
      }
      if (cooldownActive) {
        blockingReasons.push('Cooldown active');
      }
      if (dailyTradesExceeded) {
        blockingReasons.push('Daily trades limit reached');
      }
      if (circuitBreakerActive) {
        blockingReasons.push('Circuit breaker active');
      }
      if (manualOverride) {
        blockingReasons.push('Manual override active');
      }
      if (concurrentTradesExceeded) {
        blockingReasons.push('Concurrent trades limit reached');
      }

      // ABSOLUTE GUARD: If runtime decryption succeeded OR futures balance fetch succeeded,
      // FORCE encryptionSecretConfigured = PASS and remove ALL encryption-related blocking reasons
      // This must happen AFTER all blocking reasons are added but BEFORE primaryBlockingReason is set
      // RUNTIME PROOF OVERRIDES ENV CHECK: If runtime decryption succeeded, encryption is working
      // ISOLATION: Also remove any provider/background decryption-related reasons (they should never be here)
      const runtimeProofExists = runtimeDecryptionSucceeded || futuresWalletDetected || futuresBalanceFetchSucceeded;
      if (runtimeProofExists) {
        // FORCE encryptionSecretConfigured to PASS - runtime proof overrides everything
        diagnostics.systemChecks.encryptionSecretConfigured = {
          status: 'PASS',
          message: diagnostics.systemChecks.encryptionSecretConfigured?.message || '✅ Encryption working (runtime proof confirmed)',
          value: true,
          keyHash: diagnostics.systemChecks.encryptionSecretConfigured?.keyHash || encryptionKeyHash,
          runtimeProof: true,
        };

        // Remove ALL encryption-related blocking reasons - runtime proof overrides everything
        const envRelatedIndices: number[] = [];
        blockingReasons.forEach((reason, index) => {
          const reasonLower = reason.toLowerCase();
          if (reasonLower.includes('encryption_key') ||
            reasonLower.includes('encryption_secret') ||
            reasonLower.includes('env var not set') ||
            reasonLower.includes('cannot decrypt') ||
            reasonLower.includes('decryption failed') ||
            reasonLower.includes('decrypt exchange') ||
            reasonLower.includes('invalid encryption_secret') ||
            (reasonLower.includes('provider') && reasonLower.includes('decrypt')) ||
            (reasonLower.includes('background') && reasonLower.includes('decrypt')) ||
            (reasonLower.includes('integration') && reasonLower.includes('decrypt'))) {
            envRelatedIndices.push(index);
          }
        });
        // Remove in reverse order to maintain indices
        for (let i = envRelatedIndices.length - 1; i >= 0; i--) {
          const removedReason = blockingReasons[envRelatedIndices[i]];
          logger.warn({ uid, removedReason, runtimeProof: { runtimeDecryptionSucceeded, futuresWalletDetected, futuresBalanceFetchSucceeded } }, 'Removed encryption-related blocking reason - runtime proof exists');
          blockingReasons.splice(envRelatedIndices[i], 1);
        }
      }

      diagnostics.primaryBlockingReason = blockingReasons.length > 0 ? blockingReasons[0] : null;

      // Special case: If accuracy and signal passed but trade still blocked
      if (signalGenerated && accuracyPassed && blockingReasons.length > 0) {
        diagnostics.strategyChecks.accuracyAndSignalPassed = {
          status: 'PASS',
          message: 'Accuracy and signal were valid, but execution was blocked',
          blockedBy: blockingReasons[0],
        };
      }

      // ============================================
      // FINAL VERDICT
      // ============================================
      if (!autoTradeEnabled) {
        diagnostics.finalVerdict = 'AUTO-TRADE DISABLED';
      } else if (blockingReasons.length > 0) {
        diagnostics.finalVerdict = `AUTO-TRADE BLOCKED: ${blockingReasons[0]}`;
      } else {
        diagnostics.finalVerdict = 'AUTO-TRADE READY';
      }

      logger.info({ uid, verdict: diagnostics.finalVerdict, duration: Date.now() - startTime }, 'Diagnostic check completed');
      return diagnostics;
    } catch (err: any) {
      logger.error({ err, uid: (request as any).user?.uid }, 'Error running diagnostic check');
      return reply.code(500).send({
        error: 'Diagnostic check failed',
        message: err.message,
      });
    }
  });
  console.log('[AUTO-TRADE ROUTES] /diagnostic-check route registered successfully');

  console.log("[ROUTE READY] GET /api/auto-trade/status");
  console.log("[ROUTE READY] GET /api/auto-trade/config");
  console.log("[ROUTE READY] POST /api/auto-trade/config");
  console.log("[ROUTE READY] POST /api/auto-trade/queue");
  console.log("[ROUTE READY] POST /api/auto-trade/run");
  console.log("[ROUTE READY] POST /api/auto-trade/execute");
  console.log("[ROUTE READY] POST /api/auto-trade/toggle");
  console.log("[ROUTE READY] POST /api/auto-trade/reset-circuit-breaker");
  console.log("[ROUTE READY] GET /api/auto-trade/active-trades");
  console.log("[ROUTE READY] GET /api/auto-trade/activity");
  console.log("[ROUTE READY] GET /api/auto-trade/proposals");
  console.log("[ROUTE READY] GET /api/auto-trade/logs");
  console.log("[ROUTE READY] GET /api/auto-trade/diagnostics");
  console.log("[ROUTE READY] GET /api/auto-trade/diagnostic-check");

  // Decorate with admin auth middleware
  fastify.decorate('adminAuth', adminAuthMiddleware);

  // GET /api/auto-trade/status - Get auto-trade status
  // CRITICAL: PURE & FAST - Only read Firestore directly, NO service calls
  // Must respond within 500ms - NO autoTradeEngine, NO exchangeResolver, NO adapters
  fastify.get('/status', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    console.log("[ROUTE_ENTER] /auto-trade/status PID:", process.pid);

    // HARD TIMEOUT GUARD: Auto-respond 504 after 450ms
    const timeoutId = setTimeout(() => {
      if (!reply.sent) {
        console.error("[ROUTE_TIMEOUT] /auto-trade/status exceeded 450ms");
        reply.code(504).send({ ok: false, reason: 'route_timeout', route: '/auto-trade/status' });
      }
    }, 450);

    try {
      const user = (request as any).user;
      if (!user?.uid) {
        clearTimeout(timeoutId);
        console.log("[ROUTE_EXIT] /auto-trade/status (no uid)", Date.now() - startTime, "ms");
        return reply.code(401).send({ error: 'Authentication required' });
      }

      console.log("[STATUS_OPTIMIZATION] Starting lightweight status check - no API calls or heavy queries");

      // PURE FIRESTORE READ - Direct DB access, no service calls
      const db = getFirebaseAdmin().firestore();

      // Parallel reads with individual 200ms timeouts
      const [configDoc, exchangeDoc, integrationsSnapshot, bgSettingsDoc] = await Promise.all([
        Promise.race([
          db.collection('users').doc(user.uid).collection('autoTradeConfig').doc('current').get(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 200))
        ]),
        Promise.race([
          db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 200))
        ]),
        Promise.race([
          db.collection('users').doc(user.uid).collection('integrations').get(),
          new Promise<any>((resolve) => setTimeout(() => resolve({ empty: true, docs: [] }), 200)) // Default to empty if timeout
        ]),
        Promise.race([
          db.collection('users').doc(user.uid).collection('settings').doc('backgroundResearch').get(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 200))
        ])
      ]);

      // Extract config data (with defaults) - missing config is treated as disabled, NOT forbidden
      const config = configDoc?.exists ? configDoc.data() : {};
      const autoTradeEnabled = config?.autoTradeEnabled ?? false;

      // Extract background research settings for frequency
      const bgSettings = bgSettingsDoc?.exists ? bgSettingsDoc.data() : {};
      const frequencyMinutes = bgSettings?.researchFrequencyMinutes || 5;

      // Extract exchange data and compute connected status
      const exchangeData = exchangeDoc?.exists ? exchangeDoc.data() : null;
      let exchangeConnected = false;
      let exchangeReason = 'No exchange configuration found';

      if (exchangeData) {
        // CRITICAL: Check decryption status/validity
        // UI Consistency goal: Never return true if decryption returns empty string
        const isInvalid = exchangeData.exchangeStatus === 'INVALID_KEYS';
        let decryptedKey = '';

        if (!isInvalid && exchangeData.apiKeyEncrypted) {
          try {
            decryptedKey = decrypt(exchangeData.apiKeyEncrypted);
          } catch (e) {
            decryptedKey = '';
          }
        }

        const hasApiKey = !isInvalid && !!decryptedKey && decryptedKey.trim().length > 0;
        const hasSecret = !!(exchangeData.secretKeyEncrypted || exchangeData.secretEncrypted); // Secret is hard to check without decrypting, but failing API key is enough. 
        const exchange = (exchangeData.exchange || '').toLowerCase();
        const isBitget = exchange === 'bitget';
        const hasPassphrase = isBitget ? !!exchangeData.passphraseEncrypted : true;

        exchangeConnected = hasApiKey && hasSecret && hasPassphrase && ['binance', 'bitget', 'bingx', 'weex'].includes(exchange);

        if (isInvalid || (!hasApiKey && exchangeData.apiKeyEncrypted)) {
          exchangeReason = 'Encrypted API keys are invalid. Please reconnect.';
        } else {
          exchangeReason = exchangeConnected
            ? `${exchangeData.exchange} connected`
            : 'Exchange keys incomplete';
        }
      }

      // Check for usable research providers - LIGHTWEIGHT VERSION
      // Avoid heavy provider validation on every status request
      let hasUsableProviders = false;
      let providerStatusMessage = 'Research providers not checked';

      // Skip expensive provider validation for status endpoint
      // This will be validated by research engine when actually running
      if (integrationsSnapshot && !integrationsSnapshot.empty && integrationsSnapshot.docs.length > 0) {
        hasUsableProviders = true; // Assume configured if any integrations exist
        providerStatusMessage = 'Research providers configured';
      } else {
        providerStatusMessage = 'No research providers configured';
      }

      // LIGHTWEIGHT: Skip expensive API key validation for status endpoint
      // Provider validation happens in research engine when actually running
      // For status endpoint, just check if any integrations exist at all
      const hasAnyIntegrations = integrationsSnapshot && !integrationsSnapshot.empty && integrationsSnapshot.docs.length > 0;

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      console.log("[ROUTE_EXIT] /auto-trade/status", duration, "ms", { exchangeConnected, autoTradeEnabled });

      // FAST RESPONSE - minimal payload
      // CRITICAL: Always return 200 for authenticated users - missing config = enabled: false (not 403)
      return reply.send({
        enabled: autoTradeEnabled,
        autoTradeEnabled,
        frequencyMinutes: autoTradeEnabled ? frequencyMinutes : undefined,
        exchangeConnected,
        exchangeReason,
        exchange: { connected: exchangeConnected },
        isApiConnected: exchangeConnected,
        apiStatus: exchangeConnected ? 'connected' : 'disconnected',
        providersReady: hasUsableProviders, // Use our lightweight check
        providerConfigTimeout: false,
        providerStatus: hasUsableProviders ? 'CONFIGURED' : 'MISSING_PROVIDERS',
        providerMessage: hasUsableProviders ? null : providerStatusMessage,
        diagnostics: { marketDataReady: hasUsableProviders, newsReady: hasUsableProviders },
        config: {
          autoTradeEnabled,
          perTradeRiskPct: config?.perTradeRiskPct || 1,
          maxConcurrentTrades: config?.maxConcurrentTrades || 3,
        },
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("[ROUTE_ERROR] /auto-trade/status", err.message, Date.now() - startTime, "ms");
      // CRITICAL: For authenticated users, NEVER return 403 or 500 - treat errors as disabled state
      // Missing config or Firestore errors should return 200 with enabled: false
      return reply.code(200).send({
        ok: false,
        enabled: false,
        autoTradeEnabled: false,
        frequencyMinutes: undefined,
        exchangeConnected: false,
        exchange: { connected: false },
        error: 'Status check failed',
        message: err.message || 'Unable to determine auto-trade status',
      });
    }
  });

  // GET /api/auto-trade/diagnostics - Comprehensive system diagnostics
  fastify.get('/diagnostics', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;

      // SELF-CONTAINED LIGHTWEIGHT DIAGNOSTICS
      // Get basic config data only - no expensive operations
      const db = getFirebaseAdmin().firestore();
      const [configDoc, bgSettingsDoc] = await Promise.all([
        Promise.race([db.collection('users').doc(user.uid).collection('autoTradeConfig').doc('current').get(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 200))]),
        Promise.race([db.collection('users').doc(user.uid).collection('settings').doc('backgroundResearch').get(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 200))])
      ]);

      const config = configDoc?.exists ? configDoc.data() : {};
      const autoTradeEnabled = config?.autoTradeEnabled ?? false;
      const bgSettings = bgSettingsDoc?.exists ? bgSettingsDoc.data() : {};

      // Simple status
      let lastTradeState = 'NONE';
      let lastTradeReason = autoTradeEnabled ? 'Auto-trade enabled and monitoring' : 'Auto-trade disabled';

      return reply.send({
        autoTrade: {
          status: autoTradeEnabled ? 'ON' : 'OFF',
          confirmationRequired: false, // Skip for diagnostics
          lastTradeState: lastTradeState,
          lastTradeReason: lastTradeReason,
          providerStatus: 'UNKNOWN', // Skip for diagnostics
          providerMessage: null,
          details: {
            dailyTrades: 0,
            dailyPnL: 0,
            activeTrades: 0,
            loopStatus: autoTradeEnabled ? 'WAITING' : 'DISABLED',
          }
        },
        backgroundResearch: {
          status: bgSettings?.backgroundResearchEnabled ? 'IDLE' : 'DISABLED',
          lastRunAt: bgSettings?.lastRunAt?.toDate()?.toISOString() || null,
          nextRunAt: null,
          accuracyTrigger: bgSettings?.accuracyTrigger || 0
        },
        accuracyAlerts: {
          status: 'DISABLED',
          lastAccuracyChecked: 0,
          threshold: 0,
          lastAlertSentAt: null,
          telegramEnabled: false
        }
      });
    } catch (err: any) {
      console.error("[DIAGNOSTICS_ERROR]", err);
      return { ok: false, error: 'Failed' };
    }
  });

  // GET /api/auto-trade/config - Get user auto-trade configuration
  // CRITICAL: PURE & FAST - Direct Firestore read only, no service calls
  fastify.get('/config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    console.log("[ROUTE_ENTER] /auto-trade/config PID:", process.pid);

    // HARD TIMEOUT GUARD: Auto-respond 504 after 1s
    const timeoutId = setTimeout(() => {
      if (!reply.sent) {
        console.error("[ROUTE_TIMEOUT] /auto-trade/config exceeded 2s");
        reply.code(504).send({ ok: false, reason: 'route_timeout', route: '/auto-trade/config' });
      }
    }, 2000);

    try {
      const user = (request as any).user;
      if (!user?.uid) {
        clearTimeout(timeoutId);
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // DIRECT Firestore read with 500ms timeout (no autoTradeEngine)
      const db = getFirebaseAdmin().firestore();
      const configDoc = await Promise.race([
        db.collection('users').doc(user.uid).collection('autoTradeConfig').doc('current').get(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000))
      ]);

      const config = configDoc?.exists ? configDoc.data() : {};
      const autoTradeEnabled = config?.autoTradeEnabled ?? false;

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      console.log("[ROUTE_EXIT] /auto-trade/config", duration, "ms");

      return {
        autoTradeEnabled,
        maxConcurrentTrades: config?.maxConcurrentTrades || 3,
        maxTradesPerDay: config?.maxTradesPerDay || 50,
        cooldownSeconds: config?.cooldownSeconds || 30,
        panicStopEnabled: config?.panicStopEnabled || false,
        slippageBlocker: config?.slippageBlocker || false,
        lastResearchAt: null,
        nextResearchAt: null,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("[ROUTE_ERROR] /auto-trade/config", err.message, Date.now() - startTime, "ms");
      return {
        autoTradeEnabled: false,
        maxConcurrentTrades: 3,
        maxTradesPerDay: 50,
        cooldownSeconds: 30,
        panicStopEnabled: false,
        slippageBlocker: false,
        lastResearchAt: null,
        nextResearchAt: null,
      };
    }
  });

  // POST /api/auto-trade/config - Update user auto-trade configuration
  fastify.post('/config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = configSchema.parse(request.body);

      // [DIAGNOSTIC] Log incoming request body
      console.log('[AUTO_TRADE_POST_CONFIG_DIAGNOSTIC] Request body:', {
        uid: user.uid,
        body,
        autoTradeEnabledInBody: body.autoTradeEnabled,
        typeofAutoTradeEnabled: typeof body.autoTradeEnabled,
      });

      const savedConfig = await autoTradeEngine.saveConfig(user.uid, body);

      // [DIAGNOSTIC] Log saved config returned from saveConfig
      console.log('[AUTO_TRADE_POST_CONFIG_DIAGNOSTIC] Config after save:', {
        uid: user.uid,
        autoTradeEnabled: savedConfig.autoTradeEnabled,
        typeofAutoTradeEnabled: typeof savedConfig.autoTradeEnabled,
      });

      // CRITICAL: If auto-trade is enabled, ensure user is scheduled in background research scheduler
      if (savedConfig.autoTradeEnabled === true) {
        try {
          const { backgroundResearchScheduler } = await import('../services/backgroundResearchScheduler');
          const scheduleResult = await backgroundResearchScheduler.ensureUserResearchScheduled(user.uid);
          if (scheduleResult.scheduled) {
            logger.info({ uid: user.uid }, '✅ Auto-trade enabled: User registered in background research scheduler');
          } else {
            logger.warn({ uid: user.uid, reason: scheduleResult.reason }, '⚠️ Auto-trade enabled but scheduler registration failed');
          }
        } catch (scheduleError: any) {
          logger.error({ uid: user.uid, error: scheduleError.message }, '❌ Failed to register user in scheduler after auto-trade enable');
          // Don't fail the request - config is saved, scheduler will pick it up on next check
        }
      }

      // Get updated status for response
      const isRunning = await autoTradeEngine.isAutoTradeRunning(user.uid);
      const lastResearchAt = await autoTradeEngine.getLastResearchTime(user.uid);
      const nextResearchAt = isRunning && lastResearchAt
        ? new Date(new Date(lastResearchAt).getTime() + 5 * 60 * 1000).toISOString()
        : null;

      logger.info({ uid: user.uid, config: savedConfig }, 'Auto-trade config updated and saved to Firestore');

      // CRITICAL FIX: Use ?? operator instead of || to handle false correctly
      // || operator converts false to the default, but false is a valid value!
      const responseConfig = {
        autoTradeEnabled: savedConfig.autoTradeEnabled ?? false,
        maxConcurrentTrades: savedConfig.maxConcurrentTrades ?? 3,
        maxTradesPerDay: savedConfig.maxTradesPerDay ?? 50,
        cooldownSeconds: savedConfig.cooldownSeconds ?? 30,
        panicStopEnabled: savedConfig.panicStopEnabled ?? false,
        slippageBlocker: savedConfig.slippageBlocker ?? false,
        lastResearchAt: lastResearchAt,
        nextResearchAt: nextResearchAt,
      };

      // [DIAGNOSTIC] Log final response being sent to frontend
      console.log('[AUTO_TRADE_POST_CONFIG_DIAGNOSTIC] Returning to frontend:', {
        uid: user.uid,
        autoTradeEnabled: responseConfig.autoTradeEnabled,
        typeofAutoTradeEnabled: typeof responseConfig.autoTradeEnabled,
      });

      return responseConfig;
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Invalid auto-trade configuration data',
          details: err.errors
        });
      }
      logger.error({ error: err.message, stack: err.stack, uid: (request as any).user?.uid }, 'Error updating auto-trade config');
      // CRITICAL: Return 500 on Firestore write failure (no silent fail)
      return reply.code(500).send({
        success: false,
        error: err.message || 'Failed to update auto-trade config'
      });
    }
  });


  // POST /api/auto-trade/queue - Queue trade signal (internal use)
  fastify.post('/queue', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = queueSignalSchema.parse(request.body);

      const signal: TradeSignal = {
        symbol: body.symbol,
        signal: body.signal,
        entryPrice: body.entryPrice,
        accuracy: body.accuracy,
        stopLoss: body.stopLoss || body.entryPrice * 0.985, // Default 1.5% stop loss
        takeProfit: body.takeProfit || body.entryPrice * 1.03, // Default 3% take profit
        reasoning: body.reasoning || 'Auto-trade signal',
        requestId: body.requestId || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
      };

      // Save to queue
      const db = getFirebaseAdmin().firestore();
      await db.collection('users').doc(user.uid).collection('autoTradeQueue').add({
        ...signal,
        timestamp: admin.firestore.Timestamp.now(),
        status: 'QUEUED',
        userId: user.uid,
      });

      logger.info({ uid: user.uid, requestId: signal.requestId, symbol: signal.symbol }, 'Trade signal queued');

      return {
        success: true,
        requestId: signal.requestId,
        message: 'Trade signal queued successfully',
      };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid signal data', details: err.errors });
      }
      logger.error({ err }, 'Error queueing trade signal');
      return reply.code(500).send({ error: err.message || 'Error queueing signal' });
    }
  });

  // POST /api/auto-trade/run - Run queued analyses (admin/manual trigger)
  fastify.post('/run', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const config = await autoTradeEngine.loadConfig(user.uid);

      if (!config.autoTradeEnabled) {
        return reply.code(400).send({ error: 'Auto-trade is not enabled' });
      }

      // Get queued signals
      const db = getFirebaseAdmin().firestore();
      const queueSnapshot = await db.collection('users').doc(user.uid)
        .collection('autoTradeQueue')
        .where('status', '==', 'QUEUED')
        .orderBy('timestamp', 'asc')
        .limit(10)
        .get();

      if (queueSnapshot.empty) {
        return {
          message: 'No queued signals to process',
          processed: 0,
        };
      }

      const results = [];
      for (const doc of queueSnapshot.docs) {
        const signalData = doc.data();
        const signal: TradeSignal = {
          symbol: signalData.symbol,
          signal: signalData.signal,
          entryPrice: signalData.entryPrice,
          accuracy: signalData.accuracy,
          stopLoss: signalData.stopLoss,
          takeProfit: signalData.takeProfit,
          reasoning: signalData.reasoning,
          requestId: signalData.requestId,
          timestamp: signalData.timestamp.toDate(),
        };

        try {
          const trade = await autoTradeEngine.executeTrade(user.uid, signal);

          // Update queue status
          await doc.ref.update({
            status: trade.status,
            tradeId: trade.tradeId,
            orderId: trade.orderId,
            processedAt: admin.firestore.Timestamp.now(),
          });

          results.push({ requestId: signal.requestId, status: trade.status, tradeId: trade.tradeId });
        } catch (error: any) {
          await doc.ref.update({
            status: 'FAILED',
            error: error.message,
            processedAt: admin.firestore.Timestamp.now(),
          });
          results.push({ requestId: signal.requestId, status: 'FAILED', error: error.message });
        }
      }

      return {
        message: `Processed ${results.length} queued signals`,
        processed: results.length,
        results,
      };
    } catch (err: any) {
      logger.error({ err }, 'Error running queued trades');
      return reply.code(500).send({ error: err.message || 'Error processing queue' });
    }
  });

  // POST /api/auto-trade/execute - Execute specific queued trade (auth + rate-limited)
  fastify.post('/execute', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = executeTradeSchema.parse(request.body);

      const signal: TradeSignal = {
        symbol: body.signal.symbol,
        signal: body.signal.signal,
        entryPrice: body.signal.entryPrice,
        accuracy: body.signal.accuracy,
        stopLoss: body.signal.stopLoss || body.signal.entryPrice * 0.985,
        takeProfit: body.signal.takeProfit || body.signal.entryPrice * 1.03,
        reasoning: body.signal.reasoning || 'Manual execution',
        requestId: body.requestId,
        timestamp: new Date(),
      };

      const trade = await autoTradeEngine.executeTrade(user.uid, signal);

      return {
        success: true,
        trade,
        message: 'Trade executed successfully',
      };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid trade data', details: err.errors });
      }
      logger.error({ err }, 'Error executing trade');
      return reply.code(500).send({ error: err.message || 'Error executing trade' });
    }
  });


  // POST /api/auto-trade/toggle - Toggle auto-trade on/off
  // CRITICAL: Persist to Firestore BEFORE responding (ensures state survives refresh)
  // Firestore is SINGLE SOURCE OF TRUTH - no engine runtime dependency
  fastify.post('/toggle', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    console.log("[ROUTE_ENTER] /auto-trade/toggle PID:", process.pid);
    // TEMP RUNTIME PROOF (REMOVE AFTER CONFIRMING): proves which code version/file is executing
    console.log("[AUTO_TRADE_TOGGLE] NEW LOGIC ACTIVE", { pid: process.pid, file: __filename, ts: new Date().toISOString() });

    // HARD TIMEOUT GUARD: Auto-respond 504 after 2s (allow time for Firestore write)
    const timeoutId = setTimeout(() => {
      if (!reply.sent) {
        console.error("[ROUTE_TIMEOUT] /auto-trade/toggle exceeded 2s");
        reply.code(504).send({ ok: false, reason: 'route_timeout', route: '/auto-trade/toggle' });
      }
    }, 2000);

    try {
      const user = (request as any).user;
      if (!user?.uid) {
        clearTimeout(timeoutId);
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const body = toggleAutoTradeSchema.parse(request.body);
      const enabled = body.enabled;
      const frequencyMinutes = body.frequencyMinutes;

      console.log('[TOGGLE_REQUEST]', { uid: user.uid, enabled, frequencyMinutes });

      const db = getFirebaseAdmin().firestore();

      // Get current background research settings to preserve or default frequency
      const bgSettingsRef = db.collection('users').doc(user.uid).collection('settings').doc('backgroundResearch');
      const bgSettingsDoc = await bgSettingsRef.get();
      const existingBgSettings = bgSettingsDoc.exists ? bgSettingsDoc.data() : {};

      const finalFrequency = frequencyMinutes || existingBgSettings?.researchFrequencyMinutes || 5;

      // Update background research settings (SYNC)
      const newBgSettings = {
        ...existingBgSettings,
        backgroundResearchEnabled: enabled, // Research starts when Auto Trade starts
        researchFrequencyMinutes: finalFrequency,
        updatedAt: admin.firestore.Timestamp.now()
      };

      // CRITICAL: ONLY validate exchange when ENABLING auto-trade
      // Disabling auto-trade NEVER requires exchange validation
      if (enabled) {
        console.log('[TOGGLE_VALIDATION] Enabling auto-trade - validating exchange credentials');

        // FAST: Direct Firestore read for exchange check (500ms timeout)
        const exchangeDoc = await Promise.race([
          db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 500))
        ]);

        // Quick validation
        if (!exchangeDoc?.exists) {
          clearTimeout(timeoutId);
          console.log("[ROUTE_EXIT] /auto-trade/toggle (no exchange)", Date.now() - startTime, "ms");
          return reply.code(400).send({
            error: 'Exchange API keys not found. Please connect your exchange first.',
          });
        }

        const exchangeData = exchangeDoc.data();
        const hasApiKey = !!exchangeData?.apiKeyEncrypted;
        const hasSecret = !!(exchangeData?.secretKeyEncrypted || exchangeData?.secretEncrypted);
        const exchangeStatus = exchangeData?.exchangeStatus;

        if (!hasApiKey || !hasSecret) {
          clearTimeout(timeoutId);
          console.log("[ROUTE_EXIT] /auto-trade/toggle (keys missing)", Date.now() - startTime, "ms");
          return reply.code(400).send({
            error: 'Exchange API keys not properly configured.',
          });
        }

        // CRITICAL: Check if exchange keys are marked as invalid/undecryptable
        if (exchangeStatus === 'INVALID_KEYS') {
          clearTimeout(timeoutId);
          console.log("[ROUTE_EXIT] /auto-trade/toggle (keys invalid)", Date.now() - startTime, "ms");
          return reply.code(400).send({
            error: 'Encrypted API keys are invalid. Please reconnect.',
          });
        }

        // CRITICAL: Verify keys can actually be decrypted
        try {
          const { resolveExchangeConnector } = await import('../services/exchangeResolver');
          const exchangeConnector = await resolveExchangeConnector(user.uid);

          if (!exchangeConnector) {
            clearTimeout(timeoutId);
            console.log("[ROUTE_EXIT] /auto-trade/toggle (decrypt failed)", Date.now() - startTime, "ms");
            return reply.code(400).send({
              error: 'Failed to decrypt exchange API keys. Please re-enter your exchange API keys in Settings.',
            });
          }
        } catch (decryptErr: any) {
          clearTimeout(timeoutId);
          console.log("[ROUTE_EXIT] /auto-trade/toggle (decrypt error)", Date.now() - startTime, "ms", decryptErr.message);
          return reply.code(400).send({
            error: 'Exchange API key validation failed: ' + (decryptErr.message || 'Unknown error'),
          });
        }

        console.log('[TOGGLE_VALIDATION] Exchange validation passed - proceeding with enable');
      } else {
        console.log('[TOGGLE_VALIDATION] Disabling auto-trade - skipping all exchange validation');
      }

      // CRITICAL: Persist both configs before responding
      console.log('[TOGGLE_PERSIST_START]', { uid: user.uid, enabled, finalFrequency });

      // CRITICAL: Get existing config first to merge properly
      const configDocRef = db.collection('users').doc(user.uid).collection('autoTradeConfig').doc('current');
      const existingConfigDoc = await configDocRef.get();
      const existingConfig = existingConfigDoc.exists ? (existingConfigDoc.data() || {}) : {};

      // CRITICAL: Build clean object with only defined values
      const cleanConfig: any = {
        ...existingConfig,
        autoTradeEnabled: enabled,
        updatedAt: admin.firestore.Timestamp.now(),
        lastToggledAt: admin.firestore.Timestamp.now(),
      };

      // CRITICAL: Remove undefined values before write
      const sanitizedConfig: any = {};
      for (const [key, value] of Object.entries(cleanConfig)) {
        if (value !== undefined) {
          sanitizedConfig[key] = value;
        }
      }

      try {
        await Promise.all([
          configDocRef.set(sanitizedConfig, { merge: true }),
          bgSettingsRef.set(newBgSettings, { merge: true })
        ]);

        // CRITICAL: If enabling auto-trade, start the execution loop
        if (enabled) {
          try {
            console.log('[AUTO-TRADE LOOP] Starting auto-trade loop for user:', user.uid);
            await autoTradeEngine.startAutoTradeLoop(user.uid);
            console.log('[AUTO-TRADE LOOP] ✅ Auto-trade loop started successfully');
          } catch (loopErr: any) {
            logger.error({ uid: user.uid, error: loopErr.message }, 'Failed to start auto-trade loop');
            console.error('[AUTO-TRADE LOOP] ❌ Failed to start loop:', loopErr.message);
            // Continue anyway - scheduler will try to register on next check
          }
        } else {
          // If disabling, notify scheduler to stop
          const { backgroundResearchScheduler } = await import('../services/backgroundResearchScheduler');
          backgroundResearchScheduler.onUserSettingsChanged(user.uid).catch(err => {
            logger.warn({ uid: user.uid, error: err.message }, 'Failed to notify scheduler on toggle');
          });
        }

        console.log('[TOGGLE_PERSIST_DONE]', { uid: user.uid, enabled });

        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;
        console.log("[ROUTE_EXIT] /auto-trade/toggle (persisted)", duration, "ms");

        // Respond AFTER persistence confirmed
        return {
          ok: true,
          enabled,
          success: true,
        };
      } catch (writeError: any) {
        clearTimeout(timeoutId);
        logger.error({ uid: user.uid, error: writeError.message, stack: writeError.stack }, 'Firestore write failed in toggle endpoint');
        // CRITICAL: Return 500 on Firestore write failure
        return reply.code(500).send({
          ok: false,
          success: false,
          error: writeError.message || 'Failed to save auto-trade toggle state'
        });
      }

    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("[ROUTE_ERROR] /auto-trade/toggle", err.message, Date.now() - startTime, "ms");
      if (!reply.sent) {
        return reply.code(500).send({ ok: false, error: err.message });
      }
    }
  });

  // POST /api/auto-trade/reset-circuit-breaker - Reset circuit breaker
  fastify.post('/reset-circuit-breaker', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      await autoTradeEngine.resetCircuitBreaker(user.uid);

      return {
        message: 'Circuit breaker reset successfully',
      };
    } catch (err: any) {
      logger.error({ err }, 'Error resetting circuit breaker');
      return reply.code(500).send({ error: err.message || 'Error resetting circuit breaker' });
    }
  });

  // GET /api/auto-trade/active-trades - Get active trades
  // CRITICAL: Early-exit guard - return immediately if auto-trade is disabled
  fastify.get('/active-trades', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;

      // CRITICAL: Early-exit guard - check if auto-trade is enabled
      // If disabled, return immediately with empty array (no heavy queries)
      const configDoc = await getFirebaseAdmin().firestore()
        .collection('users').doc(user.uid).collection('autoTradeConfig').doc('current').get();
      const config = configDoc?.exists ? configDoc.data() : {};
      const autoTradeEnabled = config?.autoTradeEnabled ?? false;

      if (!autoTradeEnabled) {
        logger.debug({ uid: user.uid }, '⏭️ [EARLY_EXIT] /active-trades - auto-trade disabled, returning empty array');
        return { activeTrades: [] };
      }

      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      const activeTrades = await firestoreAdapter.getActiveTrades(user.uid, limit);

      return { activeTrades };
    } catch (err: any) {
      logger.error({ err }, 'Error getting active trades');
      return reply.code(500).send({ error: err.message || 'Error fetching active trades' });
    }
  });

  // GET /api/auto-trade/pending-trades - Get pending trades requiring confirmation
  fastify.get('/pending-trades', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const pendingTrades = await firestoreAdapter.getPendingTrades(user.uid);
      // Ensure we always return an array, even if Firestore query fails or returns undefined
      return { pendingTrades: pendingTrades || [] };
    } catch (err: any) {
      // On any Firestore error (e.g., missing index), log and return empty list instead of 500
      logger.warn({ err }, 'Pending trades fetch failed – returning empty array');
      return { pendingTrades: [] };
    }
  });

  // POST /api/auto-trade/approve-trade - Approve and execute a pending trade
  fastify.post('/approve-trade', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { requestId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { requestId } = request.body;

      if (!requestId) {
        return reply.code(400).send({ error: 'requestId is required' });
      }

      const execution = await autoTradeEngine.executeApprovedPendingTrade(user.uid, requestId);
      return {
        success: true,
        message: 'Trade approved and executed',
        execution,
      };
    } catch (err: any) {
      logger.error({ err }, 'Error approving trade');
      return reply.code(500).send({ error: err.message || 'Error approving trade' });
    }
  });

  // POST /api/auto-trade/reject-trade - Reject a pending trade
  fastify.post('/reject-trade', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { requestId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { requestId } = request.body;

      if (!requestId) {
        return reply.code(400).send({ error: 'requestId is required' });
      }

      await autoTradeEngine.rejectPendingTrade(user.uid, requestId);
      return {
        success: true,
        message: 'Trade rejected',
      };
    } catch (err: any) {
      logger.error({ err }, 'Error rejecting trade');
      return reply.code(500).send({ error: err.message || 'Error rejecting trade' });
    }
  });

  // GET /api/auto-trade/activity - Get auto-trade activity logs
  // CRITICAL: Must respond < 500ms - uses fail-fast guards
  // CRITICAL: Early-exit guard - return immediately if auto-trade is disabled
  fastify.get('/activity', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    const startTime = routeEntryLog('GET /auto-trade/activity');

    try {
      const user = (request as any).user;

      // CRITICAL: Early-exit guard - check if auto-trade is enabled
      // If disabled, return immediately with empty array (no heavy queries)
      const configDoc = await getFirebaseAdmin().firestore()
        .collection('users').doc(user.uid).collection('autoTradeConfig').doc('current').get();
      const config = configDoc?.exists ? configDoc.data() : {};
      const autoTradeEnabled = config?.autoTradeEnabled ?? false;

      if (!autoTradeEnabled) {
        logger.debug({ uid: user.uid }, '⏭️ [EARLY_EXIT] /activity - auto-trade disabled, returning empty array');
        routeExitLog('GET /auto-trade/activity (early-exit)', startTime);
        return { activities: [] };
      }

      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;

      const activities = await firestoreReadWithTimeout(
        () => firestoreAdapter.getAutoTradeActivity(user.uid, limit),
        [],
        'getAutoTradeActivity'
      );

      routeExitLog('GET /auto-trade/activity', startTime);
      return { activities };
    } catch (err: any) {
      logger.error({ err }, 'Error getting auto-trade activity');
      routeExitLog('GET /auto-trade/activity (error)', startTime);
      return { activities: [] };
    }
  });

  // GET /api/auto-trade/proposals - Get trade proposals
  // CRITICAL: Must respond < 500ms - uses fail-fast guards
  fastify.get('/proposals', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = routeEntryLog('GET /auto-trade/proposals');

    try {
      const user = (request as any).user;

      const proposals = await firestoreReadWithTimeout(
        () => firestoreAdapter.getTradeProposals(user.uid),
        [],
        'getTradeProposals'
      );

      routeExitLog('GET /auto-trade/proposals', startTime);
      return { proposals };
    } catch (err: any) {
      logger.error({ err }, 'Error getting trade proposals');
      routeExitLog('GET /auto-trade/proposals (error)', startTime);
      return { proposals: [] };
    }
  });

  // GET /api/auto-trade/logs - Get auto-trade execution logs
  // CRITICAL: Must respond < 500ms - uses fail-fast guards
  fastify.get('/logs', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    const startTime = routeEntryLog('GET /auto-trade/logs');

    try {
      const user = (request as any).user;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 100;

      const logs = await firestoreReadWithTimeout(
        () => firestoreAdapter.getAutoTradeLogs(user.uid, limit),
        [],
        'getAutoTradeLogs'
      );

      routeExitLog('GET /auto-trade/logs', startTime);
      return { logs };
    } catch (err: any) {
      logger.error({ err }, 'Error getting auto-trade logs');
      routeExitLog('GET /auto-trade/logs (error)', startTime);
      return { logs: [] };
    }
  });
}