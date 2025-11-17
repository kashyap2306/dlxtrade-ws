import { BinanceAdapter } from './binanceAdapter';
import type { Orderbook, Trade } from '../types';
export interface ResearchResult {
    symbol: string;
    signal: 'BUY' | 'SELL' | 'HOLD';
    accuracy: number;
    orderbookImbalance: number;
    recommendedAction: string;
    microSignals: {
        spread: number;
        volume: number;
        priceMomentum: number;
        orderbookDepth: number;
    };
}
export declare class ResearchEngine {
    private recentTrades;
    private orderbookHistory;
    private spreadHistory;
    private volumeHistory;
    private depthHistory;
    private imbalanceHistory;
    runResearch(symbol: string, uid: string, adapter?: BinanceAdapter): Promise<ResearchResult>;
    private calculateOrderbookImbalance;
    private calculateMicroSignals;
    private calculateAccuracy;
    private determineSignalDynamic;
    private getRecommendedAction;
    addTrade(symbol: string, trade: Trade): void;
    addOrderbook(symbol: string, orderbook: Orderbook): void;
    private updateSignalHistories;
    private computeVolatility;
    private percentile;
    private median;
    private computeDynamicThresholds;
    private shouldBlockForLiquidity;
}
export declare const researchEngine: ResearchEngine;
//# sourceMappingURL=researchEngine.d.ts.map