interface UserRiskState {
    dailyLoss: number;
    dailyStartBalance: number;
    peakBalance: number;
    consecutiveFailures: number;
    lastFailureTime: number;
    paused: boolean;
    pausedReason?: string;
}
export declare class UserRiskManager {
    private userStates;
    private readonly MAX_CONSECUTIVE_FAILURES;
    private readonly RISK_PAUSE_MINUTES;
    canTrade(uid: string, symbol: string, tradeSize: number, midPrice?: number, assumedAdverseMove?: number): Promise<{
        allowed: boolean;
        reason?: string;
    }>;
    recordTradeResult(uid: string, pnl: number, success: boolean): Promise<void>;
    pauseEngine(uid: string, reason: 'paused_by_risk' | 'paused_manual'): Promise<void>;
    resumeEngine(uid: string): Promise<void>;
    private getOrCreateState;
    private getPosition;
    private getBalance;
    getState(uid: string): UserRiskState | null;
}
export declare const userRiskManager: UserRiskManager;
export {};
//# sourceMappingURL=userRiskManager.d.ts.map