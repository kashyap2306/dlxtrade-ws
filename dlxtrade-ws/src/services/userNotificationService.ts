import WebSocket from 'ws';
import { logger } from '../utils/logger';

export interface NotificationAlert {
  type: 'autoTrade' | 'accuracy' | 'whale' | 'confirmTrade';
  coin?: string;
  accuracy?: number;
  amount?: number;
  side?: 'buy' | 'sell';
  direction?: 'buy' | 'sell';
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  takeProfit3?: number;
  title: string;
  message: string;
  executionTime?: string;
  data?: any;
}

export class UserNotificationService {
  private userSockets: Map<string, Set<WebSocket>> = new Map();

  /**
   * Register a WebSocket connection for a user
   */
  registerUserSocket(uid: string, socket: WebSocket): void {
    if (!this.userSockets.has(uid)) {
      this.userSockets.set(uid, new Set());
    }
    this.userSockets.get(uid)!.add(socket);

    logger.debug({ uid, totalSockets: this.userSockets.get(uid)!.size }, 'User WebSocket registered for notifications');

    // Clean up on socket close
    socket.on('close', () => {
      this.unregisterUserSocket(uid, socket);
    });

    socket.on('error', () => {
      this.unregisterUserSocket(uid, socket);
    });
  }

  /**
   * Unregister a WebSocket connection for a user
   */
  unregisterUserSocket(uid: string, socket: WebSocket): void {
    const userSockets = this.userSockets.get(uid);
    if (userSockets) {
      userSockets.delete(socket);
      if (userSockets.size === 0) {
        this.userSockets.delete(uid);
      }
      logger.debug({ uid, remainingSockets: userSockets.size }, 'User WebSocket unregistered from notifications');
    }
  }

  /**
   * Send a notification alert to a specific user
   */
  sendAlertToUser(uid: string, alert: NotificationAlert): void {
    const userSockets = this.userSockets.get(uid);
    if (!userSockets || userSockets.size === 0) {
      logger.debug({ uid, alertType: alert.type }, 'No active WebSocket connections for user, skipping alert');
      return;
    }

    const message = JSON.stringify({
      type: 'newAlert',
      alert,
      timestamp: Date.now()
    });

    let sent = 0;
    for (const socket of userSockets) {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(message);
          sent++;
        } catch (err) {
          logger.error({ err, uid }, 'Error sending WebSocket notification');
          userSockets.delete(socket);
        }
      } else {
        userSockets.delete(socket);
      }
    }

    // Clean up empty socket sets
    if (userSockets.size === 0) {
      this.userSockets.delete(uid);
    }

    if (sent > 0) {
      logger.info({ uid, alertType: alert.type, sent, totalSockets: userSockets.size }, 'Notification alert sent to user');
    }
  }

  /**
   * Send auto-trade alert to user
   */
  sendAutoTradeAlert(uid: string, coin: string, side: 'buy' | 'sell', entry: number, sl: number, tp: number, accuracy: number): void {
    const time = new Date().toLocaleTimeString();
    this.sendAlertToUser(uid, {
      type: 'autoTrade',
      coin,
      side,
      entryPrice: entry,
      stopLoss: sl,
      takeProfit: tp,
      accuracy,
      executionTime: time,
      title: 'Auto-Trade Executed',
      message: `${side.toUpperCase()} ${coin} executed successfully at ${entry} (${accuracy.toFixed(1)}% accuracy)`,
      data: { coin, side, entry, sl, tp, accuracy, timestamp: Date.now() }
    });
  }

  /**
   * Send high accuracy alert to user
   */
  sendAccuracyAlert(uid: string, coin: string, accuracy: number): void {
    this.sendAlertToUser(uid, {
      type: 'accuracy',
      coin,
      accuracy,
      title: 'High Accuracy Alert',
      message: `High accuracy detected: ${accuracy.toFixed(1)}% for ${coin}`,
      data: { coin, accuracy, timestamp: Date.now() }
    });
  }

  /**
   * Send whale movement alert to user
   */
  sendWhaleAlert(uid: string, coin: string, direction: 'buy' | 'sell', amount: number): void {
    this.sendAlertToUser(uid, {
      type: 'whale',
      coin,
      direction,
      amount,
      title: 'Whale Movement Alert',
      message: `Whale Alert: Large ${direction} detected on ${coin} (${amount.toLocaleString()} USD)`,
      data: { coin, direction, amount, timestamp: Date.now() }
    });
  }

  /**
   * Send trade confirmation alert to user
   */
  sendTradeConfirmationAlert(uid: string, data: {
    coin: string;
    side: 'buy' | 'sell';
    entry: number;
    sl: number;
    tp: number;
    tp1?: number;
    tp2?: number;
    tp3?: number;
    accuracy: number;
    requestId: string;
  }): void {
    this.sendAlertToUser(uid, {
      type: 'confirmTrade',
      coin: data.coin,
      side: data.side,
      entryPrice: data.entry,
      stopLoss: data.sl,
      takeProfit: data.tp,
      takeProfit1: data.tp1,
      takeProfit2: data.tp2,
      takeProfit3: data.tp3,
      accuracy: data.accuracy,
      title: 'Trade Confirmation Required',
      message: `Action Required: Confirm your ${data.side.toUpperCase()} trade for ${data.coin}`,
      data: { ...data, timestamp: Date.now() }
    });
  }

  /**
   * Get connection count for a user
   */
  getUserConnectionCount(uid: string): number {
    return this.userSockets.get(uid)?.size || 0;
  }

  /**
   * Get total active connections
   */
  getTotalConnections(): number {
    let total = 0;
    for (const sockets of this.userSockets.values()) {
      total += sockets.size;
    }
    return total;
  }

  /**
   * Clean up all connections (for shutdown)
   */
  cleanup(): void {
    for (const [uid, sockets] of this.userSockets.entries()) {
      for (const socket of sockets) {
        try {
          socket.close();
        } catch (err) {
          // Ignore errors during cleanup
        }
      }
    }
    this.userSockets.clear();
    logger.info('User notification service cleaned up');
  }
}

export const userNotificationService = new UserNotificationService();
