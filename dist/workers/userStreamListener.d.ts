import { BinanceAdapter } from '../services/binanceAdapter';
import type { Order, Fill } from '../types';
export declare class UserStreamListener {
    private adapter;
    private orderCallbacks;
    private fillCallbacks;
    setAdapter(adapter: BinanceAdapter): void;
    subscribeOrderUpdates(callback: (order: Order) => void): void;
    subscribeFills(callback: (fill: Fill) => void): void;
    start(): Promise<void>;
    private handleUserData;
    stop(): Promise<void>;
}
//# sourceMappingURL=userStreamListener.d.ts.map