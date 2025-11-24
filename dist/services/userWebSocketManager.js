"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userWebSocketManager = exports.UserWebSocketManager = void 0;
const ws_1 = __importDefault(require("ws"));
const logger_1 = require("../utils/logger");
/**
 * Manages user WebSocket connections for real-time updates
 * Similar to AdminWebSocketManager but for regular users
 */
class UserWebSocketManager {
    constructor() {
        this.userConnections = new Map(); // socket -> uid
        this.symbolSubscriptions = new Map(); // symbol -> Set of sockets
    }
    registerUser(socket, uid) {
        this.userConnections.set(socket, uid);
        logger_1.logger.debug({ uid, totalUsers: this.userConnections.size }, 'User registered for WebSocket events');
    }
    unregisterUser(socket) {
        const uid = this.userConnections.get(socket);
        this.userConnections.delete(socket);
        // Remove from all symbol subscriptions
        for (const [symbol, sockets] of this.symbolSubscriptions.entries()) {
            sockets.delete(socket);
            if (sockets.size === 0) {
                this.symbolSubscriptions.delete(symbol);
            }
        }
        if (uid) {
            logger_1.logger.debug({ uid, totalUsers: this.userConnections.size }, 'User unregistered from WebSocket events');
        }
    }
    subscribeToSymbol(socket, symbol) {
        if (!this.symbolSubscriptions.has(symbol)) {
            this.symbolSubscriptions.set(symbol, new Set());
        }
        this.symbolSubscriptions.get(symbol).add(socket);
        logger_1.logger.debug({ symbol, totalSubscribers: this.symbolSubscriptions.get(symbol).size }, 'User subscribed to symbol updates');
    }
    unsubscribeFromSymbol(socket, symbol) {
        const sockets = this.symbolSubscriptions.get(symbol);
        if (sockets) {
            sockets.delete(socket);
            if (sockets.size === 0) {
                this.symbolSubscriptions.delete(symbol);
            }
        }
    }
    /**
     * Broadcast research update to all users subscribed to a symbol
     */
    broadcastResearchUpdate(symbol, data) {
        const sockets = this.symbolSubscriptions.get(symbol.toUpperCase());
        if (!sockets || sockets.size === 0) {
            logger_1.logger.debug({ symbol }, 'No subscribers for research update');
            return;
        }
        const message = JSON.stringify({
            type: 'research:update',
            channel: `research:update:${symbol}`,
            data,
            timestamp: Date.now(),
        });
        let sent = 0;
        for (const socket of sockets) {
            if (socket.readyState === ws_1.default.OPEN) {
                try {
                    socket.send(message);
                    sent++;
                }
                catch (err) {
                    logger_1.logger.error({ err }, 'Error sending research update to user');
                    this.unregisterUser(socket);
                }
            }
            else {
                this.unregisterUser(socket);
            }
        }
        if (sent > 0) {
            logger_1.logger.debug({ symbol, sent, totalSubscribers: sockets.size }, 'Research update broadcasted to users');
        }
    }
    /**
     * Broadcast to all connected users
     */
    broadcastToAllUsers(event) {
        const message = JSON.stringify({
            ...event,
            timestamp: event.timestamp || Date.now(),
        });
        let sent = 0;
        for (const [socket, uid] of this.userConnections.entries()) {
            if (socket.readyState === ws_1.default.OPEN) {
                try {
                    socket.send(message);
                    sent++;
                }
                catch (err) {
                    logger_1.logger.error({ err, uid }, 'Error sending message to user');
                    this.unregisterUser(socket);
                }
            }
            else {
                this.unregisterUser(socket);
            }
        }
        if (sent > 0) {
            logger_1.logger.debug({ eventType: event.type, sent, totalUsers: this.userConnections.size }, 'Event broadcasted to users');
        }
    }
}
exports.UserWebSocketManager = UserWebSocketManager;
exports.userWebSocketManager = new UserWebSocketManager();
