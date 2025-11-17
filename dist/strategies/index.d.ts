import type { Orderbook } from '../types';
export interface ResearchResult {
    symbol: string;
    signal: 'BUY' | 'SELL' | 'HOLD';
    accuracy: number;
    orderbookImbalance: number;
    recommendedAction: string;
    microSignals: any;
}
export interface TradeDecision {
    action: 'BUY' | 'SELL' | 'HOLD' | 'CANCEL';
    quantity: number;
    price?: number;
    type: 'LIMIT' | 'MARKET';
    reason: string;
    stopLoss?: number;
    takeProfit?: number;
}
export interface StrategyConfig {
    quoteSize: number;
    adversePct: number;
    cancelMs: number;
    maxPos: number;
    minSpread?: number;
    makerOnly?: boolean;
    [key: string]: any;
}
export interface Strategy {
    name: string;
    init(uid: string, config: StrategyConfig): Promise<void>;
    onResearch(uid: string, researchResult: ResearchResult, orderbook: Orderbook): Promise<TradeDecision | null>;
    onOrderUpdate(uid: string, orderStatus: any): Promise<void>;
    shutdown(uid: string): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map