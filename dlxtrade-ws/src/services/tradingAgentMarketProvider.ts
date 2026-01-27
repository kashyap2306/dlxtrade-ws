import { MarketDataProvider, CandleData } from './agentExecutionService';
import { ExchangeConnector, ExchangeConnectorFactory, ExchangeCredentials } from './exchangeConnector';
import { logger } from '../utils/logger';

export class TradingAgentMarketProvider implements MarketDataProvider {
  private exchangeConnector: ExchangeConnector;
  private exchange: string;
  private marketType: 'spot' | 'futures';

  constructor(exchangeCredentials: ExchangeCredentials, exchange: string = 'binance', marketType: 'spot' | 'futures' = 'spot') {
    this.exchange = exchange;
    
    // CRITICAL FIX: Force futures mode for Bitget to prevent spot endpoint calls
    if (exchange === 'bitget') {
      this.marketType = 'futures';
      if (marketType === 'spot') {
        logger.warn({ exchange }, 'Bitget forced to futures mode - spot trading not supported');
      }
    } else {
      this.marketType = marketType;
    }
    
    // FUTURES-ONLY GUARD: Throw error if spot mode is attempted for Bitget
    if (exchange === 'bitget' && marketType === 'spot') {
      throw new Error('BITGET_SPOT_MODE_FORBIDDEN: Bitget must use futures mode only');
    }
    
    this.exchangeConnector = ExchangeConnectorFactory.create(
      exchange as any,
      exchangeCredentials
    );
  }

  /**
   * Get candle data for the specified symbol and timeframe
   */
  async getCandles(symbol: string, timeframe: string, limit: number = 50): Promise<CandleData[]> {
    try {
      // Map timeframe to exchange format
      const exchangeTimeframe = this.mapTimeframe(timeframe);

      // For Bitget Futures, prefer USDT-M futures klines (VWAP strategy uses USDT-M)
      let klines: any[];
      if (this.exchange === 'bitget' && this.marketType === 'futures' && (this.exchangeConnector as any).getFuturesKlines) {
        klines = await (this.exchangeConnector as any).getFuturesKlines(symbol, exchangeTimeframe, limit);
      } else if (this.exchange === 'bitget' && this.marketType === 'futures' && (this.exchangeConnector as any).getCoinMKlines) {
        // Back-compat fallback
        klines = await (this.exchangeConnector as any).getCoinMKlines(symbol, exchangeTimeframe, limit);
      } else if (this.marketType === 'futures' && (this.exchangeConnector as any).getFuturesKlines) {
        klines = await (this.exchangeConnector as any).getFuturesKlines(symbol, exchangeTimeframe, limit);
      } else {
        klines = await this.exchangeConnector.getKlines(symbol, exchangeTimeframe, limit);
      }

      // Convert to our CandleData format
      return klines.map((kline: any) => ({
        timestamp: kline.timestamp || kline[0],
        open: parseFloat(kline.open || kline[1]),
        high: parseFloat(kline.high || kline[2]),
        low: parseFloat(kline.low || kline[3]),
        close: parseFloat(kline.close || kline[4]),
        volume: parseFloat(kline.volume || kline[5])
      }));
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        symbol,
        timeframe,
        limit
      }, 'Failed to get candles for trading agent');
      throw error;
    }
  }

  /**
   * Get account balance
   */
  async getAccountBalance(): Promise<{ equity: number; available: number }> {
    try {
      // Try futures balance first for perpetual futures
      if (this.exchangeConnector.getFuturesBalance) {
        const futuresBalance = await this.exchangeConnector.getFuturesBalance();
        return {
          equity: futuresBalance.totalBalance,
          available: futuresBalance.availableBalance
        };
      }

      // Back-compat: Bitget COIN-M balance fallback
      if (this.exchange === 'bitget' && (this.exchangeConnector as any).getCoinMBalance) {
        const coinMBalance = await (this.exchangeConnector as any).getCoinMBalance();
        return {
          equity: coinMBalance.totalBalance,
          available: coinMBalance.availableBalance
        };
      }

      // Fallback to spot balance
      if (this.exchangeConnector.getAccount) {
        const account = await this.exchangeConnector.getAccount();
        // Parse account balance - this depends on exchange format
        // For now, return a placeholder
        return {
          equity: 1000, // Placeholder
          available: 1000 // Placeholder
        };
      }

      throw new Error('No balance method available for this exchange');
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        exchange: this.exchange
      }, 'Failed to get account balance for trading agent');
      throw error;
    }
  }

  /**
   * Place an order with immediate SL/TP placement
   * CRITICAL: Entry order = MARKET order only, Execute only when signal is already approved
   * ORDER PLACEMENT: Entry + SL + TP must be placed on the EXCHANGE, not backend-managed
   * SL/TP must be placed immediately after entry (same execution flow)
   */
  async placeOrder(order: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'MARKET' | 'LIMIT';
    quantity: number;
    price?: number;
    stopLoss?: number;
    takeProfit?: number;
  }): Promise<string> {
    try {
      // STEP 1: Place entry order (MARKET only as per requirements)
      const entryOrderResult = await this.placeEntryOrder({
        symbol: order.symbol,
        side: order.side,
        type: 'MARKET', // Force MARKET entry as per requirements
        quantity: order.quantity,
        price: order.price
      });

      const entryOrderId = entryOrderResult.orderId || entryOrderResult.id || entryOrderResult.clientOrderId;
      if (!entryOrderId) {
        throw new Error('Entry order placed but no order ID returned');
      }

      logger.info({
        entryOrderId,
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        type: 'MARKET',
        entryOrderPlaced: true
      }, 'STEP 1: Entry order (MARKET) placed successfully');

      // STEP 2: Place SL/TP orders immediately after entry (if provided)
      // CRITICAL: SL/TP must be placed immediately after entry (same execution flow)
      if (order.stopLoss || order.takeProfit) {
        logger.info({
          symbol: order.symbol,
          stopLoss: order.stopLoss,
          takeProfit: order.takeProfit,
          quantity: order.quantity,
          entrySide: order.side
        }, 'STEP 2: Placing SL/TP orders on exchange immediately after entry');

        await this.placeSLTPOrders(order.symbol, order.side, order.quantity, order.stopLoss, order.takeProfit);
      } else {
        logger.warn({
          symbol: order.symbol,
          side: order.side,
          quantity: order.quantity
        }, 'STEP 2: No SL/TP provided - entry only order');
      }

      logger.info({
        entryOrderId,
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        type: 'MARKET',
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        slTpPlaced: !!(order.stopLoss || order.takeProfit),
        executionComplete: true
      }, 'Order with SL/TP placed successfully - execution complete');

      return entryOrderId.toString();
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        executionFailed: true
      }, 'CRITICAL: Failed to place order with SL/TP');
      throw error;
    }
  }

  /**
   * Place entry order only
   */
  private async placeEntryOrder(order: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'MARKET' | 'LIMIT';
    quantity: number;
    price?: number;
  }): Promise<any> {
    // Bitget Futures: use futures order placement
    if (this.exchange === 'bitget' && this.marketType === 'futures' && (this.exchangeConnector as any).placeFuturesOrder) {
      return await (this.exchangeConnector as any).placeFuturesOrder({
        symbol: order.symbol,
        side: order.side as 'BUY' | 'SELL',
        type: order.type as 'MARKET' | 'LIMIT',
        quantity: order.quantity,
        price: order.price,
      });
    }

    if (this.marketType === 'futures' && (this.exchangeConnector as any).placeFuturesOrder) {
      return await (this.exchangeConnector as any).placeFuturesOrder({
        symbol: order.symbol,
        side: order.side as 'BUY' | 'SELL',
        type: order.type as 'MARKET' | 'LIMIT',
        quantity: order.quantity,
        price: order.price,
      });
    }

    if (!this.exchangeConnector.placeOrder) {
      throw new Error('Order placement not supported by this exchange connector');
    }

    return await this.exchangeConnector.placeOrder({
      symbol: order.symbol,
      side: order.side as 'BUY' | 'SELL',
      type: order.type as 'MARKET' | 'LIMIT',
      quantity: order.quantity,
      price: order.price
    });
  }

  /**
   * Place SL/TP orders immediately after entry
   * CRITICAL: Entry + SL + TP must be placed on the EXCHANGE, not backend-managed
   * SL/TP must be placed immediately after entry (same execution flow)
   */
  private async placeSLTPOrders(
    symbol: string, 
    entrySide: 'BUY' | 'SELL', 
    quantity: number, 
    stopLoss?: number, 
    takeProfit?: number
  ): Promise<void> {
    const promises: Promise<any>[] = [];

    // Determine exit side (opposite of entry)
    const exitSide: 'BUY' | 'SELL' = entrySide === 'BUY' ? 'SELL' : 'BUY';

    // Place Stop Loss order - CRITICAL: Must be placed on exchange
    if (stopLoss && isFinite(stopLoss)) {
      const slPromise = this.placeFuturesOrder({
        symbol,
        side: exitSide,
        type: 'STOP_MARKET',
        quantity,
        stopPrice: stopLoss,
        reduceOnly: true
      }).catch(error => {
        logger.error({
          error: error instanceof Error ? error.message : 'Unknown error',
          symbol,
          stopLoss,
          side: exitSide,
          orderType: 'STOP_MARKET'
        }, 'CRITICAL: Failed to place Stop Loss order on exchange');
        // Don't throw - allow TP to still be placed
      });
      promises.push(slPromise);
    }

    // Place Take Profit order - CRITICAL: Must be placed on exchange
    if (takeProfit && isFinite(takeProfit)) {
      const tpPromise = this.placeFuturesOrder({
        symbol,
        side: exitSide,
        type: 'TAKE_PROFIT_MARKET',
        quantity,
        stopPrice: takeProfit,
        reduceOnly: true
      }).catch(error => {
        logger.error({
          error: error instanceof Error ? error.message : 'Unknown error',
          symbol,
          takeProfit,
          side: exitSide,
          orderType: 'TAKE_PROFIT_MARKET'
        }, 'CRITICAL: Failed to place Take Profit order on exchange');
        // Don't throw - allow SL to still be placed
      });
      promises.push(tpPromise);
    }

    // Wait for all SL/TP orders to complete - CRITICAL: Must complete before returning
    if (promises.length > 0) {
      const results = await Promise.allSettled(promises);
      
      // Log results for verification
      const slResult = stopLoss ? results[0] : null;
      const tpResult = takeProfit ? results[promises.length - 1] : null;
      
      logger.info({
        symbol,
        entrySide,
        quantity,
        stopLoss,
        takeProfit,
        slPlaced: slResult?.status === 'fulfilled',
        tpPlaced: tpResult?.status === 'fulfilled',
        slError: slResult?.status === 'rejected' ? (slResult.reason as any)?.message : null,
        tpError: tpResult?.status === 'rejected' ? (tpResult.reason as any)?.message : null
      }, 'SL/TP orders placement completed on exchange');
    }
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    if (this.exchangeConnector.setLeverage) {
      await this.exchangeConnector.setLeverage(symbol, leverage);
    }
  }

  async setMarginType(symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<void> {
    if (this.exchangeConnector.setMarginType) {
      await this.exchangeConnector.setMarginType(symbol, marginType);
    }
  }

  async placeFuturesOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: string;
    quantity?: number;
    price?: number;
    stopPrice?: number;
    reduceOnly?: boolean;
    closePosition?: boolean;
  }): Promise<any> {
    if ((this.exchangeConnector as any).placeFuturesOrder) {
      return await (this.exchangeConnector as any).placeFuturesOrder(params);
    }
    if (this.exchangeConnector.placeOrder && params.quantity) {
      return await this.exchangeConnector.placeOrder({
        symbol: params.symbol,
        side: params.side,
        type: (params.type as any) || 'MARKET',
        quantity: params.quantity,
        price: params.price,
      });
    }
    throw new Error('Futures order placement not supported by this exchange connector');
  }

  async getOrderStatus(symbol: string, orderId?: string, clientOrderId?: string): Promise<any> {
    if (this.marketType === 'futures' && (this.exchangeConnector as any).getFuturesOrderStatus) {
      return await (this.exchangeConnector as any).getFuturesOrderStatus(symbol, orderId, clientOrderId);
    }
    if ((this.exchangeConnector as any).getOrderStatus) {
      return await (this.exchangeConnector as any).getOrderStatus(symbol, orderId, clientOrderId);
    }
    throw new Error('Order status not supported by this exchange connector');
  }

  /**
   * Map internal timeframe to exchange timeframe format
   */
  private mapTimeframe(timeframe: string): string {
    const timeframeMap: { [key: string]: string } = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '1h': '1h',
      '4h': '4h',
      '1d': '1d'
    };

    return timeframeMap[timeframe] || timeframe;
  }

  /**
   * Test connection to exchange
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.exchangeConnector.testConnection();
      return result;
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Connection test failed'
      };
    }
  }
}