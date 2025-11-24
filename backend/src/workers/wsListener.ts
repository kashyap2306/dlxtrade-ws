import { logger } from '../utils/logger';
import { BinanceAdapter } from '../services/binanceAdapter';
import type { Orderbook, Trade } from '../types';

export class WSListener {
  private adapter: BinanceAdapter | null = null;
  private orderbookCallbacks: Set<(orderbook: Orderbook) => void> = new Set();
  private tradesCallbacks: Set<(trade: Trade) => void> = new Set();

  setAdapter(adapter: BinanceAdapter): void {
    this.adapter = adapter;
  }

  subscribeOrderbook(callback: (orderbook: Orderbook) => void): void {
    this.orderbookCallbacks.add(callback);
  }

  subscribeTrades(callback: (trade: Trade) => void): void {
    this.tradesCallbacks.add(callback);
  }

  start(symbol: string): void {
    if (!this.adapter) {
      throw new Error('Adapter not set');
    }

    this.adapter.subscribeOrderbook(symbol, (orderbook) => {
      this.orderbookCallbacks.forEach((cb) => cb(orderbook));
    });

    this.adapter.subscribeTrades(symbol, (trade) => {
      this.tradesCallbacks.forEach((cb) => cb(trade));
    });

    logger.info({ symbol }, 'WebSocket listeners started');
  }

  stop(): void {
    if (this.adapter) {
      this.adapter.disconnect();
    }
    this.orderbookCallbacks.clear();
    this.tradesCallbacks.clear();
    logger.info('WebSocket listeners stopped');
  }
}

