/**
 * Liquidity Strategy Module
 * Analyzes orderbook liquidity based on spread and depth
 */

export interface OrderbookSnapshot {
  bids: Array<{ price: string; quantity: string }>;
  asks: Array<{ price: string; quantity: string }>;
  symbol?: string;
}

export interface LiquidityResult {
  spread: number; // Absolute spread (ask - bid)
  spreadPercent: number; // Spread as percentage of mid price
  signal: 'High' | 'Medium' | 'Low';
  bidDepth: number; // Total bid volume
  askDepth: number; // Total ask volume
  depthImbalance: number; // Depth imbalance ratio
}

/**
 * Analyze liquidity from orderbook
 * Signal logic:
 * - Spread < 0.15% → High liquidity
 * - Spread between 0.15% and 0.4% → Medium liquidity
 * - Spread > 0.4% → Low liquidity
 * 
 * @param orderbook Orderbook snapshot with bids and asks
 * @param depthLevels Number of levels to analyze for depth (default: 5)
 */
export function analyzeLiquidity(
  orderbook: OrderbookSnapshot,
  depthLevels: number = 5
): LiquidityResult {
  if (!orderbook.bids || !orderbook.asks || orderbook.bids.length === 0 || orderbook.asks.length === 0) {
    return {
      spread: 0,
      spreadPercent: 0,
      signal: 'Low',
      bidDepth: 0,
      askDepth: 0,
      depthImbalance: 0,
    };
  }

  // Get top of book (Level 1)
  const bestBid = parseFloat(orderbook.bids[0]?.price || '0');
  const bestAsk = parseFloat(orderbook.asks[0]?.price || '0');

  if (bestBid <= 0 || bestAsk <= 0 || bestAsk <= bestBid) {
    return {
      spread: 0,
      spreadPercent: 0,
      signal: 'Low',
      bidDepth: 0,
      askDepth: 0,
      depthImbalance: 0,
    };
  }

  // Calculate spread
  const spread = bestAsk - bestBid;
  const midPrice = (bestBid + bestAsk) / 2;
  const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

  // Calculate depth from top N levels
  const topBids = orderbook.bids.slice(0, depthLevels);
  const topAsks = orderbook.asks.slice(0, depthLevels);
  
  const bidDepth = topBids.reduce((sum, bid) => {
    return sum + parseFloat(bid.quantity || '0') * parseFloat(bid.price || '0');
  }, 0);

  const askDepth = topAsks.reduce((sum, ask) => {
    return sum + parseFloat(ask.quantity || '0') * parseFloat(ask.price || '0');
  }, 0);

  const totalDepth = bidDepth + askDepth;
  const depthImbalance = totalDepth > 0 
    ? Math.abs((bidDepth - askDepth) / totalDepth)
    : 0;

  // Determine signal based on spread thresholds
  let signal: 'High' | 'Medium' | 'Low';
  if (spreadPercent < 0.15) {
    signal = 'High';
  } else if (spreadPercent >= 0.15 && spreadPercent <= 0.4) {
    signal = 'Medium';
  } else {
    signal = 'Low';
  }

  // Adjust for extremely lopsided depth (e.g. 90% volume on one side)
  // If depth is very imbalanced, downgrade liquidity signal
  if (depthImbalance > 0.9) {
    if (signal === 'High') {
      signal = 'Medium';
    } else if (signal === 'Medium') {
      signal = 'Low';
    }
  }

  return {
    spread,
    spreadPercent,
    signal,
    bidDepth,
    askDepth,
    depthImbalance,
  };
}

