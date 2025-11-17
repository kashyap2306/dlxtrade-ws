import { BinanceAdapter } from './binanceAdapter';
import { OrderManager } from './orderManager';
export declare class HFTEngine {
    private adapter;
    private orderManager;
    private uid;
    private isRunning;
    private tradingInterval;
    private wsClients;
    private pendingOrders;
    private userInventory;
    private dailyTradeCount;
    setAdapter(adapter: BinanceAdapter): void;
    setOrderManager(orderManager: OrderManager): void;
    setUserId(uid: string): void;
    registerWebSocketClient(ws: any): void;
    unregisterWebSocketClient(ws: any): void;
    private broadcast;
    start(symbol: string, intervalMs?: number): Promise<void>;
    stop(): Promise<void>;
    private runHFTCycle;
    private placeMakerOrders;
    private placeBuyOrder;
    private placeSellOrder;
    private cancelAdverseOrders;
    private scheduleCancel;
    private addPendingOrder;
    private removePendingOrder;
    private canTradeMore;
    private incrementTradeCount;
    private logHFTExecution;
    onOrderUpdate(orderStatus: any): Promise<void>;
    getStatus(): {
        running: boolean;
        hasEngine: boolean;
    };
}
//# sourceMappingURL=hftEngine.d.ts.map