import { Strategy, TradeDecision, ResearchResult, StrategyConfig } from './index';
import type { Orderbook } from '../types';
export declare class OrderbookImbalanceStrategy implements Strategy {
    name: string;
    init(uid: string, config: StrategyConfig): Promise<void>;
    onResearch(uid: string, researchResult: ResearchResult, orderbook: Orderbook): Promise<TradeDecision | null>;
    onOrderUpdate(uid: string, orderStatus: any): Promise<void>;
    shutdown(uid: string): Promise<void>;
    private userConfigs;
    private getConfig;
    setConfig(uid: string, config: StrategyConfig): void;
}
export declare const orderbookImbalanceStrategy: OrderbookImbalanceStrategy;
//# sourceMappingURL=orderbookImbalance.d.ts.map