import * as admin from 'firebase-admin';
export interface ApiKeyDocument {
    id?: string;
    exchange: string;
    name: string;
    apiKeyEncrypted: string;
    apiSecretEncrypted: string;
    testnet: boolean;
    createdAt: admin.firestore.Timestamp;
    updatedAt: admin.firestore.Timestamp;
}
export interface SettingsDocument {
    id?: string;
    symbol: string;
    quoteSize: number;
    adversePct: number;
    cancelMs: number;
    maxPos: number;
    minAccuracyThreshold: number;
    autoTradeEnabled: boolean;
    strategy?: string;
    liveMode?: boolean;
    max_loss_pct?: number;
    max_drawdown_pct?: number;
    per_trade_risk_pct?: number;
    status?: string;
    updatedAt: admin.firestore.Timestamp;
}
export interface ResearchLogDocument {
    id?: string;
    symbol: string;
    timestamp: admin.firestore.Timestamp;
    signal: 'BUY' | 'SELL' | 'HOLD';
    accuracy: number;
    orderbookImbalance: number;
    recommendedAction: string;
    microSignals: any;
    createdAt: admin.firestore.Timestamp;
}
export interface ExecutionLogDocument {
    id?: string;
    symbol: string;
    timestamp: admin.firestore.Timestamp;
    action: 'EXECUTED' | 'SKIPPED';
    reason?: string;
    accuracy?: number;
    accuracyUsed?: number;
    orderId?: string;
    orderIds?: string[];
    executionLatency?: number;
    slippage?: number;
    pnl?: number;
    strategy?: string;
    signal?: 'BUY' | 'SELL' | 'HOLD';
    status?: string;
    createdAt: admin.firestore.Timestamp;
}
export interface IntegrationDocument {
    enabled: boolean;
    apiKey?: string;
    secretKey?: string;
    apiType?: string;
    updatedAt: admin.firestore.Timestamp;
}
export interface HFTSettingsDocument {
    id?: string;
    symbol: string;
    quoteSize: number;
    adversePct: number;
    cancelMs: number;
    maxPos: number;
    minSpreadPct: number;
    maxTradesPerDay: number;
    enabled: boolean;
    updatedAt: admin.firestore.Timestamp;
}
export interface HFTExecutionLogDocument {
    id?: string;
    symbol: string;
    timestamp: admin.firestore.Timestamp;
    action: string;
    orderId?: string;
    orderIds?: string[];
    price?: number;
    quantity?: number;
    side?: 'BUY' | 'SELL';
    reason?: string;
    strategy: string;
    status?: string;
    createdAt: admin.firestore.Timestamp;
}
export declare class FirestoreAdapter {
    saveApiKey(uid: string, keyData: {
        exchange: string;
        name: string;
        apiKey: string;
        apiSecret: string;
        testnet: boolean;
    }): Promise<string>;
    getApiKeys(uid: string): Promise<ApiKeyDocument[]>;
    getApiKey(uid: string, keyId: string): Promise<ApiKeyDocument | null>;
    updateApiKey(uid: string, keyId: string, updates: Partial<{
        name: string;
        apiKey: string;
        apiSecret: string;
        testnet: boolean;
    }>): Promise<void>;
    deleteApiKey(uid: string, keyId: string): Promise<void>;
    getLatestApiKey(uid: string, exchange: string): Promise<ApiKeyDocument | null>;
    saveSettings(uid: string, settings: Partial<SettingsDocument>): Promise<void>;
    getSettings(uid: string): Promise<SettingsDocument | null>;
    saveResearchLog(uid: string, research: Omit<ResearchLogDocument, 'id' | 'createdAt'>): Promise<string>;
    getResearchLogs(uid: string, limit?: number): Promise<ResearchLogDocument[]>;
    saveExecutionLog(uid: string, execution: Omit<ExecutionLogDocument, 'id' | 'createdAt'>): Promise<string>;
    getExecutionLogs(uid: string, limit?: number): Promise<ExecutionLogDocument[]>;
    getIntegration(uid: string, apiName: string): Promise<IntegrationDocument | null>;
    getAllIntegrations(uid: string): Promise<Record<string, IntegrationDocument>>;
    saveIntegration(uid: string, apiName: string, data: {
        enabled: boolean;
        apiKey?: string;
        secretKey?: string;
        apiType?: string;
    }): Promise<void>;
    deleteIntegration(uid: string, apiName: string): Promise<void>;
    getEnabledIntegrations(uid: string): Promise<Record<string, {
        apiKey: string;
        secretKey?: string;
    }>>;
    saveHFTSettings(uid: string, settings: Partial<HFTSettingsDocument>): Promise<void>;
    getHFTSettings(uid: string): Promise<HFTSettingsDocument | null>;
    saveHFTExecutionLog(uid: string, execution: Omit<HFTExecutionLogDocument, 'id' | 'createdAt'>): Promise<string>;
    getHFTExecutionLogs(uid: string, limit?: number): Promise<HFTExecutionLogDocument[]>;
    unlockAgent(uid: string, agentName: string): Promise<void>;
    lockAgent(uid: string, agentName: string): Promise<void>;
    getAgentStatus(uid: string, agentName: string): Promise<{
        unlocked: boolean;
        unlockedAt?: admin.firestore.Timestamp;
    } | null>;
    getAllUserAgents(uid: string): Promise<Record<string, {
        unlocked: boolean;
        unlockedAt?: admin.firestore.Timestamp;
    }>>;
    getUserProfile(uid: string): Promise<{
        role?: string;
        email?: string;
        [key: string]: any;
    } | null>;
    getAllUsers(): Promise<Array<{
        uid: string;
        email?: string;
        role?: string;
        createdAt?: admin.firestore.Timestamp;
    }>>;
    createOrUpdateUser(uid: string, userData: {
        name?: string;
        email?: string;
        phone?: string;
        plan?: string;
        apiConnected?: boolean;
        unlockedAgents?: string[];
        profilePicture?: string;
        hftStatus?: string;
        engineStatus?: string;
        totalPnL?: number;
        totalTrades?: number;
        settings?: any;
    }): Promise<void>;
    getUser(uid: string): Promise<any | null>;
    getAllAgents(): Promise<Array<{
        id: string;
        name: string;
        price: number;
        features: string[];
        [key: string]: any;
    }>>;
    getAgent(agentId: string): Promise<any | null>;
    createAgentUnlock(uid: string, agentName: string, metadata?: any): Promise<void>;
    getUserAgentUnlocks(uid: string): Promise<any[]>;
    saveApiKeyToCollection(uid: string, keyData: {
        publicKey: string;
        secretKey: string;
        exchange?: string;
    }): Promise<string>;
    getUserApiKeys(uid: string): Promise<any[]>;
    logActivity(uid: string, type: string, metadata?: any): Promise<void>;
    getActivityLogs(uid?: string, limit?: number): Promise<any[]>;
    saveEngineStatus(uid: string, status: {
        active: boolean;
        engineType?: 'auto' | 'hft';
        symbol?: string;
        config?: any;
    }): Promise<void>;
    getEngineStatus(uid: string): Promise<any | null>;
    getAllEngineStatuses(): Promise<any[]>;
    saveHFTLog(uid: string, logData: {
        symbol: string;
        action: string;
        orderId?: string;
        price?: number;
        quantity?: number;
        side?: 'BUY' | 'SELL';
        pnl?: number;
        metadata?: any;
    }): Promise<void>;
    getHFTLogs(uid?: string, limit?: number): Promise<any[]>;
    saveTrade(uid: string, tradeData: {
        symbol: string;
        side: 'BUY' | 'SELL' | 'buy' | 'sell';
        qty: number;
        entryPrice: number;
        exitPrice?: number;
        pnl?: number;
        timestamp?: admin.firestore.Timestamp;
        engineType: 'AI' | 'HFT' | 'Manual' | 'auto';
        orderId?: string;
        metadata?: any;
    }): Promise<string>;
    getTrades(uid?: string, limit?: number): Promise<any[]>;
    createNotification(uid: string, notification: {
        title: string;
        message: string;
        type?: string;
        metadata?: any;
    }): Promise<string>;
    getUserNotifications(uid: string, limit?: number): Promise<any[]>;
    markNotificationRead(notificationId: string): Promise<void>;
    getUnreadNotificationCount(uid: string): Promise<number>;
    createAdmin(uid: string, adminData: {
        email: string;
        permissions?: string[];
        role?: string;
    }): Promise<void>;
    getAdmin(uid: string): Promise<any | null>;
    isAdmin(uid: string): Promise<boolean>;
    getAllAdmins(): Promise<any[]>;
    getGlobalSettings(): Promise<any | null>;
    updateGlobalSettings(settings: {
        maintenanceMode?: boolean;
        exchangeExecution?: boolean;
        hftMode?: boolean;
        riskThresholds?: any;
        uiThemeDefaults?: any;
        [key: string]: any;
    }): Promise<void>;
    saveSystemLog(logData: {
        type: string;
        message: string;
        level?: 'info' | 'warn' | 'error';
        metadata?: any;
    }): Promise<void>;
    getSystemLogs(limit?: number): Promise<any[]>;
    getUserUIPreferences(uid: string): Promise<any | null>;
    updateUIPreferences(uid: string, preferences: {
        dismissedAgents?: string[];
        hideDashboardCard?: string[];
        theme?: 'light' | 'dark';
        sidebarPinned?: boolean;
        [key: string]: any;
    }): Promise<void>;
    getGlobalStats(): Promise<any | null>;
    updateGlobalStats(stats: {
        totalUsers?: number;
        totalTrades?: number;
        totalAgentsUnlocked?: number;
        runningEngines?: number;
        runningHFT?: number;
        totalPnl?: number;
        [key: string]: any;
    }): Promise<void>;
}
export declare const firestoreAdapter: FirestoreAdapter;
//# sourceMappingURL=firestoreAdapter.d.ts.map