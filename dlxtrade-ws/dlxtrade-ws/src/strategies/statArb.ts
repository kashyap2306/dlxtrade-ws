import { Strategy, TradeDecision, ResearchResult, StrategyConfig } from './index';
import type { Orderbook } from '../types';
import { logger } from '../utils/logger';

export class StatArbStrategy implements Strategy {
  name = 'stat_arb';

  async init(uid: string, config: StrategyConfig): Promise<void> {
    logger.info({ uid, strategy: this.name }, 'Statistical Arbitrage strategy initialized (stub)');
  }

  async onResearch(
    uid: string,
    researchResult: ResearchResult,
    orderbook: Orderbook
  ): Promise<TradeDecision | null> {
    // Stub implementation - would require pairs data and mean reversion logic
    logger.debug({ uid }, 'Stat Arb strategy - stub implementation');
    return null;
  }

  async onOrderUpdate(uid: string, orderStatus: any): Promise<void> {
    // Stub
  }

  async shutdown(uid: string): Promise<void> {
    logger.info({ uid }, 'Statistical Arbitrage strategy shut down');
  }
}

export const statArbStrategy = new StatArbStrategy();

