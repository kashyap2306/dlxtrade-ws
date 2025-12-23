export interface Order {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET';
  quantity: number;
  price?: number;
  status: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED' | 'REJECTED';
  clientOrderId: string;
  exchangeOrderId?: string;
  filledQty: number;
  avgPrice: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Fill {
  id: string;
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  fee: number;
  feeAsset: string;
  timestamp: Date;
}

export interface OrderbookLevel {
  price: string;
  quantity: string;
}

export interface Orderbook {
  symbol: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  lastUpdateId: number;
}

export interface Trade {
  id: string;
  symbol: string;
  price: string;
  quantity: string;
  time: number;
  isBuyerMaker: boolean;
}

export interface Quote {
  symbol: string;
  bidPrice: number;
  bidQty: number;
  askPrice: number;
  askQty: number;
  timestamp: number;
}

export interface EngineConfig {
  symbol: string;
  quoteSize: number;
  adversePct: number;
  cancelMs: number;
  maxPos: number;
  enabled: boolean;
}

export interface ApiKey {
  id: string;
  exchange: string;
  name: string;
  apiKey: string; // encrypted
  apiSecret: string; // encrypted
  testnet: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PnL {
  date: string;
  realized: number;
  unrealized: number;
  total: number;
}

export interface RiskLimits {
  maxDailyPnL: number;
  maxDrawdown: number;
  maxPosition: number;
  circuitBreaker: boolean;
}

export interface BacktestSnapshot {
  symbol: string;
  timestamp: number;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  trades?: Trade[];
}

