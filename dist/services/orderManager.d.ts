import { BinanceAdapter } from './binanceAdapter';
import type { Order, Fill } from '../types';
export declare class OrderManager {
    private adapter;
    setAdapter(adapter: BinanceAdapter): void;
    placeOrder(uid: string, params: {
        symbol: string;
        side: 'BUY' | 'SELL';
        type: 'LIMIT' | 'MARKET';
        quantity: number;
        price?: number;
    }): Promise<Order | null>;
    cancelOrder(uid: string, orderId: string): Promise<Order>;
    getOrder(uid: string, orderId: string): Promise<Order | null>;
    listOrders(uid: string, filters: {
        symbol?: string;
        status?: string;
        limit?: number;
        offset?: number;
    }): Promise<Order[]>;
    recordFill(fill: Omit<Fill, 'id' | 'timestamp'>): Promise<Fill>;
    listFills(uid: string, filters: {
        orderId?: string;
        symbol?: string;
        limit?: number;
        offset?: number;
    }): Promise<Fill[]>;
    private mapRowToOrder;
}
export declare const orderManager: OrderManager;
//# sourceMappingURL=orderManager.d.ts.map