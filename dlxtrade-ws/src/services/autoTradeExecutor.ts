import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { notificationService } from './notificationService';
import * as admin from 'firebase-admin';

export interface AutoTradeConfig {
  enabled: boolean;
  maxTradePercent: number; // 0.01 = 1% of balance
  maxOpenOrders: number;
  minBalanceUSD: number;
  orderType: 'market' | 'limit';
  dryRun: boolean;
  // Position sizing defaults
  defaultPositionSize: number; // 0.01 = 1% of balance
  // TP/SL defaults (in percent)
  defaultTakeProfitPct: number; // 2.0 = 2%
  defaultStopLossPct: number; // 1.0 = 1%
  // User overrides (if set, override defaults)
  positionSizeOverride?: number;
  takeProfitOverride?: number;
  stopLossOverride?: number;
}

export interface TradeExecutionRequest {
  userId: string;
  symbol: string;
  signal: 'BUY' | 'SELL';
  accuracy: number;
  researchRequestId: string;
  currentPrice: number;
  exchangeName?: string; // Optional exchange name for auto-trading
}

export interface TradeResult {
  success: boolean;
  orderId?: string;
  executedPrice?: number;
  executedQuantity?: number;
  error?: string;
  dryRun?: boolean;
}

export class AutoTradeExecutor {
  private static instance: AutoTradeExecutor;
  private globalConfig: AutoTradeConfig = {
    enabled: false,
    maxTradePercent: 0.01, // 1% default
    maxOpenOrders: 3,
    minBalanceUSD: 10,
    orderType: 'market',
    dryRun: false,
    // Position sizing defaults
    defaultPositionSize: 0.01, // 1% default
    defaultTakeProfitPct: 2.0, // 2% TP default
    defaultStopLossPct: 1.0, // 1% SL default
  };

  private constructor() {}

  static getInstance(): AutoTradeExecutor {
    if (!AutoTradeExecutor.instance) {
      AutoTradeExecutor.instance = new AutoTradeExecutor();
    }
    return AutoTradeExecutor.instance;
  }

  /**
   * Update global auto-trade configuration
   */
  async updateGlobalConfig(config: Partial<AutoTradeConfig>): Promise<void> {
    this.globalConfig = { ...this.globalConfig, ...config };
    logger.info({ config: this.globalConfig }, '[AUTO-TRADE] Global config updated');
  }

  /**
   * Get global auto-trade configuration
   */
  getGlobalConfig(): AutoTradeConfig {
    return { ...this.globalConfig };
  }

  /**
   * Main entry point for auto-trade execution
   * Called when research results arrive with high confidence
   */
  async executeAutoTrade(request: TradeExecutionRequest): Promise<TradeResult> {
    const startTime = Date.now();

    try {
      logger.info({
        userId: this.maskUserId(request.userId),
        symbol: request.symbol,
        signal: request.signal,
        accuracy: request.accuracy,
        researchId: request.researchRequestId
      }, '[AUTO-TRADE] START - Evaluating auto-trade execution');

      // 1. Check global toggle
      if (!this.globalConfig.enabled) {
        logger.info({ userId: this.maskUserId(request.userId) }, '[AUTO-TRADE] SKIPPED - Global auto-trade disabled');
        return { success: false, error: 'Global auto-trade disabled' };
      }

      // 2. Check accuracy threshold
      if (request.accuracy < 75) {
        logger.info({
          userId: this.maskUserId(request.userId),
          accuracy: request.accuracy
        }, '[AUTO-TRADE] SKIPPED - Accuracy below threshold');
        return { success: false, error: 'Accuracy below threshold' };
      }

      // 3. Check idempotency - ensure this research result hasn't been executed before
      const existingTrade = await this.checkIdempotency(request.researchRequestId);
      if (existingTrade) {
        logger.info({
          userId: this.maskUserId(request.userId),
          researchId: request.researchRequestId,
          existingOrderId: existingTrade.orderId
        }, '[AUTO-TRADE] SKIPPED - Idempotency check failed (already executed)');
        return { success: false, error: 'Already executed' };
      }

      // 4. Get user settings and validate
      const userSettings = await this.getUserAutoTradeSettings(request.userId);
      if (!userSettings.enabled) {
        logger.info({ userId: this.maskUserId(request.userId) }, '[AUTO-TRADE] SKIPPED - User auto-trade disabled');
        return { success: false, error: 'User auto-trade disabled' };
      }

      // 5. Get user's exchange credentials
      const userIntegrations = await firestoreAdapter.getEnabledIntegrations(request.userId);
      if (!userIntegrations.binance?.apiKey || !userIntegrations.binance?.secretKey) {
        logger.info({ userId: this.maskUserId(request.userId) }, '[AUTO-TRADE] SKIPPED - No exchange credentials');
        return { success: false, error: 'No exchange credentials' };
      }

      // 6. Check open orders limit
      const openOrdersCount = await this.getUserOpenOrdersCount(request.userId);
      if (openOrdersCount >= userSettings.maxOpenOrders) {
        logger.info({
          userId: this.maskUserId(request.userId),
          openOrders: openOrdersCount,
          maxAllowed: userSettings.maxOpenOrders
        }, '[AUTO-TRADE] SKIPPED - Max open orders reached');
        return { success: false, error: 'Max open orders reached' };
      }

      // 7. Calculate trade size and validate balance
      const tradeSize = await this.calculateTradeSize(request.userId, request.symbol, userSettings);
      if (!tradeSize.canTrade) {
        logger.info({
          userId: this.maskUserId(request.userId),
          reason: tradeSize.reason
        }, '[AUTO-TRADE] SKIPPED - Insufficient balance or invalid trade size');
        return { success: false, error: tradeSize.reason };
      }

      // 8. Execute the trade with TP/SL
      const takeProfitPct = userSettings.takeProfitOverride || userSettings.defaultTakeProfitPct;
      const stopLossPct = userSettings.stopLossOverride || userSettings.defaultStopLossPct;

      const tradeResult = await this.executeTrade({
        userId: request.userId,
        symbol: request.symbol,
        signal: request.signal,
        quantity: tradeSize.quantity,
        price: request.currentPrice,
        userIntegrations,
        researchRequestId: request.researchRequestId,
        dryRun: userSettings.dryRun || this.globalConfig.dryRun,
        orderType: userSettings.orderType,
        takeProfitPct,
        stopLossPct
      });

      const latency = Date.now() - startTime;
      logger.info({
        userId: this.maskUserId(request.userId),
        symbol: request.symbol,
        signal: request.signal,
        success: tradeResult.success,
        orderId: tradeResult.orderId,
        dryRun: tradeResult.dryRun,
        latency
      }, '[AUTO-TRADE] COMPLETED');

      return tradeResult;

    } catch (error: any) {
      const latency = Date.now() - startTime;
      logger.error({
        error: error.message,
        userId: this.maskUserId(request.userId),
        symbol: request.symbol,
        latency
      }, '[AUTO-TRADE] ERROR - Unexpected error during execution');

      return {
        success: false,
        error: error.message || 'Unexpected error'
      };
    }
  }

  /**
   * Check if this research result has already been executed
   */
  private async checkIdempotency(researchRequestId: string): Promise<any> {
    try {
      const tradeRef = admin.firestore()
        .collection('autoTrades')
        .where('researchRequestId', '==', researchRequestId)
        .limit(1);

      const snapshot = await tradeRef.get();
      return snapshot.empty ? null : snapshot.docs[0].data();
    } catch (error) {
      logger.warn({ error: error.message, researchRequestId }, 'Failed to check idempotency');
      return null; // Allow execution if check fails
    }
  }

  /**
   * Get user's auto-trade settings
   */
  async getUserAutoTradeSettings(userId: string): Promise<AutoTradeConfig> {
    try {
      const userDoc = await admin.firestore()
        .collection('users')
        .doc(userId)
        .get();

      const userData = userDoc.data();
      const settings = userData?.settings?.autoTrade || {};

      return {
        enabled: settings.enabled || false,
        maxTradePercent: settings.maxTradePercent || this.globalConfig.maxTradePercent,
        maxOpenOrders: settings.maxOpenOrders || this.globalConfig.maxOpenOrders,
        minBalanceUSD: settings.minBalanceUSD || this.globalConfig.minBalanceUSD,
        orderType: settings.orderType || this.globalConfig.orderType,
        dryRun: settings.dryRun || false,
        // Position sizing defaults
        defaultPositionSize: settings.defaultPositionSize || 0.01, // 1% default
        defaultTakeProfitPct: settings.defaultTakeProfitPct || 2.0, // 2% TP default
        defaultStopLossPct: settings.defaultStopLossPct || 1.0, // 1% SL default
        // User overrides
        positionSizeOverride: settings.positionSizeOverride,
        takeProfitOverride: settings.takeProfitOverride,
        stopLossOverride: settings.stopLossOverride
      };
    } catch (error) {
      logger.warn({ error: error.message, userId: this.maskUserId(userId) }, 'Failed to get user settings, using defaults');
      return { ...this.globalConfig, enabled: false }; // Disable if can't get settings
    }
  }

  /**
   * Get count of user's open orders
   */
  private async getUserOpenOrdersCount(userId: string): Promise<number> {
    try {
      // This would need to be implemented to check actual exchange orders
      // For now, return 0 (simplified implementation)
      return 0;
    } catch (error) {
      logger.warn({ error: error.message, userId: this.maskUserId(userId) }, 'Failed to get open orders count');
      return 0; // Allow execution if check fails
    }
  }

  /**
   * Calculate trade size and validate balance
   */
  private async calculateTradeSize(
    userId: string,
    symbol: string,
    settings: AutoTradeConfig
  ): Promise<{ canTrade: boolean; quantity?: number; reason?: string }> {
    try {
      // Get user's USDT balance (simplified - would need actual exchange integration)
      const balanceUSD = await this.getUserBalanceUSD(userId);
      if (balanceUSD < settings.minBalanceUSD) {
        return {
          canTrade: false,
          reason: `Insufficient balance: $${balanceUSD.toFixed(2)} < $${settings.minBalanceUSD}`
        };
      }

      // Calculate trade amount
      const tradeAmountUSD = balanceUSD * settings.maxTradePercent;
      const quantity = tradeAmountUSD / 50; // Simplified - would need current price

      // Validate quantity against exchange limits
      if (quantity < 0.001) { // Minimum order size
        return {
          canTrade: false,
          reason: `Trade size too small: ${quantity} < 0.001`
        };
      }

      return { canTrade: true, quantity };

    } catch (error) {
      logger.error({ error: error.message, userId: this.maskUserId(userId) }, 'Failed to calculate trade size');
      return { canTrade: false, reason: 'Failed to calculate trade size' };
    }
  }

  /**
   * Get user's USD balance from exchange
   */
  private async getUserBalanceUSD(userId: string): Promise<number> {
    try {
      // Get user's exchange integrations
      const userIntegrations = await firestoreAdapter.getEnabledIntegrations(userId);

      if (!userIntegrations.binance?.apiKey || !userIntegrations.binance?.secretKey) {
        logger.warn({ userId: this.maskUserId(userId) }, 'No exchange credentials for balance check');
        return 0;
      }

      // Use Binance adapter to get account balance
      const { BinanceAdapter } = await import('./binanceAdapter');
      const binanceAdapter = new BinanceAdapter(
        userIntegrations.binance.apiKey,
        userIntegrations.binance.secretKey,
        false // Use live trading by default for safety
      );

      const accountInfo = await binanceAdapter.getAccount();

      // Calculate USD value from USDT balance (assuming USDT is the quote currency)
      const usdtBalance = accountInfo.balances.find((b: any) => b.asset === 'USDT');
      if (usdtBalance && parseFloat(usdtBalance.free) > 0) {
        return parseFloat(usdtBalance.free);
      }

      // If no USDT, try to estimate value from other assets
      // This is a simplified implementation
      logger.info({ userId: this.maskUserId(userId), balances: accountInfo.balances?.length || 0 }, 'USDT balance not found, checking other assets');

      return 0; // No USD balance found

    } catch (error: any) {
      logger.error({
        error: error.message,
        userId: this.maskUserId(userId)
      }, 'Failed to get user balance from exchange');

      // For safety, return 0 if we can't get balance
      return 0;
    }
  }

  /**
   * Execute the actual trade
   */
  private async executeTrade(params: {
    userId: string;
    symbol: string;
    signal: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    userIntegrations: any;
    researchRequestId: string;
    dryRun: boolean;
    orderType: 'market' | 'limit';
    takeProfitPct?: number;
    stopLossPct?: number;
  }): Promise<TradeResult> {

    const {
      userId,
      symbol,
      signal,
      quantity,
      price,
      userIntegrations,
      researchRequestId,
      dryRun,
      orderType,
      takeProfitPct,
      stopLossPct
    } = params;

    try {
      if (dryRun) {
        // Dry run mode - simulate the trade
        const simulatedOrderId = `dry_run_${Date.now()}`;
        const simulatedPrice = signal === 'BUY' ? price * 1.001 : price * 0.999;

        // Log the simulated trade
        await this.logTrade({
          userId,
          symbol,
          signal,
          quantity,
          price: simulatedPrice,
          orderId: simulatedOrderId,
          researchRequestId,
          dryRun: true,
          status: 'simulated',
          exchangeOrderId: simulatedOrderId
        });

        // Send dry-run notification
        await this.sendTradeNotification(userId, {
          symbol,
          signal,
          quantity,
          price: simulatedPrice,
          orderId: simulatedOrderId,
          dryRun: true
        });

        logger.info({
          userId: this.maskUserId(userId),
          symbol,
          signal,
          quantity,
          simulatedPrice,
          orderId: simulatedOrderId
        }, '[AUTO-TRADE] SIMULATED - Dry run trade executed');

        return {
          success: true,
          orderId: simulatedOrderId,
          executedPrice: simulatedPrice,
          executedQuantity: quantity,
          dryRun: true
        };
      }

      // Real trade execution using Binance adapter
      const { BinanceAdapter } = await import('./binanceAdapter');
      const binanceAdapter = new BinanceAdapter(
        userIntegrations.binance.apiKey,
        userIntegrations.binance.secretKey,
        false // Use live trading by default for safety
      );

      // Extract base and quote currencies from symbol (e.g., BTCUSDT -> BTC, USDT)
      const baseCurrency = symbol.replace('USDT', '').replace('USD', '');
      const quoteCurrency = symbol.includes('USDT') ? 'USDT' : 'USD';

      // Place the main order
      const orderParams = {
        symbol: `${baseCurrency}${quoteCurrency}`,
        side: signal,
        type: (orderType === 'market' ? 'MARKET' : 'LIMIT') as 'MARKET' | 'LIMIT',
        quantity: quantity,
        ...(orderType === 'limit' && { price: price })
      };

      const orderResult = await binanceAdapter.placeOrder(orderParams);

      const executedPrice = orderResult.price || price;
      const executedQuantity = orderResult.quantity || quantity;
      const orderId = orderResult.exchangeOrderId || orderResult.clientOrderId || `order_${Date.now()}`;

      // Place TP/SL orders if configured
      let tpOrderId: string | undefined;
      let slOrderId: string | undefined;

      try {
        if (takeProfitPct && takeProfitPct > 0) {
          const tpPrice = signal === 'BUY'
            ? executedPrice * (1 + takeProfitPct / 100)
            : executedPrice * (1 - takeProfitPct / 100);

          const tpOrder = await binanceAdapter.placeOrder({
            symbol: `${baseCurrency}${quoteCurrency}`,
            side: signal === 'BUY' ? 'SELL' : 'BUY',
            type: 'LIMIT',
            quantity: executedQuantity,
            price: tpPrice
          });

          tpOrderId = tpOrder.exchangeOrderId || tpOrder.clientOrderId;
          logger.info({
            userId: this.maskUserId(userId),
            symbol,
            tpPrice,
            tpOrderId
          }, '[AUTO-TRADE] TP order placed');
        }

        if (stopLossPct && stopLossPct > 0) {
          const slPrice = signal === 'BUY'
            ? executedPrice * (1 - stopLossPct / 100)
            : executedPrice * (1 + stopLossPct / 100);

          const slOrder = await binanceAdapter.placeOrder({
            symbol: `${baseCurrency}${quoteCurrency}`,
            side: signal === 'BUY' ? 'SELL' : 'BUY',
            type: 'LIMIT',
            quantity: executedQuantity,
            price: slPrice
          });

          slOrderId = slOrder.exchangeOrderId || slOrder.clientOrderId;
          logger.info({
            userId: this.maskUserId(userId),
            symbol,
            slPrice,
            slOrderId
          }, '[AUTO-TRADE] SL order placed');
        }
      } catch (tpslError: any) {
        logger.warn({
          error: tpslError.message,
          userId: this.maskUserId(userId),
          symbol
        }, '[AUTO-TRADE] TP/SL order placement failed, continuing with main order');
      }

      // Log the real trade with TP/SL info
      await this.logTrade({
        userId,
        symbol,
        signal,
        quantity: executedQuantity,
        price: executedPrice,
        orderId,
        researchRequestId,
        dryRun: false,
        status: 'executed',
        exchangeOrderId: orderId,
        takeProfitOrderId: tpOrderId,
        stopLossOrderId: slOrderId,
        takeProfitPct,
        stopLossPct
      });

      // Send notification
      await this.sendTradeNotification(userId, {
        symbol,
        signal,
        quantity: executedQuantity,
        price: executedPrice,
        orderId,
        dryRun: false
      });

      logger.info({
        userId: this.maskUserId(userId),
        symbol,
        signal,
        quantity: executedQuantity,
        price: executedPrice,
        orderId
      }, '[AUTO-TRADE] EXECUTED - Live trade completed successfully');

      return {
        success: true,
        orderId,
        executedPrice,
        executedQuantity
      };

    } catch (error: any) {
      logger.error({
        error: error.message,
        userId: this.maskUserId(userId),
        symbol
      }, '[AUTO-TRADE] FAILED - Trade execution failed');

      // Send failed trade notification
      await this.sendTradeNotification(userId, {
        symbol,
        signal,
        quantity,
        price,
        orderId: `failed_${Date.now()}`,
        dryRun,
        error: error.message
      }, 'trade_failed');

      // Log failed trade
      await this.logTrade({
        userId,
        symbol,
        signal,
        quantity,
        price,
        orderId: `failed_${Date.now()}`,
        researchRequestId,
        dryRun,
        status: 'failed',
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Log trade to Firestore
   */
  private async logTrade(trade: {
    userId: string;
    symbol: string;
    signal: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    orderId: string;
    researchRequestId: string;
    dryRun: boolean;
    status: string;
    exchangeOrderId?: string;
    error?: string;
    takeProfitOrderId?: string;
    stopLossOrderId?: string;
    takeProfitPct?: number;
    stopLossPct?: number;
  }): Promise<void> {
    try {
      await admin.firestore().collection('autoTrades').add({
        ...trade,
        timestamp: admin.firestore.Timestamp.now(),
        createdAt: admin.firestore.Timestamp.now()
      });
    } catch (error) {
      logger.error({ error: error.message, trade }, 'Failed to log trade');
    }
  }

  /**
   * Send trade notification to user
   */
  private async sendTradeNotification(userId: string, trade: {
    symbol: string;
    signal: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    orderId: string;
    dryRun?: boolean;
    error?: string;
  }, type: 'trade_executed' | 'trade_failed' = 'trade_executed'): Promise<void> {
    await notificationService.sendTradeNotification({
      userId,
      type,
      symbol: trade.symbol,
      signal: trade.signal,
      quantity: trade.quantity,
      price: trade.price,
      orderId: trade.orderId,
      dryRun: trade.dryRun,
      error: trade.error
    });
  }

  /**
   * Mask user ID for privacy in logs
   */
  private maskUserId(userId: string): string {
    if (userId.length <= 8) return userId;
    return userId.substring(0, 4) + '****' + userId.substring(userId.length - 4);
  }

  /**
   * Admin function to cancel a trade
   */
  async cancelTrade(tradeId: string, adminUserId: string): Promise<boolean> {
    try {
      const tradeRef = admin.firestore().collection('autoTrades').doc(tradeId);
      const tradeDoc = await tradeRef.get();

      if (!tradeDoc.exists) {
        return false;
      }

      await tradeRef.update({
        status: 'cancelled',
        cancelledBy: adminUserId,
        cancelledAt: admin.firestore.Timestamp.now()
      });

      logger.info({ tradeId, adminUserId }, '[AUTO-TRADE] CANCELLED - Trade cancelled by admin');
      return true;
    } catch (error) {
      logger.error({ error: error.message, tradeId }, 'Failed to cancel trade');
      return false;
    }
  }

  /**
   * Get auto-trades for admin dashboard
   */
  async getAutoTrades(limit: number = 50): Promise<any[]> {
    try {
      const tradesRef = admin.firestore()
        .collection('autoTrades')
        .orderBy('timestamp', 'desc')
        .limit(limit);

      const snapshot = await tradesRef.get();
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to get auto-trades');
      return [];
    }
  }
}

export const autoTradeExecutor = AutoTradeExecutor.getInstance();
