import { Strategy, TradeDecision, ResearchResult, StrategyConfig } from './index';
import type { Orderbook } from '../types';
import { BinanceAdapter } from '../services/binanceAdapter';
import { OrderManager } from '../services/orderManager';
import { metricsService } from '../services/metricsService';
import { logger } from '../utils/logger';

interface PendingOrder {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  placedAt: number;
  cancelTimer?: NodeJS.Timeout;
}

export class MarketMakingHFTStrategy implements Strategy {
  name = 'market_making_hft';
  private userConfigs: Map<string, StrategyConfig> = new Map();
  private userAdapters: Map<string, BinanceAdapter> = new Map();
  private userOrderManagers: Map<string, OrderManager> = new Map();
  private pendingOrders: Map<string, PendingOrder[]> = new Map(); // uid -> orders
  private userInventory: Map<string, number> = new Map(); // uid -> net position

  async init(uid: string, config: StrategyConfig): Promise<void> {
    this.userConfigs.set(uid, config);
    logger.info({ uid, strategy: this.name }, 'Market Making HFT strategy initialized');
  }

  setAdapter(uid: string, adapter: BinanceAdapter): void {
    this.userAdapters.set(uid, adapter);
  }

  setOrderManager(uid: string, orderManager: OrderManager): void {
    this.userOrderManagers.set(uid, orderManager);
  }

  async onResearch(
    uid: string,
    researchResult: ResearchResult,
    orderbook: Orderbook
  ): Promise<TradeDecision | null> {
    const config = this.userConfigs.get(uid);
    if (!config) {
      logger.warn({ uid }, 'Strategy not initialized');
      return null;
    }

    // Only execute if accuracy is high (this is checked by accuracyEngine, but double-check)
    if (researchResult.accuracy < 0.85) {
      return null;
    }

    const adapter = this.userAdapters.get(uid);
    const orderManager = this.userOrderManagers.get(uid);
    if (!adapter || !orderManager) {
      logger.warn({ uid }, 'Adapter or order manager not set');
      return null;
    }

    const bestBid = parseFloat(orderbook.bids[0]?.price || '0');
    const bestAsk = parseFloat(orderbook.asks[0]?.price || '0');
    const midPrice = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;
    const minSpread = config.minSpread || spread * 0.5;

    // Check if spread is too tight
    if (spread < minSpread) {
      return null;
    }

    // Get current inventory
    const inventory = this.userInventory.get(uid) || 0;
    const maxPos = config.maxPos || 0.01;

    // Cancel old pending orders if price moved adversely
    await this.cancelAdverseOrders(uid, midPrice, config);

    // Place maker orders on both sides if inventory is neutral
    if (Math.abs(inventory) < maxPos * 0.3) {
      // Place bid (buy) order
      const bidPrice = bestBid * (1 - config.adversePct * 0.5); // Slightly below best bid
      const bidQty = config.quoteSize;

      // Place ask (sell) order
      const askPrice = bestAsk * (1 + config.adversePct * 0.5); // Slightly above best ask
      const askQty = config.quoteSize;

      try {
        // Place bid order
        const bidOrder = await orderManager.placeOrder(uid, {
          symbol: researchResult.symbol,
          side: 'BUY',
          type: 'LIMIT',
          quantity: bidQty,
          price: bidPrice,
        });

        if (bidOrder) {
          this.addPendingOrder(uid, {
            orderId: bidOrder.id,
            symbol: researchResult.symbol,
            side: 'BUY',
            price: bidPrice,
            quantity: bidQty,
            placedAt: Date.now(),
          });
          this.scheduleCancel(uid, bidOrder.id, config.cancelMs);
        }

        // Place ask order
        const askOrder = await orderManager.placeOrder(uid, {
          symbol: researchResult.symbol,
          side: 'SELL',
          type: 'LIMIT',
          quantity: askQty,
          price: askPrice,
        });

        if (askOrder) {
          this.addPendingOrder(uid, {
            orderId: askOrder.id,
            symbol: researchResult.symbol,
            side: 'SELL',
            price: askPrice,
            quantity: askQty,
            placedAt: Date.now(),
          });
          this.scheduleCancel(uid, askOrder.id, config.cancelMs);
        }

        // Log quote placement event
        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const admin = await import('firebase-admin');
        const orderIds = [bidOrder?.id, askOrder?.id].filter(Boolean) as string[];
        
        await firestoreAdapter.saveExecutionLog(uid, {
          symbol: researchResult.symbol,
          timestamp: admin.firestore.Timestamp.now(),
          action: 'EXECUTED',
          accuracy: researchResult.accuracy,
          accuracyUsed: researchResult.accuracy,
          orderIds,
          strategy: 'market_making_hft',
          signal: researchResult.signal,
          status: 'NEW',
          reason: 'Market making quotes placed',
        });

        logger.info(
          { uid, symbol: researchResult.symbol, bidPrice, askPrice, orderIds },
          'Market making orders placed and logged'
        );
      } catch (err) {
        logger.error({ err, uid }, 'Error placing market making orders');
      }
    } else if (inventory > maxPos * 0.3) {
      // Too long, only place sell orders
      const askPrice = bestAsk * (1 + config.adversePct * 0.5);
      const askOrder = await orderManager.placeOrder(uid, {
        symbol: researchResult.symbol,
        side: 'SELL',
        type: 'LIMIT',
        quantity: config.quoteSize,
        price: askPrice,
      });

      if (askOrder) {
        this.addPendingOrder(uid, {
          orderId: askOrder.id,
          symbol: researchResult.symbol,
          side: 'SELL',
          price: askPrice,
          quantity: config.quoteSize,
          placedAt: Date.now(),
        });
        this.scheduleCancel(uid, askOrder.id, config.cancelMs);
      }
    } else if (inventory < -maxPos * 0.3) {
      // Too short, only place buy orders
      const bidPrice = bestBid * (1 - config.adversePct * 0.5);
      const bidOrder = await orderManager.placeOrder(uid, {
        symbol: researchResult.symbol,
        side: 'BUY',
        type: 'LIMIT',
        quantity: config.quoteSize,
        price: bidPrice,
      });

      if (bidOrder) {
        this.addPendingOrder(uid, {
          orderId: bidOrder.id,
          symbol: researchResult.symbol,
          side: 'BUY',
          price: bidPrice,
          quantity: config.quoteSize,
          placedAt: Date.now(),
        });
        this.scheduleCancel(uid, bidOrder.id, config.cancelMs);
      }
    }

    // Return null as we handle orders directly
    return null;
  }

  async onOrderUpdate(uid: string, orderStatus: any): Promise<void> {
    // Update inventory when orders fill
    if (orderStatus.status === 'FILLED' || orderStatus.status === 'PARTIALLY_FILLED') {
      const pending = this.pendingOrders.get(uid) || [];
      const order = pending.find((o) => o.orderId === orderStatus.id);
      if (order) {
        const qty = orderStatus.filledQty || order.quantity;
        const currentInventory = this.userInventory.get(uid) || 0;
        if (order.side === 'BUY') {
          this.userInventory.set(uid, currentInventory + qty);
        } else {
          this.userInventory.set(uid, currentInventory - qty);
        }

        // Log fill event
        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const admin = await import('firebase-admin');
        await firestoreAdapter.saveExecutionLog(uid, {
          symbol: orderStatus.symbol || 'UNKNOWN',
          timestamp: admin.firestore.Timestamp.now(),
          action: 'EXECUTED',
          reason: `Order filled: ${order.side} ${qty} @ ${orderStatus.avgPrice || order.price}`,
          orderId: order.orderId,
          strategy: 'market_making_hft',
          status: orderStatus.status,
        });

        // Remove from pending if fully filled
        if (orderStatus.status === 'FILLED') {
          this.removePendingOrder(uid, order.orderId);
        }
      }
    }
  }

  async shutdown(uid: string): Promise<void> {
    // Cancel all pending orders
    const pending = this.pendingOrders.get(uid) || [];
    const orderManager = this.userOrderManagers.get(uid);
    
    if (orderManager) {
      for (const order of pending) {
        try {
          await orderManager.cancelOrder(uid, order.orderId);
          if (order.cancelTimer) {
            clearTimeout(order.cancelTimer);
          }
        } catch (err) {
          logger.error({ err, uid, orderId: order.orderId }, 'Error canceling order on shutdown');
        }
      }
    }

    this.pendingOrders.delete(uid);
    this.userConfigs.delete(uid);
    this.userAdapters.delete(uid);
    this.userOrderManagers.delete(uid);
    this.userInventory.delete(uid);
    logger.info({ uid }, 'Market Making HFT strategy shut down');
  }

  private addPendingOrder(uid: string, order: PendingOrder): void {
    const pending = this.pendingOrders.get(uid) || [];
    pending.push(order);
    this.pendingOrders.set(uid, pending);
  }

  private removePendingOrder(uid: string, orderId: string): void {
    const pending = this.pendingOrders.get(uid) || [];
    const filtered = pending.filter((o) => o.orderId !== orderId);
    this.pendingOrders.set(uid, filtered);
  }

  private scheduleCancel(uid: string, orderId: string, cancelMs: number): void {
    const pending = this.pendingOrders.get(uid) || [];
    const order = pending.find((o) => o.orderId === orderId);
    if (order) {
      order.cancelTimer = setTimeout(async () => {
        const orderManager = this.userOrderManagers.get(uid);
        if (orderManager) {
          try {
            await orderManager.cancelOrder(uid, orderId);
            this.removePendingOrder(uid, orderId);
            metricsService.recordCancel(uid, 'market_making_hft');
            
            // Log cancel event
            const { firestoreAdapter } = await import('../services/firestoreAdapter');
            const admin = await import('firebase-admin');
            await firestoreAdapter.saveExecutionLog(uid, {
              symbol: order.symbol,
              timestamp: admin.firestore.Timestamp.now(),
              action: 'SKIPPED',
              reason: `Order auto-canceled after ${cancelMs}ms timeout`,
              orderId: order.orderId,
              strategy: 'market_making_hft',
            });
            
            logger.info({ uid, orderId }, 'Order auto-canceled after timeout');
          } catch (err) {
            logger.error({ err, uid, orderId }, 'Error auto-canceling order');
          }
        }
      }, cancelMs);
    }
  }

  private async cancelAdverseOrders(
    uid: string,
    currentMidPrice: number,
    config: StrategyConfig
  ): Promise<void> {
    const pending = this.pendingOrders.get(uid) || [];
    const orderManager = this.userOrderManagers.get(uid);
    if (!orderManager) return;

    for (const order of pending) {
      const priceMove = order.side === 'BUY'
        ? (currentMidPrice - order.price) / order.price
        : (order.price - currentMidPrice) / order.price;

      // If price moved against us by more than adversePct, cancel
      if (priceMove > config.adversePct) {
        try {
          await orderManager.cancelOrder(uid, order.orderId);
          if (order.cancelTimer) {
            clearTimeout(order.cancelTimer);
          }
          this.removePendingOrder(uid, order.orderId);
          metricsService.recordCancel(uid, 'market_making_hft');
          
          // Log cancel event
          const { firestoreAdapter } = await import('../services/firestoreAdapter');
          const admin = await import('firebase-admin');
          await firestoreAdapter.saveExecutionLog(uid, {
            symbol: order.symbol,
            timestamp: admin.firestore.Timestamp.now(),
            action: 'SKIPPED',
            reason: `Order canceled due to adverse price move: ${(priceMove * 100).toFixed(2)}%`,
            orderId: order.orderId,
            strategy: 'market_making_hft',
          });
          
          logger.info({ uid, orderId: order.orderId, priceMove }, 'Order canceled due to adverse move');
        } catch (err) {
          logger.error({ err, uid, orderId: order.orderId }, 'Error canceling adverse order');
        }
      }
    }
  }
}

export const marketMakingHFTStrategy = new MarketMakingHFTStrategy();

