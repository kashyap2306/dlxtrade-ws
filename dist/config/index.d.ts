export declare const config: {
    env: string;
    port: number;
    jwtSecret: string;
    jwtExpiry: string;
    database: {
        url: string;
    };
    redis: {
        url: string;
    };
    binance: {
        apiKey: string;
        apiSecret: string;
        testnet: boolean;
        baseUrl: string;
        wsUrl: string;
    };
    trading: {
        adversePct: number;
        cancelMs: number;
        maxPos: number;
        binanceTestnet: boolean;
        enableLiveTrades: boolean;
        defaultAccuracyThreshold: number;
        maxConsecutiveFailures: number;
        riskPauseMinutes: number;
        tradeLogRetentionDays: number;
    };
    encryption: {
        algorithm: string;
        key: string;
    };
    rateLimit: {
        max: number;
        timeWindow: string;
    };
    firebase: {
        projectId: string;
        serviceAccountKey: string;
    };
};
//# sourceMappingURL=index.d.ts.map