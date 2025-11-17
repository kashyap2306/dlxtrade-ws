import WebSocket from 'ws';
export declare class AdminWebSocketManager {
    private adminConnections;
    registerAdmin(socket: WebSocket, uid: string): void;
    unregisterAdmin(socket: WebSocket): void;
    broadcastToAdmins(event: {
        type: string;
        uid?: string;
        data: any;
        timestamp: number;
    }): void;
    notifyEngineStart(uid: string, symbol: string): void;
    notifyEngineStop(uid: string): void;
    notifyHFTTrade(uid: string, trade: any): void;
    notifyExecutionTrade(uid: string, execution: any): void;
    notifyPnLUpdate(uid: string, pnl: number): void;
    notifyAccuracyUpdate(uid: string, accuracy: number): void;
    notifyError(uid: string, error: any): void;
    notifyResearchUpdate(uid: string, research: any): void;
}
export declare const adminWebSocketManager: AdminWebSocketManager;
//# sourceMappingURL=adminWebSocketManager.d.ts.map