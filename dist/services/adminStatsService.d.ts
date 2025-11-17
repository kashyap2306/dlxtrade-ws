export interface GlobalStats {
    activeUsers: number;
    activeEngines: number;
    activeHFTBots: number;
    totalVolumeToday: number;
    totalPnLToday: number;
    totalErrors: number;
    totalCancels: number;
    globalSuccessRate: number;
    totalTradesToday: number;
}
export declare class AdminStatsService {
    getGlobalStats(): Promise<GlobalStats>;
    getUserStats(uid: string): Promise<{
        engineRunning: boolean;
        hftRunning: boolean;
        currentPnL: number;
        openOrders: number;
        apiStatus: Record<string, {
            connected: boolean;
            hasKey: boolean;
        }>;
        autoTradeEnabled: boolean;
        hftEnabled: boolean;
        unlockedAgents: string[];
    }>;
}
export declare const adminStatsService: AdminStatsService;
//# sourceMappingURL=adminStatsService.d.ts.map