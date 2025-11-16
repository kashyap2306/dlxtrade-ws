import { logger } from '../utils/logger';
import { BinanceAdapter } from './binanceAdapter';
import { orderManager } from './orderManager';
import { riskManager } from './riskManager';
import type { EngineConfig, Orderbook, Quote } from '../types';

export class QuoteEngine {
  private config: EngineConfig;
  private adapter: BinanceAdapter | null = null;
  private isRunning: boolean = false;
  private activeQuotes: Map<string, { bidOrderId?: string; askOrderId?: string; timestamp: number }> = new Map();
  private lastMidPrice: Map<string, number> = new Map();
  private cancelTimers: Map<string, NodeJS.Timeout> = new Map();

  async start(config: EngineConfig, adapter: BinanceAdapter): Promise<void> {
    if (this.isRunning) {
      throw new Error('Engine already running');
    }

    this.config = config;
    this.adapter = adapter;
    this.isRunning = true;

    logger.info({ config }, 'Quote engine started');

    // Subscribe to orderbook updates
    this.adapter.subscribeOrderbook(config.symbol, (orderbook) => {
      this.handleOrderbookUpdate(orderbook);
    });

    // Start quoting loop
    this.quoteLoop();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;

    // Cancel all active quotes
    for (const [symbol, quotes] of this.activeQuotes.entries()) {
      if (quotes.bidOrderId) {
        try {
          await orderManager.cancelOrder(quotes.bidOrderId);
        } catch (err) {
          logger.error({ err, orderId: quotes.bidOrderId }, 'Error canceling bid quote');
        }
      }
      if (quotes.askOrderId) {
        try {
          await orderManager.cancelOrder(quotes.askOrderId);
        } catch (err) {
          logger.error({ err, orderId: quotes.askOrderId }, 'Error canceling ask quote');
        }
      }
    }

    // Clear timers
    for (const timer of this.cancelTimers.values()) {
      clearTimeout(timer);
    }
    this.cancelTimers.clear();
    this.activeQuotes.clear();

    logger.info('Quote engine stopped');
  }

  private async quoteLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.updateQuotes();
        await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms loop
      } catch (err) {
        logger.error({ err }, 'Error in quote loop');
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Back off on error
      }
    }
  }

  private async updateQuotes(): Promise<void> {
    if (!this.adapter || !this.isRunning) return;

    const symbol = this.config.symbol;

    // Check risk limits
    if (!riskManager.canTrade()) {
      logger.warn('Risk manager blocked trading');
      return;
    }

    // Get current orderbook
    const orderbook = await this.adapter.getOrderbook(symbol, 20);
    const midPrice = this.calculateMidPrice(orderbook);
    
    if (!midPrice) return;

    const lastMid = this.lastMidPrice.get(symbol) || midPrice;
    this.lastMidPrice.set(symbol, midPrice);

    const activeQuote = this.activeQuotes.get(symbol);
    const now = Date.now();

    // Check for adverse selection
    if (activeQuote) {
      const priceMove = Math.abs(midPrice - lastMid) / lastMid;
      const timeSinceQuote = now - activeQuote.timestamp;

      if (priceMove > this.config.adversePct && timeSinceQuote < this.config.cancelMs) {
        // Cancel existing quotes due to adverse selection
        logger.info({ symbol, priceMove, timeSinceQuote }, 'Adverse selection detected, canceling quotes');
        await this.cancelQuotes(symbol);
        return;
      }
    }

    // Check if we need to place new quotes
    if (!activeQuote || (now - activeQuote.timestamp) > this.config.cancelMs * 2) {
      await this.placeQuotes(orderbook, midPrice);
    }
  }

  private calculateMidPrice(orderbook: Orderbook): number | null {
    if (orderbook.bids.length === 0 || orderbook.asks.length === 0) {
      return null;
    }

    const bestBid = parseFloat(orderbook.bids[0].price);
    const bestAsk = parseFloat(orderbook.asks[0].price);
    return (bestBid + bestAsk) / 2;
  }

  private async placeQuotes(orderbook: Orderbook, midPrice: number): Promise<void> {
    if (!this.adapter) return;

    const symbol = this.config.symbol;
    const spread = parseFloat(orderbook.asks[0].price) - parseFloat(orderbook.bids[0].price);
    const halfSpread = spread / 2;

    // Calculate quote prices
    const bidPrice = midPrice - halfSpread * 0.5; // Slightly inside the spread
    const askPrice = midPrice + halfSpread * 0.5;

    // Check inventory limits
    const position = await riskManager.getPosition(symbol);
    const maxPos = this.config.maxPos;

    try {
      // Place bid quote if within position limits
      // Note: quoteEngine needs uid - this will be handled by engine manager
      if (position < maxPos) {
        // This will be updated when we create per-user engine instances
        throw new Error('Quote engine requires user context');

        if (bidOrder) {
          const quote = this.activeQuotes.get(symbol) || { timestamp: Date.now() };
          quote.bidOrderId = bidOrder.id;
          this.activeQuotes.set(symbol, quote);

          // Set cancel timer
          const timer = setTimeout(() => {
            this.cancelQuotes(symbol);
          }, this.config.cancelMs);
          this.cancelTimers.set(`${symbol}-bid`, timer);
        }
      }

      // Place ask quote if within position limits
      if (position > -maxPos) {
        const askOrder = await orderManager.placeOrder({
          symbol,
          side: 'SELL',
          type: 'LIMIT',
          quantity: this.config.quoteSize,
          price: askPrice,
        });

        if (askOrder) {
          const quote = this.activeQuotes.get(symbol) || { timestamp: Date.now() };
          quote.askOrderId = askOrder.id;
          this.activeQuotes.set(symbol, quote);

          // Set cancel timer
          const timer = setTimeout(() => {
            this.cancelQuotes(symbol);
          }, this.config.cancelMs);
          this.cancelTimers.set(`${symbol}-ask`, timer);
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error placing quotes');
    }
  }

  private async cancelQuotes(symbol: string): Promise<void> {
    const quote = this.activeQuotes.get(symbol);
    if (!quote) return;

    try {
      if (quote.bidOrderId) {
        await orderManager.cancelOrder(quote.bidOrderId);
        const timer = this.cancelTimers.get(`${symbol}-bid`);
        if (timer) {
          clearTimeout(timer);
          this.cancelTimers.delete(`${symbol}-bid`);
        }
      }
      if (quote.askOrderId) {
        await orderManager.cancelOrder(quote.askOrderId);
        const timer = this.cancelTimers.get(`${symbol}-ask`);
        if (timer) {
          clearTimeout(timer);
          this.cancelTimers.delete(`${symbol}-ask`);
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error canceling quotes');
    }

    this.activeQuotes.delete(symbol);
  }

  private handleOrderbookUpdate(orderbook: Orderbook): void {
    // Update quotes if mid-price moved significantly
    const midPrice = this.calculateMidPrice(orderbook);
    if (!midPrice) return;

    const symbol = orderbook.symbol;
    const lastMid = this.lastMidPrice.get(symbol);
    
    if (lastMid) {
      const priceMove = Math.abs(midPrice - lastMid) / lastMid;
      if (priceMove > this.config.adversePct) {
        this.cancelQuotes(symbol);
      }
    }
  }

  getStatus(): { running: boolean; config: EngineConfig | null } {
    return {
      running: this.isRunning,
      config: this.config || null,
    };
  }
}

export const quoteEngine = new QuoteEngine();

