/**
 * Auto-Trade Telegram Notifications
 * ONLY Telegram message sending and notification logic
 * NO trading logic or execution decisions
 */

import { logger } from '../utils/logger';
import { userNotificationService } from './userNotificationService';
import type { TradeSignal } from './autoTradeEngine';

/**
 * Send trade confirmation notification to user
 */
export async function sendTradeConfirmationNotification(uid: string, signal: TradeSignal): Promise<void> {
  try {
    // Send notification that trade confirmation is required with full details
    userNotificationService.sendTradeConfirmationAlert(uid, {
      coin: signal.symbol,
      side: signal.signal.toLowerCase() as 'buy' | 'sell',
      entry: signal.entryPrice,
      sl: signal.stopLoss,
      tp: signal.takeProfit,
      tp1: signal.takeProfit1,
      tp2: signal.takeProfit2,
      tp3: signal.takeProfit3,
      accuracy: signal.accuracy,
      requestId: signal.requestId
    });

    logger.info({ uid, symbol: signal.symbol }, 'Trade confirmation notification sent with rich data');
  } catch (error: any) {
    logger.error({ uid, error: error.message }, 'Failed to send trade confirmation notification');
  }
}

/**
 * Check for whale alerts and send notifications
 */
export async function checkWhaleAlerts(uid: string, symbol: string, adapter: any, logTradeEvent: (uid: string, eventType: string, data: any) => Promise<void>): Promise<void> {
  try {
    if (!adapter) return;

    // Get 24h ticker data for whale/vol spike detection
    const ticker = await adapter.getTicker(symbol);
    if (!ticker) return;

    const priceChangePct = Math.abs(parseFloat(ticker.priceChangePercent || '0'));
    const volume = parseFloat(ticker.volume || '0');
    const quoteVolume = parseFloat(ticker.quoteVolume || '0'); // USD value usually

    // 1. PRICE WHALE: Detect large price moves (> 3% in 24h)
    if (priceChangePct >= 3.0) {
      const direction = parseFloat(ticker.priceChangePercent) > 0 ? 'buy' : 'sell';
      userNotificationService.sendWhaleAlert(uid, symbol, direction, quoteVolume);

      await logTradeEvent(uid, 'WHALE_ALERT_PRICE', {
        symbol,
        priceChangePct,
        direction,
        volume: quoteVolume
      });

      logger.info({ uid, symbol, priceChangePct }, '🐋 WHALE ALERT: Large price movement detected');
    }

    // 2. VOLUME SPIKE: Detect volume spikes (> 200% of "normal" - here we simplified to absolute large vol)
    // Normally we'd compare to 24h avg, but ticker already gives 24h sum.
    // If quoteVolume > $1,000,000 for non-major or $10,000,000 for major, it's a "whale" move in this context
    if (quoteVolume >= 5000000) { // $5M+ volume is significant
      userNotificationService.sendWhaleAlert(uid, symbol, 'buy', quoteVolume);
      logger.info({ uid, symbol, quoteVolume }, '🐋 WHALE ALERT: High volume detected');
    }

  } catch (error: any) {
    logger.error({ uid, symbol, error: error.message }, 'Failed to check whale alerts');
  }
}

