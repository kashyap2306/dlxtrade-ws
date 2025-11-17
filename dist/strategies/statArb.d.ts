import { Strategy, TradeDecision, ResearchResult, StrategyConfig } from './index';
import type { Orderbook } from '../types';
export declare class StatArbStrategy implements Strategy {
    name: string;
    init(uid: string, config: StrategyConfig): Promise<void>;
    onResearch(uid: string, researchResult: ResearchResult, orderbook: Orderbook): Promise<TradeDecision | null>;
    onOrderUpdate(uid: string, orderStatus: any): Promise<void>;
    shutdown(uid: string): Promise<void>;
}
export declare const statArbStrategy: StatArbStrategy;
//# sourceMappingURL=statArb.d.ts.map