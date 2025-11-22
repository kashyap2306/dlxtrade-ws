import { firestoreAdapter } from './firestoreAdapter';
import type { ExchangeConnector } from './exchangeConnector';

class TradingEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TradingEngineError';
  }
}

type TokenBucketState = {
  capacity: number;
  tokens: number;
  refillPerMs: number;
  lastRefill: number;
};

type TradingOrderOptions = {
  clientOrderId?: string;
  reduceOnly?: boolean;
  rateLimitPerMinute?: number;
};

export interface TradingOrderResponse {
  success: boolean;
  orderId?: string;
  price?: number;
  filledQty?: number;
  raw?: any;
}

export interface TradingBalanceSummary {
  totalUSDT: number;
  availableUSDT: number;
  raw: any;
}

export interface TradingPositionSummary {
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice?: number;
  leverage?: number;
  raw: any;
}

class TradingEngine {
  private buckets: Map<string, TokenBucketState> = new Map();
  private balanceCache: Map<string, { value: TradingBalanceSummary; expires: number }> = new Map();

  private getBucket(key: string, limitPerMinute: number): TokenBucketState {
    const capacity = Math.max(limitPerMinute, 1);
    const refillPerMs = capacity / 60000;
    if (!this.buckets.has(key)) {
      this.buckets.set(key, {
        capacity,
        tokens: capacity,
        refillPerMs,
        lastRefill: Date.now(),
      });
    }
    return this.buckets.get(key)!;
  }

  private consumeToken(key: string, limitPerMinute: number) {
    const bucket = this.getBucket(key, limitPerMinute);
    const now = Date.now();
    const delta = now - bucket.lastRefill;
    if (delta > 0) {
      const refill = delta * bucket.refillPerMs;
      bucket.tokens = Math.min(bucket.capacity, bucket.tokens + refill);
      bucket.lastRefill = now;
    }
    if (bucket.tokens < 1) {
      throw new TradingEngineError('Rate limit exceeded for trading operations');
    }
    bucket.tokens -= 1;
  }

  private async requireContext(uid: string) {
    const context = await firestoreAdapter.getActiveExchangeForUser(uid);
    if (!context || context.name === 'fallback' || !context.adapter) {
      throw new TradingEngineError('No active exchange integration configured');
    }
    return context;
  }

  private normalizeBalance(raw: any): TradingBalanceSummary {
    if (!raw) {
      return { totalUSDT: 0, availableUSDT: 0, raw };
    }

    if (Array.isArray(raw)) {
      const usdtEntry = raw.find((entry) => {
        const coin = entry.coin || entry.currency || entry.marginCoin || entry.asset;
        return typeof coin === 'string' && coin.toUpperCase().includes('USDT');
      });
      if (usdtEntry) {
        const total = parseFloat(usdtEntry.equity || usdtEntry.available || usdtEntry.balance || usdtEntry.total || '0');
        const available = parseFloat(usdtEntry.available || usdtEntry.free || '0');
        return { totalUSDT: total || 0, availableUSDT: available || total || 0, raw };
      }
    }

    if (typeof raw === 'object') {
      const total = parseFloat(raw.totalEquity || raw.equity || raw.balance || '0');
      const available = parseFloat(raw.available || raw.free || total || '0');
      return { totalUSDT: total || 0, availableUSDT: available || total || 0, raw };
    }

    return { totalUSDT: 0, availableUSDT: 0, raw };
  }

  private normalizePositions(raw: any, symbolFilter?: string): TradingPositionSummary[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((pos: any) => {
        const symbol = pos.symbol || pos.instId || pos.productId || '';
        const rawSide = String(pos.holdSide || pos.side || 'long').toUpperCase();
        const side: 'LONG' | 'SHORT' = rawSide.includes('SHORT') ? 'SHORT' : 'LONG';
        return {
          symbol,
          side,
          size: parseFloat(pos.size || pos.holdVol || pos.positionAmt || '0'),
          entryPrice: pos.averageOpenPrice ? parseFloat(pos.averageOpenPrice) : undefined,
          leverage: pos.leverage ? parseFloat(pos.leverage) : undefined,
          raw: pos,
        };
      })
      .filter(
        (p) =>
          p.size > 0 &&
          (!symbolFilter ||
            p.symbol?.toUpperCase().includes(symbolFilter.replace(/[^A-Z0-9]/gi, '').toUpperCase()))
      );
  }

  async getBalance(uid: string, { forceRefresh = false } = {}): Promise<TradingBalanceSummary> {
    const cacheKey = `bal:${uid}`;
    const cached = this.balanceCache.get(cacheKey);
    if (cached && cached.expires > Date.now() && !forceRefresh) {
      return cached.value;
    }

    const context = await this.requireContext(uid);
    if (typeof context.adapter.getBalance === 'function') {
      const rawBalance = await context.adapter.getBalance();
      const summary = this.normalizeBalance(rawBalance);
      this.balanceCache.set(cacheKey, { value: summary, expires: Date.now() + 10_000 });
      return summary;
    }

    if (typeof context.adapter.getAccount === 'function') {
      const rawBalance = await context.adapter.getAccount();
      const summary = this.normalizeBalance(rawBalance?.data || rawBalance);
      this.balanceCache.set(cacheKey, { value: summary, expires: Date.now() + 10_000 });
      return summary;
    }

    throw new TradingEngineError('Exchange adapter does not expose balance APIs');
  }

  async getPositions(uid: string, symbol?: string): Promise<TradingPositionSummary[]> {
    const context = await this.requireContext(uid);
    if (typeof context.adapter.getPositions === 'function') {
      const rawPositions = await context.adapter.getPositions(symbol);
      return this.normalizePositions(rawPositions, symbol);
    }
    return [];
  }

  async placeMarketOrder(
    uid: string,
    symbol: string,
    side: 'BUY' | 'SELL',
    size: number,
    options: TradingOrderOptions = {}
  ): Promise<TradingOrderResponse> {
    if (size <= 0 || !isFinite(size)) {
      throw new TradingEngineError('Order size must be greater than zero');
    }

    const context = await this.requireContext(uid);
    this.consumeToken(
      `${uid}:${context.name}:orders`,
      options.rateLimitPerMinute ?? 30
    );

    if (typeof context.adapter.placeOrder !== 'function') {
      throw new TradingEngineError('Exchange adapter does not support order placement');
    }

    const raw = await context.adapter.placeOrder({
      symbol,
      side,
      type: 'MARKET',
      quantity: size,
      ...(options.clientOrderId ? { clientOrderId: options.clientOrderId } : {}),
      ...(options.reduceOnly ? { reduceOnly: true } : {}),
    });

    const normalized: TradingOrderResponse = {
      success: true,
      orderId: raw.orderId || raw.id || raw.clientOrderId || raw.exchangeOrderId,
      price: raw.price
        ? parseFloat(raw.price)
        : raw.avgPrice
        ? parseFloat(raw.avgPrice)
        : raw.fillPrice
        ? parseFloat(raw.fillPrice)
        : undefined,
      filledQty: raw.executedQty
        ? parseFloat(raw.executedQty)
        : raw.quantity
        ? parseFloat(raw.quantity)
        : size,
      raw,
    };

    return normalized;
  }

  async closePosition(uid: string, symbol: string): Promise<TradingOrderResponse | null> {
    const positions = await this.getPositions(uid, symbol);
    if (!positions.length) {
      return null;
    }
    const position = positions[0];
    const side: 'BUY' | 'SELL' = position.side === 'LONG' ? 'SELL' : 'BUY';
    const response = await this.placeMarketOrder(uid, symbol, side, position.size, {
      reduceOnly: true,
    });
    return response;
  }
}

export const tradingEngine = new TradingEngine();
export { TradingEngineError, TradingEngine };

