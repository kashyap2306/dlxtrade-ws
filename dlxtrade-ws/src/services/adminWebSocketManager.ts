import WebSocket from 'ws';
import { logger } from '../utils/logger';

export class AdminWebSocketManager {
  private adminConnections: Map<WebSocket, string> = new Map(); // socket -> uid

  registerAdmin(socket: WebSocket, uid: string): void {
    this.adminConnections.set(socket, uid);
    logger.info({ uid, totalAdmins: this.adminConnections.size }, 'Admin registered for WebSocket events');
  }

  unregisterAdmin(socket: WebSocket): void {
    const uid = this.adminConnections.get(socket);
    this.adminConnections.delete(socket);
    if (uid) {
      logger.info({ uid, totalAdmins: this.adminConnections.size }, 'Admin unregistered from WebSocket events');
    }
  }

  broadcastToAdmins(event: {
    type: string;
    uid?: string;
    data: any;
    timestamp: number;
  }): void {
    const message = JSON.stringify({
      ...event,
      timestamp: event.timestamp || Date.now(),
    });

    let sent = 0;
    for (const [socket, uid] of this.adminConnections.entries()) {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(message);
          sent++;
        } catch (err) {
          logger.error({ err, uid }, 'Error sending admin WebSocket message');
          this.adminConnections.delete(socket);
        }
      } else {
        this.adminConnections.delete(socket);
      }
    }

    if (sent > 0) {
      logger.debug({ eventType: event.type, sent, totalAdmins: this.adminConnections.size }, 'Admin event broadcasted');
    }
  }

  // Helper methods for specific event types
  notifyEngineStart(uid: string, symbol: string): void {
    this.broadcastToAdmins({
      type: 'engine_start',
      uid,
      data: { symbol },
      timestamp: Date.now(),
    });
  }

  notifyEngineStop(uid: string): void {
    this.broadcastToAdmins({
      type: 'engine_stop',
      uid,
      data: {},
      timestamp: Date.now(),
    });
  }

  notifyHFTTrade(uid: string, trade: any): void {
    this.broadcastToAdmins({
      type: 'hft_trade',
      uid,
      data: trade,
      timestamp: Date.now(),
    });
  }

  notifyExecutionTrade(uid: string, execution: any): void {
    this.broadcastToAdmins({
      type: 'execution_trade',
      uid,
      data: execution,
      timestamp: Date.now(),
    });
  }

  notifyPnLUpdate(uid: string, pnl: number): void {
    this.broadcastToAdmins({
      type: 'pnl_update',
      uid,
      data: { pnl },
      timestamp: Date.now(),
    });
  }

  notifyAccuracyUpdate(uid: string, accuracy: number): void {
    this.broadcastToAdmins({
      type: 'accuracy_update',
      uid,
      data: { accuracy },
      timestamp: Date.now(),
    });
  }

  notifyError(uid: string, error: any): void {
    this.broadcastToAdmins({
      type: 'error',
      uid,
      data: { error: error.message || error },
      timestamp: Date.now(),
    });
  }

  notifyResearchUpdate(uid: string, research: any): void {
    this.broadcastToAdmins({
      type: 'research_update',
      uid,
      data: research,
      timestamp: Date.now(),
    });
  }
}

export const adminWebSocketManager = new AdminWebSocketManager();

