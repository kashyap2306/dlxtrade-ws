import WebSocket from 'ws';
import { logger } from '../utils/logger';

/**
 * Manages user WebSocket connections for real-time updates
 * Similar to AdminWebSocketManager but for regular users
 */
export class UserWebSocketManager {
  private userConnections: Map<WebSocket, string> = new Map(); // socket -> uid
  private symbolSubscriptions: Map<string, Set<WebSocket>> = new Map(); // symbol -> Set of sockets

  registerUser(socket: WebSocket, uid: string): void {
    this.userConnections.set(socket, uid);
    logger.debug({ uid, totalUsers: this.userConnections.size }, 'User registered for WebSocket events');
  }

  unregisterUser(socket: WebSocket): void {
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
      logger.debug({ uid, totalUsers: this.userConnections.size }, 'User unregistered from WebSocket events');
    }
  }

  subscribeToSymbol(socket: WebSocket, symbol: string): void {
    if (!this.symbolSubscriptions.has(symbol)) {
      this.symbolSubscriptions.set(symbol, new Set());
    }
    this.symbolSubscriptions.get(symbol)!.add(socket);
    logger.debug({ symbol, totalSubscribers: this.symbolSubscriptions.get(symbol)!.size }, 'User subscribed to symbol updates');
  }

  unsubscribeFromSymbol(socket: WebSocket, symbol: string): void {
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
  broadcastResearchUpdate(symbol: string, data: any): void {
    const sockets = this.symbolSubscriptions.get(symbol.toUpperCase());
    if (!sockets || sockets.size === 0) {
      logger.debug({ symbol }, 'No subscribers for research update');
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
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(message);
          sent++;
        } catch (err) {
          logger.error({ err }, 'Error sending research update to user');
          this.unregisterUser(socket);
        }
      } else {
        this.unregisterUser(socket);
      }
    }

    if (sent > 0) {
      logger.debug({ symbol, sent, totalSubscribers: sockets.size }, 'Research update broadcasted to users');
    }
  }

  /**
   * Broadcast to all connected users
   */
  broadcastToAllUsers(event: {
    type: string;
    data: any;
    timestamp?: number;
  }): void {
    const message = JSON.stringify({
      ...event,
      timestamp: event.timestamp || Date.now(),
    });

    let sent = 0;
    for (const [socket, uid] of this.userConnections.entries()) {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(message);
          sent++;
        } catch (err) {
          logger.error({ err, uid }, 'Error sending message to user');
          this.unregisterUser(socket);
        }
      } else {
        this.unregisterUser(socket);
      }
    }

    if (sent > 0) {
      logger.debug({ eventType: event.type, sent, totalUsers: this.userConnections.size }, 'Event broadcasted to users');
    }
  }
}

export const userWebSocketManager = new UserWebSocketManager();

