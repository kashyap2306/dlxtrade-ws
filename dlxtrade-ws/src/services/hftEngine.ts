import { BinanceAdapter } from './binanceAdapter';
import { OrderManager } from './orderManager';
import { firestoreAdapter, type HFTSettingsDocument } from './firestoreAdapter';
import { userRiskManager } from './userRiskManager';
import { metricsService } from './metricsService';
import { logger } from '../utils/logger';
import type { Orderbook, Order } from '../types';

interface PendingOrder {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  placedAt: number;
  cancelTimer?: NodeJS.Timeout;
}

type HFTSettings = HFTSettingsDocument;

export class HFTEngine {
  private adapter: BinanceAdapter | null = null;
  private orderManager: OrderManager | null = null;
  private uid: string | null = null;
  private isRunning: boolean = false;
  private tradingInterval: NodeJS.Timeout | null = null;
  private wsClients: Set<any> = new Set();
  
  // Per-user state
  private pendingOrders: Map<string, PendingOrder[]> = new Map(); // uid -> orders
  private userInventory: Map<string, number> = new Map(); // uid -> net position
  private dailyTradeCount: Map<string, { count: number; date: string }> = new Map(); // uid -> trade count

  setAdapter(adapter: BinanceAdapter): void {
    this.adapter = adapter;
  }

  setOrderManager(orderManager: OrderManager): void {
    this.orderManager = orderManager;
  }

  setUserId(uid: string): void {
    this.uid = uid;
  }

  registerWebSocketClient(ws: any): void {
    this.wsClients.add(ws);
  }

  unregisterWebSocketClient(ws: any): void {
    this.wsClients.delete(ws);
  }

  private broadcast(data: any): void {
    const message = JSON.stringify(data);
    this.wsClients.forEach((ws) => {
      try {
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(message);
        }
      } catch (err) {
        logger.error({ err }, 'Error broadcasting to WebSocket client');
      }
    });
  }

  async start(symbol: string, intervalMs: number = 100): Promise<void> {
    if (this.isRunning) {
      throw new Error('HFT engine already running');
    }

    if (!this.uid || !this.adapter || !this.orderManager) {
      throw new Error('HFT engine not initialized');
    }

    this.isRunning = true;
    logger.info({ uid: this.uid, symbol, interval: intervalMs }, 'HFT engine started');

    // Start user data stream to listen for order updates
    try {
      const { UserStreamListener } = await import('../workers/userStreamListener');
      const userStreamListener = new UserStreamListener();
      userStreamListener.setAdapter(this.adapter);
      
      // Subscribe to order updates
      userStreamListener.subscribeOrderUpdates((order) => {
        this.onOrderUpdate({
          id: order.id,
          symbol: order.symbol,
          status: order.status,
          filledQty: order.filledQty,
          avgPrice: order.avgPrice,
        });
      });
      
      await userStreamListener.start();
      (this as any).userStreamListener = userStreamListener;
    } catch (err) {
      logger.warn({ err, uid: this.uid }, 'Could not start user stream listener (non-critical)');
    }

    // Start high-frequency trading loop
    this.tradingInterval = setInterval(async () => {
      try {
        await this.runHFTCycle(symbol);
      } catch (err) {
        logger.error({ err, uid: this.uid }, 'Error in HFT cycle');
      }
    }, intervalMs);

    // Run first cycle immediately
    await this.runHFTCycle(symbol);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.tradingInterval) {
      clearInterval(this.tradingInterval);
      this.tradingInterval = null;
    }

    // Stop user stream listener
    if ((this as any).userStreamListener) {
      try {
        await (this as any).userStreamListener.stop();
      } catch (err) {
        logger.warn({ err, uid: this.uid }, 'Error stopping user stream listener');
      }
    }

    // Cancel all pending orders
    if (this.uid && this.orderManager) {
      const pending = this.pendingOrders.get(this.uid) || [];
      for (const order of pending) {
        try {
          await this.orderManager.cancelOrder(this.uid, order.orderId);
          if (order.cancelTimer) {
            clearTimeout(order.cancelTimer);
          }
        } catch (err) {
          logger.error({ err, uid: this.uid, orderId: order.orderId }, 'Error canceling order on stop');
        }
      }
      this.pendingOrders.delete(this.uid);
    }

    logger.info({ uid: this.uid }, 'HFT engine stopped');
  }

  private async runHFTCycle(symbol: string): Promise<void> {
    if (!this.uid || !this.adapter || !this.orderManager) return;

    // Get HFT settings
    const settings = await firestoreAdapter.getHFTSettings(this.uid);
    if (!settings || !settings.enabled) {
      return;
    }

    // Check trade frequency limit
    if (!this.canTradeMore(settings.maxTradesPerDay)) {
      logger.debug({ uid: this.uid }, 'HFT trade frequency limit reached');
      return;
    }

    // Get current orderbook
    const orderbook = await this.adapter.getOrderbook(symbol, 20);
    
    // Calculate spread and liquidity metrics
    const bestBid = parseFloat(orderbook.bids[0]?.price || '0');
    const bestAsk = parseFloat(orderbook.asks[0]?.price || '0');
    const midPrice = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;
    const spreadPct = midPrice > 0 ? (spread / midPrice) * 100 : 0;
    const minSpreadPct = settings.minSpreadPct || 0.01;

    // Check if spread is sufficient
    if (spreadPct < minSpreadPct) {
      return; // Spread too tight, skip
    }

    // Get current inventory
    const inventory = this.userInventory.get(this.uid) || 0;
    const maxPos = settings.maxPos || 0.01;

    // Cancel adverse orders
    await this.cancelAdverseOrders(midPrice, settings);

    // Place maker orders based on inventory
    if (Math.abs(inventory) < maxPos * 0.3) {
      // Neutral inventory - place both sides
      await this.placeMakerOrders(symbol, bestBid, bestAsk, settings, orderbook);
    } else if (inventory > maxPos * 0.3) {
      // Too long - only place sell orders
      await this.placeSellOrder(symbol, bestAsk, settings, orderbook);
    } else if (inventory < -maxPos * 0.3) {
      // Too short - only place buy orders
      await this.placeBuyOrder(symbol, bestBid, settings, orderbook);
    }
  }

  private async placeMakerOrders(
    symbol: string,
    bestBid: number,
    bestAsk: number,
    settings: HFTSettings,
    orderbook: Orderbook
  ): Promise<void> {
    if (!this.uid || !this.orderManager) return;

    const bidPrice = bestBid * (1 - settings.adversePct * 0.5);
    const askPrice = bestAsk * (1 + settings.adversePct * 0.5);

    try {
      // Place bid order
      const bidOrder = await this.orderManager.placeOrder(this.uid, {
        symbol,
        side: 'BUY',
        type: 'LIMIT',
        quantity: settings.quoteSize,
        price: bidPrice,
      });

      if (bidOrder) {
        this.addPendingOrder({
          orderId: bidOrder.id,
          symbol,
          side: 'BUY',
          price: bidPrice,
          quantity: settings.quoteSize,
          placedAt: Date.now(),
        });
        this.scheduleCancel(bidOrder.id, settings.cancelMs);
        this.incrementTradeCount();
        
        await this.logHFTExecution('BID_PLACED', symbol, bidOrder, settings);
      }

      // Place ask order
      const askOrder = await this.orderManager.placeOrder(this.uid, {
        symbol,
        side: 'SELL',
        type: 'LIMIT',
        quantity: settings.quoteSize,
        price: askPrice,
      });

      if (askOrder) {
        this.addPendingOrder({
          orderId: askOrder.id,
          symbol,
          side: 'SELL',
          price: askPrice,
          quantity: settings.quoteSize,
          placedAt: Date.now(),
        });
        this.scheduleCancel(askOrder.id, settings.cancelMs);
        this.incrementTradeCount();
        
        await this.logHFTExecution('ASK_PLACED', symbol, askOrder, settings);
      }

      this.broadcast({
        type: 'hft:quote',
        data: {
          symbol,
          bidPrice,
          askPrice,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      logger.error({ err, uid: this.uid }, 'Error placing maker orders');
    }
  }

  private async placeBuyOrder(
    symbol: string,
    bestBid: number,
    settings: HFTSettings,
    orderbook: Orderbook
  ): Promise<void> {
    if (!this.uid || !this.orderManager) return;

    const bidPrice = bestBid * (1 - settings.adversePct * 0.5);

    try {
      const bidOrder = await this.orderManager.placeOrder(this.uid, {
        symbol,
        side: 'BUY',
        type: 'LIMIT',
        quantity: settings.quoteSize,
        price: bidPrice,
      });

      if (bidOrder) {
        this.addPendingOrder({
          orderId: bidOrder.id,
          symbol,
          side: 'BUY',
          price: bidPrice,
          quantity: settings.quoteSize,
          placedAt: Date.now(),
        });
        this.scheduleCancel(bidOrder.id, settings.cancelMs);
        this.incrementTradeCount();
        
        await this.logHFTExecution('BID_PLACED', symbol, bidOrder, settings);
      }
    } catch (err) {
      logger.error({ err, uid: this.uid }, 'Error placing buy order');
    }
  }

  private async placeSellOrder(
    symbol: string,
    bestAsk: number,
    settings: HFTSettings,
    orderbook: Orderbook
  ): Promise<void> {
    if (!this.uid || !this.orderManager) return;

    const askPrice = bestAsk * (1 + settings.adversePct * 0.5);

    try {
      const askOrder = await this.orderManager.placeOrder(this.uid, {
        symbol,
        side: 'SELL',
        type: 'LIMIT',
        quantity: settings.quoteSize,
        price: askPrice,
      });

      if (askOrder) {
        this.addPendingOrder({
          orderId: askOrder.id,
          symbol,
          side: 'SELL',
          price: askPrice,
          quantity: settings.quoteSize,
          placedAt: Date.now(),
        });
        this.scheduleCancel(askOrder.id, settings.cancelMs);
        this.incrementTradeCount();
        
        await this.logHFTExecution('ASK_PLACED', symbol, askOrder, settings);
      }
    } catch (err) {
      logger.error({ err, uid: this.uid }, 'Error placing sell order');
    }
  }

  private async cancelAdverseOrders(currentMidPrice: number, settings: HFTSettings): Promise<void> {
    if (!this.uid || !this.orderManager) return;

    const pending = this.pendingOrders.get(this.uid) || [];

    for (const order of pending) {
      const priceMove = order.side === 'BUY'
        ? (currentMidPrice - order.price) / order.price
        : (order.price - currentMidPrice) / order.price;

      if (priceMove > settings.adversePct) {
        try {
          await this.orderManager.cancelOrder(this.uid, order.orderId);
          if (order.cancelTimer) {
            clearTimeout(order.cancelTimer);
          }
          this.removePendingOrder(order.orderId);
          metricsService.recordCancel(this.uid, 'market_making_hft');
          
          await this.logHFTExecution('CANCELED', order.symbol, null, settings, `Adverse price move: ${(priceMove * 100).toFixed(2)}%`);
        } catch (err) {
          logger.error({ err, uid: this.uid, orderId: order.orderId }, 'Error canceling adverse order');
        }
      }
    }
  }

  private scheduleCancel(orderId: string, cancelMs: number): void {
    if (!this.uid) return;

    const pending = this.pendingOrders.get(this.uid) || [];
    const order = pending.find((o) => o.orderId === orderId);
    if (order) {
      order.cancelTimer = setTimeout(async () => {
        if (this.orderManager && this.uid) {
          try {
            await this.orderManager.cancelOrder(this.uid, orderId);
            this.removePendingOrder(orderId);
            metricsService.recordCancel(this.uid, 'market_making_hft');
            
            const settings = await firestoreAdapter.getHFTSettings(this.uid);
            await this.logHFTExecution('CANCELED', order.symbol, null, settings, `Auto-canceled after ${cancelMs}ms`);
          } catch (err) {
            logger.error({ err, uid: this.uid, orderId }, 'Error auto-canceling order');
          }
        }
      }, cancelMs);
    }
  }

  private addPendingOrder(order: PendingOrder): void {
    if (!this.uid) return;
    const pending = this.pendingOrders.get(this.uid) || [];
    pending.push(order);
    this.pendingOrders.set(this.uid, pending);
  }

  private removePendingOrder(orderId: string): void {
    if (!this.uid) return;
    const pending = this.pendingOrders.get(this.uid) || [];
    const filtered = pending.filter((o) => o.orderId !== orderId);
    this.pendingOrders.set(this.uid, filtered);
  }

  private canTradeMore(maxTradesPerDay: number): boolean {
    if (!this.uid) return false;
    
    const today = new Date().toISOString().split('T')[0];
    const tradeCount = this.dailyTradeCount.get(this.uid);
    
    if (!tradeCount || tradeCount.date !== today) {
      this.dailyTradeCount.set(this.uid, { count: 0, date: today });
      return true;
    }
    
    return tradeCount.count < maxTradesPerDay;
  }

  private incrementTradeCount(): void {
    if (!this.uid) return;
    
    const today = new Date().toISOString().split('T')[0];
    const tradeCount = this.dailyTradeCount.get(this.uid);
    
    if (!tradeCount || tradeCount.date !== today) {
      this.dailyTradeCount.set(this.uid, { count: 1, date: today });
    } else {
      tradeCount.count++;
    }
  }

  private async logHFTExecution(
    action: string,
    symbol: string,
    order: Order | null,
    settings: HFTSettings,
    reason?: string
  ): Promise<void> {
    if (!this.uid) return;

    const admin = await import('firebase-admin');
    await firestoreAdapter.saveHFTExecutionLog(this.uid, {
      symbol,
      timestamp: admin.firestore.Timestamp.now(),
      action,
      orderId: order?.id,
      orderIds: order ? [order.id] : undefined,
      price: order?.price,
      quantity: order?.quantity,
      side: order?.side,
      reason,
      strategy: 'market_making_hft',
      status: order?.status,
    });
  }

  async onOrderUpdate(orderStatus: any): Promise<void> {
    if (!this.uid) return;

    if (orderStatus.status === 'FILLED' || orderStatus.status === 'PARTIALLY_FILLED') {
      const pending = this.pendingOrders.get(this.uid) || [];
      const order = pending.find((o) => o.orderId === orderStatus.id);
      
      if (order) {
        const qty = orderStatus.filledQty || order.quantity;
        const currentInventory = this.userInventory.get(this.uid) || 0;
        
        if (order.side === 'BUY') {
          this.userInventory.set(this.uid, currentInventory + qty);
        } else {
          this.userInventory.set(this.uid, currentInventory - qty);
        }

        // Log fill
        const admin = await import('firebase-admin');
        const settings = await firestoreAdapter.getHFTSettings(this.uid);
        await firestoreAdapter.saveHFTExecutionLog(this.uid, {
          symbol: orderStatus.symbol || 'UNKNOWN',
          timestamp: admin.firestore.Timestamp.now(),
          action: 'FILLED',
          orderId: order.orderId,
          price: orderStatus.avgPrice || order.price,
          quantity: qty,
          side: order.side,
          strategy: 'market_making_hft',
          status: orderStatus.status,
        });

        if (orderStatus.status === 'FILLED') {
          this.removePendingOrder(order.orderId);
        }
      }
    }
  }

  getStatus(): { running: boolean; hasEngine: boolean } {
    return {
      running: this.isRunning,
      hasEngine: !!this.adapter && !!this.orderManager && !!this.uid,
    };
  }
}

