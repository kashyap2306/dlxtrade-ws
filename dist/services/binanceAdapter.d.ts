import type { Order, Orderbook, Trade } from '../types';
export declare class BinanceAdapter {
    private apiKey;
    private apiSecret;
    private baseUrl;
    private wsUrl;
    private httpClient;
    private orderbookWs;
    private tradesWs;
    private userStreamWs;
    private listenKey;
    constructor(apiKey: string, apiSecret: string, testnet?: boolean);
    private sign;
    private request;
    getOrderbook(symbol: string, limit?: number): Promise<Orderbook>;
    placeOrder(symbol: string, side: 'BUY' | 'SELL', type: 'LIMIT' | 'MARKET', quantity: number, price?: number, timeInForce?: string): Promise<Order>;
    validateApiKey(): Promise<{
        valid: boolean;
        canTrade: boolean;
        canWithdraw: boolean;
        error?: string;
    }>;
    cancelOrder(symbol: string, orderId?: string, clientOrderId?: string): Promise<Order>;
    getOrderStatus(symbol: string, orderId?: string, clientOrderId?: string): Promise<Order>;
    startUserDataStream(): Promise<string>;
    keepAliveUserDataStream(): Promise<void>;
    closeUserDataStream(): Promise<void>;
    subscribeOrderbook(symbol: string, callback: (orderbook: Orderbook) => void): void;
    subscribeTrades(symbol: string, callback: (trade: Trade) => void): void;
    subscribeUserData(callback: (data: any) => void): void;
    disconnect(): void;
}
//# sourceMappingURL=binanceAdapter.d.ts.map