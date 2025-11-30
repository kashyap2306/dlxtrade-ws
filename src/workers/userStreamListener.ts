import { logger } from '../utils/logger';
import { BinanceAdapter } from '../services/binanceAdapter';
import { orderManager } from '../services/orderManager';
import type { Order, Fill } from '../types';

export class UserStreamListener {
  private adapter: BinanceAdapter | null = null;
  private orderCallbacks: Set<(order: Order) => void> = new Set();
  private fillCallbacks: Set<(fill: Fill) => void> = new Set();

  setAdapter(adapter: BinanceAdapter): void {
    this.adapter = adapter;
  }

  subscribeOrderUpdates(callback: (order: Order) => void): void {
    this.orderCallbacks.add(callback);
  }

  subscribeFills(callback: (fill: Fill) => void): void {
    this.fillCallbacks.add(callback);
  }

  async start(): Promise<void> {
    if (!this.adapter) {
      throw new Error('Adapter not set');
    }

    const listenKey = await this.adapter.startUserDataStream();
    logger.info({ listenKey }, 'User data stream started');

    // Keep alive every 30 minutes
    const keepAliveInterval = setInterval(async () => {
      try {
        await this.adapter!.keepAliveUserDataStream();
      } catch (err) {
        logger.error({ err }, 'Error keeping user stream alive');
      }
    }, 30 * 60 * 1000);

    this.adapter.subscribeUserData((data) => {
      this.handleUserData(data);
    });

    // Cleanup on stop
    process.on('SIGINT', () => {
      clearInterval(keepAliveInterval);
      this.stop();
    });
  }

  private async handleUserData(data: any): Promise<void> {
    try {
      if (data.e === 'executionReport') {
        // Order update
        const order: Order = {
          id: data.i.toString(),
          symbol: data.s,
          side: data.S as 'BUY' | 'SELL',
          type: data.o as 'LIMIT' | 'MARKET',
          quantity: parseFloat(data.q),
          price: parseFloat(data.p || '0'),
          status: data.X as Order['status'],
          clientOrderId: data.c,
          exchangeOrderId: data.i.toString(),
          filledQty: parseFloat(data.z || '0'),
          avgPrice: parseFloat(data.p || '0'),
          createdAt: new Date(data.T || Date.now()),
          updatedAt: new Date(data.E || Date.now()),
        };

        this.orderCallbacks.forEach((cb) => cb(order));

        // If filled, record fill
        if (data.x === 'TRADE' && data.X === 'FILLED') {
          const fill = await orderManager.recordFill({
            orderId: order.id,
            symbol: order.symbol,
            side: order.side,
            quantity: parseFloat(data.l || '0'),
            price: parseFloat(data.L || '0'),
            fee: parseFloat(data.n || '0'),
            feeAsset: data.N || 'USDT',
          });

          this.fillCallbacks.forEach((cb) => cb(fill));
        }
      }
    } catch (err) {
      logger.error({ err, data }, 'Error handling user data');
    }
  }

  async stop(): Promise<void> {
    if (this.adapter) {
      await this.adapter.closeUserDataStream();
    }
    this.orderCallbacks.clear();
    this.fillCallbacks.clear();
    logger.info('User stream listener stopped');
  }
}

