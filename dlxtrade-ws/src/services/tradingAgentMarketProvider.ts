import { MarketDataProvider, CandleData } from './agentExecutionService';
import { ExchangeConnector, ExchangeConnectorFactory, ExchangeCredentials } from './exchangeConnector';
import { logger } from '../utils/logger';

export class TradingAgentMarketProvider implements MarketDataProvider {
  private exchangeConnector: ExchangeConnector;
  private exchange: string;

  constructor(exchangeCredentials: ExchangeCredentials, exchange: string = 'binance') {
    this.exchange = exchange;
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

      // For Bitget COIN-M Futures, use dedicated method
      let klines: any[];
      if (this.exchange === 'bitget') {
        klines = await (this.exchangeConnector as any).getCoinMKlines(symbol, exchangeTimeframe, limit);
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
      // For Bitget COIN-M Futures, use dedicated COIN-M balance method
      if (this.exchange === 'bitget' && (this.exchangeConnector as any).getCoinMBalance) {
        const coinMBalance = await (this.exchangeConnector as any).getCoinMBalance();
        return {
          equity: coinMBalance.totalBalance,
          available: coinMBalance.availableBalance
        };
      }

      // Try futures balance first for perpetual futures
      if (this.exchangeConnector.getFuturesBalance) {
        const futuresBalance = await this.exchangeConnector.getFuturesBalance();
        return {
          equity: futuresBalance.totalBalance,
          available: futuresBalance.availableBalance
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
   * Place an order
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
      if (!this.exchangeConnector.placeOrder) {
        throw new Error('Order placement not supported by this exchange connector');
      }

      // For now, place basic market order
      // TODO: Implement stop loss and take profit orders
      const orderResult = await this.exchangeConnector.placeOrder({
        symbol: order.symbol,
        side: order.side as 'BUY' | 'SELL',
        type: order.type as 'MARKET' | 'LIMIT',
        quantity: order.quantity,
        price: order.price
      });

      // Extract order ID from result
      const orderId = orderResult.orderId || orderResult.id || orderResult.clientOrderId;

      if (!orderId) {
        throw new Error('Order placed but no order ID returned');
      }

      logger.info({
        orderId,
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        type: order.type
      }, 'Order placed successfully for trading agent');

      return orderId.toString();
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity
      }, 'Failed to place order for trading agent');
      throw error;
    }
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