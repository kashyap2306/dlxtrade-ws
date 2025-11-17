interface TradeMetrics {
    tradesExecuted: number;
    failedOrders: number;
    cancels: number;
    totalLatency: number;
    latencyCount: number;
}
declare class MetricsService {
    private userMetrics;
    recordTrade(uid: string, strategy: string, success: boolean, latency?: number): void;
    recordCancel(uid: string, strategy: string): void;
    getMetrics(uid?: string): Map<string, Map<string, TradeMetrics>>;
    getPrometheusMetrics(): string;
    reset(uid?: string): void;
}
export declare const metricsService: MetricsService;
export {};
//# sourceMappingURL=metricsService.d.ts.map