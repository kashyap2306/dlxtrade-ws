import { Strategy, TradeDecision, ResearchResult, StrategyConfig } from './index';
import { marketMakingHFTStrategy } from './marketMakingHFT';
import { orderbookImbalanceStrategy } from './orderbookImbalance';
import { smcHybridStrategy } from './smcHybrid';
import { statArbStrategy } from './statArb';
import type { Orderbook } from '../types';
import { BinanceAdapter } from '../services/binanceAdapter';
import { OrderManager } from '../services/orderManager';
import { logger } from '../utils/logger';

export class StrategyManager {
  private strategies: Map<string, Strategy> = new Map();

  constructor() {
    // Register all strategies
    this.strategies.set('market_making_hft', marketMakingHFTStrategy);
    this.strategies.set('orderbook_imbalance', orderbookImbalanceStrategy);
    this.strategies.set('smc_hybrid', smcHybridStrategy);
    this.strategies.set('stat_arb', statArbStrategy);
  }

  async initializeStrategy(
    uid: string,
    strategyName: string,
    config: StrategyConfig,
    adapter?: BinanceAdapter,
    orderManager?: OrderManager
  ): Promise<void> {
    const strategy = this.strategies.get(strategyName);
    if (!strategy) {
      throw new Error(`Unknown strategy: ${strategyName}`);
    }

    await strategy.init(uid, config);

    // Set adapter and order manager for strategies that need them
    if (strategyName === 'market_making_hft' && adapter && orderManager) {
      (marketMakingHFTStrategy as any).setAdapter(uid, adapter);
      (marketMakingHFTStrategy as any).setOrderManager(uid, orderManager);
    }

    logger.info({ uid, strategy: strategyName }, 'Strategy initialized');
  }

  async executeStrategy(
    uid: string,
    strategyName: string,
    researchResult: ResearchResult,
    orderbook: Orderbook
  ): Promise<TradeDecision | null> {
    const strategy = this.strategies.get(strategyName);
    if (!strategy) {
      logger.warn({ uid, strategy: strategyName }, 'Strategy not found');
      return null;
    }

    try {
      return await strategy.onResearch(uid, researchResult, orderbook);
    } catch (err) {
      logger.error({ err, uid, strategy: strategyName }, 'Error executing strategy');
      return null;
    }
  }

  async shutdownStrategy(uid: string, strategyName: string): Promise<void> {
    const strategy = this.strategies.get(strategyName);
    if (strategy) {
      await strategy.shutdown(uid);
    }
  }

  getStrategy(strategyName: string): Strategy | null {
    return this.strategies.get(strategyName) || null;
  }

  listStrategies(): string[] {
    return Array.from(this.strategies.keys());
  }
}

export const strategyManager = new StrategyManager();

