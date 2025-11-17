import { Strategy, TradeDecision, ResearchResult, StrategyConfig } from './index';
import type { Orderbook } from '../types';
import { BinanceAdapter } from '../services/binanceAdapter';
import { OrderManager } from '../services/orderManager';
export declare class MarketMakingHFTStrategy implements Strategy {
    name: string;
    private userConfigs;
    private userAdapters;
    private userOrderManagers;
    private pendingOrders;
    private userInventory;
    init(uid: string, config: StrategyConfig): Promise<void>;
    setAdapter(uid: string, adapter: BinanceAdapter): void;
    setOrderManager(uid: string, orderManager: OrderManager): void;
    onResearch(uid: string, researchResult: ResearchResult, orderbook: Orderbook): Promise<TradeDecision | null>;
    onOrderUpdate(uid: string, orderStatus: any): Promise<void>;
    shutdown(uid: string): Promise<void>;
    private addPendingOrder;
    private removePendingOrder;
    private scheduleCancel;
    private cancelAdverseOrders;
}
export declare const marketMakingHFTStrategy: MarketMakingHFTStrategy;
//# sourceMappingURL=marketMakingHFT.d.ts.map