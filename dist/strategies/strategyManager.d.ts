import { Strategy, TradeDecision, ResearchResult, StrategyConfig } from './index';
import type { Orderbook } from '../types';
import { BinanceAdapter } from '../services/binanceAdapter';
import { OrderManager } from '../services/orderManager';
export declare class StrategyManager {
    private strategies;
    constructor();
    initializeStrategy(uid: string, strategyName: string, config: StrategyConfig, adapter?: BinanceAdapter, orderManager?: OrderManager): Promise<void>;
    executeStrategy(uid: string, strategyName: string, researchResult: ResearchResult, orderbook: Orderbook): Promise<TradeDecision | null>;
    shutdownStrategy(uid: string, strategyName: string): Promise<void>;
    getStrategy(strategyName: string): Strategy | null;
    listStrategies(): string[];
}
export declare const strategyManager: StrategyManager;
//# sourceMappingURL=strategyManager.d.ts.map