import { Strategy, TradeDecision, ResearchResult, StrategyConfig } from './index';
import type { Orderbook } from '../types';
import { logger } from '../utils/logger';

export class OrderbookImbalanceStrategy implements Strategy {
  name = 'orderbook_imbalance';

  async init(uid: string, config: StrategyConfig): Promise<void> {
    this.setConfig(uid, config);
    logger.info({ uid, strategy: this.name }, 'Orderbook Imbalance strategy initialized');
  }

  async onResearch(
    uid: string,
    researchResult: ResearchResult,
    orderbook: Orderbook
  ): Promise<TradeDecision | null> {
    const config = this.getConfig(uid);
    if (!config) return null;

    // Use research signal and imbalance
    if (researchResult.signal === 'HOLD') {
      return null;
    }

    const bestBid = parseFloat(orderbook.bids[0]?.price || '0');
    const bestAsk = parseFloat(orderbook.asks[0]?.price || '0');
    const midPrice = (bestBid + bestAsk) / 2;

    // Calculate orderbook imbalance
    const bidVolume = orderbook.bids.slice(0, 10).reduce(
      (sum, level) => sum + parseFloat(level.quantity),
      0
    );
    const askVolume = orderbook.asks.slice(0, 10).reduce(
      (sum, level) => sum + parseFloat(level.quantity),
      0
    );
    const totalVolume = bidVolume + askVolume;
    const imbalance = totalVolume > 0 ? (bidVolume - askVolume) / totalVolume : 0;

    // Determine trade based on signal and imbalance
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let price = midPrice;
    const stopLossPct = 0.005; // 0.5%
    const takeProfitPct = 0.01; // 1%
    let stopLoss: number | undefined;
    let takeProfit: number | undefined;

    if (researchResult.signal === 'BUY' && imbalance > 0.1) {
      action = 'BUY';
      price = bestBid * 1.0001; // Slightly above best bid for aggressive fill
      stopLoss = price * (1 - stopLossPct);
      takeProfit = price * (1 + takeProfitPct);
    } else if (researchResult.signal === 'SELL' && imbalance < -0.1) {
      action = 'SELL';
      price = bestAsk * 0.9999; // Slightly below best ask for aggressive fill
      stopLoss = price * (1 + stopLossPct);
      takeProfit = price * (1 - takeProfitPct);
    } else {
      return null;
    }

    return {
      action,
      quantity: config.quoteSize,
      price,
      type: 'LIMIT',
      reason: `Orderbook imbalance: ${(imbalance * 100).toFixed(2)}%, Signal: ${researchResult.signal}`,
      stopLoss,
      takeProfit,
    };
  }

  async onOrderUpdate(uid: string, orderStatus: any): Promise<void> {
    // Exit monitoring can be integrated here if order updates report fills and price updates are available.
  }

  async shutdown(uid: string): Promise<void> {
    logger.info({ uid }, 'Orderbook Imbalance strategy shut down');
  }

  private userConfigs: Map<string, StrategyConfig> = new Map();

  private getConfig(uid: string): StrategyConfig | null {
    return this.userConfigs.get(uid) || null;
  }

  setConfig(uid: string, config: StrategyConfig): void {
    this.userConfigs.set(uid, config);
  }
}

export const orderbookImbalanceStrategy = new OrderbookImbalanceStrategy();

