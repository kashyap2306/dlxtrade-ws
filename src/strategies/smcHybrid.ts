import { Strategy, TradeDecision, ResearchResult, StrategyConfig } from './index';
import type { Orderbook } from '../types';
import { logger } from '../utils/logger';

export class SMCHybridStrategy implements Strategy {
  name = 'smc_hybrid';

  async init(uid: string, config: StrategyConfig): Promise<void> {
    this.setConfig(uid, config);
    logger.info({ uid, strategy: this.name }, 'SMC Hybrid strategy initialized');
  }

  async onResearch(
    uid: string,
    researchResult: ResearchResult,
    orderbook: Orderbook
  ): Promise<TradeDecision | null> {
    const config = this.getConfig(uid);
    if (!config) return null;

    // Smart Money Concept + confirmation filters
    if (researchResult.signal === 'HOLD') {
      return null;
    }

    // Check micro-signals for confirmation
    const microSignals = researchResult.microSignals || {};
    const confirmations = this.countConfirmations(microSignals, researchResult.signal);

    // Require at least 2 confirmations
    if (confirmations < 2) {
      return null;
    }

    const bestBid = parseFloat(orderbook.bids[0]?.price || '0');
    const bestAsk = parseFloat(orderbook.asks[0]?.price || '0');
    const midPrice = (bestBid + bestAsk) / 2;

    // Calculate stop loss and take profit
    const stopLossPct = 0.01; // 1% stop loss
    const takeProfitPct = 0.02; // 2% take profit

    let price = midPrice;
    let stopLoss: number | undefined;
    let takeProfit: number | undefined;

    if (researchResult.signal === 'BUY') {
      price = bestAsk * 1.0002; // Market order equivalent
      stopLoss = price * (1 - stopLossPct);
      takeProfit = price * (1 + takeProfitPct);
    } else {
      price = bestBid * 0.9998; // Market order equivalent
      stopLoss = price * (1 + stopLossPct);
      takeProfit = price * (1 - takeProfitPct);
    }

    return {
      action: researchResult.signal,
      quantity: config.quoteSize,
      price,
      type: 'LIMIT',
      reason: `SMC Hybrid: ${confirmations} confirmations, accuracy: ${(researchResult.accuracy * 100).toFixed(1)}%`,
      stopLoss,
      takeProfit,
    };
  }

  async onOrderUpdate(uid: string, orderStatus: any): Promise<void> {
    // Monitor for stop loss / take profit triggers
    // This would typically be handled by a separate order monitoring service
  }

  async shutdown(uid: string): Promise<void> {
    logger.info({ uid }, 'SMC Hybrid strategy shut down');
  }

  private userConfigs: Map<string, StrategyConfig> = new Map();

  private getConfig(uid: string): StrategyConfig | null {
    return this.userConfigs.get(uid) || null;
  }

  setConfig(uid: string, config: StrategyConfig): void {
    this.userConfigs.set(uid, config);
  }

  private countConfirmations(microSignals: any, signal: 'BUY' | 'SELL'): number {
    let count = 0;
    // Count positive signals that align with main signal
    if (microSignals.orderbookPressure && microSignals.orderbookPressure === signal) count++;
    if (microSignals.volumeSpike && microSignals.volumeSpike === signal) count++;
    if (microSignals.priceMomentum && microSignals.priceMomentum === signal) count++;
    return count;
  }
}

export const smcHybridStrategy = new SMCHybridStrategy();

