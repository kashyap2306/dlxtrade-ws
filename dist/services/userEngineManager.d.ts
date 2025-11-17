import { BinanceAdapter } from './binanceAdapter';
import { AccuracyEngine } from './accuracyEngine';
import { HFTEngine } from './hftEngine';
import { OrderManager } from './orderManager';
interface UserEngine {
    adapter: BinanceAdapter;
    accuracyEngine: AccuracyEngine;
    hftEngine: HFTEngine;
    orderManager: OrderManager;
    isRunning: boolean;
    autoTradeEnabled: boolean;
}
declare class UserEngineManager {
    private userEngines;
    createUserEngine(uid: string, apiKey: string, apiSecret: string, testnet?: boolean): Promise<UserEngine>;
    getUserEngine(uid: string): UserEngine | null;
    stopUserEngine(uid: string): Promise<void>;
    startUserEngine(uid: string, symbol: string, researchIntervalMs?: number): Promise<void>;
    stopUserEngineRunning(uid: string): Promise<void>;
    getOrderManager(uid: string): OrderManager | null;
    getAccuracyEngine(uid: string): AccuracyEngine | null;
    getHFTEngine(uid: string): HFTEngine | null;
    startHFT(uid: string): Promise<void>;
    stopHFT(uid: string): Promise<void>;
    getHFTStatus(uid: string): {
        running: boolean;
        hasEngine: boolean;
    };
    getUserEngineStatus(uid: string): {
        running: boolean;
        hasEngine: boolean;
    };
    startAutoTrade(uid: string): Promise<void>;
    stopAutoTrade(uid: string): Promise<void>;
}
export declare const userEngineManager: UserEngineManager;
export {};
//# sourceMappingURL=userEngineManager.d.ts.map