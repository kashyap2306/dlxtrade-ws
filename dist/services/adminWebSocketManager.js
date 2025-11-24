"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminWebSocketManager = exports.AdminWebSocketManager = void 0;
const ws_1 = __importDefault(require("ws"));
const logger_1 = require("../utils/logger");
class AdminWebSocketManager {
    constructor() {
        this.adminConnections = new Map(); // socket -> uid
    }
    registerAdmin(socket, uid) {
        this.adminConnections.set(socket, uid);
        logger_1.logger.info({ uid, totalAdmins: this.adminConnections.size }, 'Admin registered for WebSocket events');
    }
    unregisterAdmin(socket) {
        const uid = this.adminConnections.get(socket);
        this.adminConnections.delete(socket);
        if (uid) {
            logger_1.logger.info({ uid, totalAdmins: this.adminConnections.size }, 'Admin unregistered from WebSocket events');
        }
    }
    broadcastToAdmins(event) {
        const message = JSON.stringify({
            ...event,
            timestamp: event.timestamp || Date.now(),
        });
        let sent = 0;
        for (const [socket, uid] of this.adminConnections.entries()) {
            if (socket.readyState === ws_1.default.OPEN) {
                try {
                    socket.send(message);
                    sent++;
                }
                catch (err) {
                    logger_1.logger.error({ err, uid }, 'Error sending admin WebSocket message');
                    this.adminConnections.delete(socket);
                }
            }
            else {
                this.adminConnections.delete(socket);
            }
        }
        if (sent > 0) {
            logger_1.logger.debug({ eventType: event.type, sent, totalAdmins: this.adminConnections.size }, 'Admin event broadcasted');
        }
    }
    // Helper methods for specific event types
    notifyEngineStart(uid, symbol) {
        this.broadcastToAdmins({
            type: 'engine_start',
            uid,
            data: { symbol },
            timestamp: Date.now(),
        });
    }
    notifyEngineStop(uid) {
        this.broadcastToAdmins({
            type: 'engine_stop',
            uid,
            data: {},
            timestamp: Date.now(),
        });
    }
    notifyHFTTrade(uid, trade) {
        this.broadcastToAdmins({
            type: 'hft_trade',
            uid,
            data: trade,
            timestamp: Date.now(),
        });
    }
    notifyExecutionTrade(uid, execution) {
        this.broadcastToAdmins({
            type: 'execution_trade',
            uid,
            data: execution,
            timestamp: Date.now(),
        });
    }
    notifyPnLUpdate(uid, pnl) {
        this.broadcastToAdmins({
            type: 'pnl_update',
            uid,
            data: { pnl },
            timestamp: Date.now(),
        });
    }
    notifyAccuracyUpdate(uid, accuracy) {
        this.broadcastToAdmins({
            type: 'accuracy_update',
            uid,
            data: { accuracy },
            timestamp: Date.now(),
        });
    }
    notifyError(uid, error) {
        this.broadcastToAdmins({
            type: 'error',
            uid,
            data: { error: error.message || error },
            timestamp: Date.now(),
        });
    }
    notifyResearchUpdate(uid, research) {
        this.broadcastToAdmins({
            type: 'research_update',
            uid,
            data: research,
            timestamp: Date.now(),
        });
    }
}
exports.AdminWebSocketManager = AdminWebSocketManager;
exports.adminWebSocketManager = new AdminWebSocketManager();
