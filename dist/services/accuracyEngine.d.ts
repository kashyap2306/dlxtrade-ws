import { OrderManager } from './orderManager';
import { BinanceAdapter } from './binanceAdapter';
export declare class AccuracyEngine {
    private adapter;
    private uid;
    private orderManager;
    private isRunning;
    private researchInterval;
    private wsClients;
    private lastExitCheckAt;
    setAdapter(adapter: BinanceAdapter): void;
    setOrderManager(orderManager: OrderManager): void;
    private monitorExits;
    setUserId(uid: string): void;
    registerWebSocketClient(ws: any): void;
    unregisterWebSocketClient(ws: any): void;
    private broadcast;
    start(symbol: string, researchIntervalMs?: number): Promise<void>;
    stop(): Promise<void>;
    private runResearchCycle;
    private executeTrade;
}
export declare const accuracyEngine: AccuracyEngine;
//# sourceMappingURL=accuracyEngine.d.ts.map