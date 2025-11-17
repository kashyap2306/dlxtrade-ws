import { BinanceAdapter } from './binanceAdapter';
import type { EngineConfig } from '../types';
export declare class QuoteEngine {
    private config;
    private adapter;
    private isRunning;
    private activeQuotes;
    private lastMidPrice;
    private cancelTimers;
    start(config: EngineConfig, adapter: BinanceAdapter): Promise<void>;
    stop(): Promise<void>;
    private quoteLoop;
    private updateQuotes;
    private calculateMidPrice;
    private placeQuotes;
    private cancelQuotes;
    private handleOrderbookUpdate;
    getStatus(): {
        running: boolean;
        config: EngineConfig | null;
    };
}
export declare const quoteEngine: QuoteEngine;
//# sourceMappingURL=quoteEngine.d.ts.map