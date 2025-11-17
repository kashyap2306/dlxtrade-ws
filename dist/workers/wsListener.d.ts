import { BinanceAdapter } from '../services/binanceAdapter';
import type { Orderbook, Trade } from '../types';
export declare class WSListener {
    private adapter;
    private orderbookCallbacks;
    private tradesCallbacks;
    setAdapter(adapter: BinanceAdapter): void;
    subscribeOrderbook(callback: (orderbook: Orderbook) => void): void;
    subscribeTrades(callback: (trade: Trade) => void): void;
    start(symbol: string): void;
    stop(): void;
}
//# sourceMappingURL=wsListener.d.ts.map