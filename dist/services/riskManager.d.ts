import type { RiskLimits } from '../types';
declare class RiskManager {
    private circuitBreaker;
    private paused;
    private riskLimits;
    canTrade(): Promise<boolean>;
    getPosition(symbol: string): Promise<number>;
    getDailyPnL(): Promise<number>;
    getDrawdown(): Promise<number>;
    setCircuitBreaker(enabled: boolean): void;
    pause(): void;
    resume(): void;
    updateLimits(limits: Partial<RiskLimits>): void;
    getLimits(): RiskLimits;
    getStatus(): {
        circuitBreaker: boolean;
        paused: boolean;
        limits: RiskLimits;
    };
}
export declare const riskManager: RiskManager;
export {};
//# sourceMappingURL=riskManager.d.ts.map