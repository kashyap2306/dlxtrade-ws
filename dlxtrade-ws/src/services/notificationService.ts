import { logger } from '../utils/logger';
import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';

export interface TradeNotification {
  userId: string;
  type: 'trade_executed' | 'trade_failed' | 'trade_cancelled';
  symbol: string;
  signal: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  orderId: string;
  dryRun?: boolean;
  error?: string;
}

export class NotificationService {
  private static instance: NotificationService;

  private constructor() {}

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Send trade notification to user
   */
  async sendTradeNotification(notification: TradeNotification): Promise<void> {
    try {
      const { userId, type, symbol, signal, quantity, price, orderId, dryRun, error } = notification;

      // Create notification message
      let message = '';
      let title = '';

      switch (type) {
        case 'trade_executed':
          title = `Trade ${dryRun ? 'Simulated' : 'Executed'}`;
          message = `${dryRun ? 'Simulated ' : ''}${signal} ${quantity.toFixed(6)} ${symbol.replace('USDT', '')} at $${price.toFixed(2)} (Order: ${orderId})`;
          break;
        case 'trade_failed':
          title = 'Trade Failed';
          message = `Failed to execute ${signal} order for ${symbol}: ${error}`;
          break;
        case 'trade_cancelled':
          title = 'Trade Cancelled';
          message = `Order ${orderId} for ${symbol} has been cancelled`;
          break;
      }

      // Store notification in Firestore
      await getFirebaseAdmin().firestore().collection('notifications').add({
        userId,
        type,
        title,
        message,
        symbol,
        signal,
        quantity,
        price,
        orderId,
        dryRun,
        error,
        read: false,
        timestamp: admin.firestore.Timestamp.now(),
        createdAt: admin.firestore.Timestamp.now()
      });

      // TODO: Implement additional notification channels (email, Telegram, etc.)
      // For now, just log the notification
      logger.info({
        userId: userId.substring(0, 8) + '...',
        type,
        title,
        message
      }, 'Trade notification sent');

    } catch (error) {
      logger.error({ error }, 'Failed to send trade notification');
    }
  }

  /**
   * Send research notification to user
   */
  async sendResearchNotification(notification: {
    userId: string;
    type: 'research_completed' | 'research_failed';
    symbol: string;
    signal?: 'BUY' | 'SELL' | 'HOLD';
    accuracy?: number;
    error?: string;
  }): Promise<void> {
    try {
      const { userId, type, symbol, signal, accuracy, error } = notification;

      let title = '';
      let message = '';

      switch (type) {
        case 'research_completed':
          title = 'Research Completed';
          message = `Analysis for ${symbol} completed. Signal: ${signal}, Accuracy: ${accuracy ? (accuracy * 100).toFixed(1) : 'N/A'}%`;
          break;
        case 'research_failed':
          title = 'Research Failed';
          message = `Failed to analyze ${symbol}: ${error}`;
          break;
      }

      await getFirebaseAdmin().firestore().collection('notifications').add({
        userId,
        type,
        title,
        message,
        symbol,
        signal,
        accuracy,
        error,
        read: false,
        timestamp: admin.firestore.Timestamp.now(),
        createdAt: admin.firestore.Timestamp.now()
      });

      logger.info({
        userId: userId.substring(0, 8) + '...',
        type,
        title,
        symbol
      }, 'Research notification sent');

    } catch (error) {
      logger.error({ error }, 'Failed to send research notification');
    }
  }
}

export const notificationService = NotificationService.getInstance();
