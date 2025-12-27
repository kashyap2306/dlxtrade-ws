/**
 * Telegram Alert Decision Service
 * ONLY decision logic that determines WHETHER and WHAT alert to send
 */

import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';

export interface TelegramAlertDecision {
  shouldSend: boolean;
  reason: string;
  alertData?: {
    symbol: string;
    signal: string;
    accuracy: number;
    tradePlan?: any;
  };
}

export async function evaluateTelegramAlertDecision(
  uid: string,
  symbol: string,
  signal: string,
  accuracy: number,
  tradePlan: any,
  alertId: string
): Promise<TelegramAlertDecision> {
  const bgSettings = await firestoreAdapter.getBackgroundResearchSettings(uid);

  // HARD LOG: Telegram alert evaluation start
  logger.info({
    alertId,
    uid,
    symbol,
    mode: 'AUTO_TRADE',
    accuracy,
    telegramConfigured: !!(bgSettings?.telegramBotToken && bgSettings?.telegramChatId),
    alertSource: 'AUTO_TRADE_ENGINE',
    telegramEngineBypassed: true
  }, '📱 [TELEGRAM_ALERT_EVAL] Evaluating Telegram alert from Auto-Trade engine (Telegram Background Research engine BYPASSED)');

  // HARD LOG: Active mode and frequency source
  logger.info({
    alertId,
    uid,
    symbol,
    activeMode: 'AUTO_TRADE',
    frequencySource: 'AUTO_TRADE',
    telegramEngineBypassed: true,
    alertSource: 'AUTO_TRADE_ENGINE',
    timestamp: new Date().toISOString()
  }, '📱 [TELEGRAM_MODE] Active mode: AUTO_TRADE - frequency from Auto-Trade settings, Telegram Background Research engine BYPASSED');

  // Check Telegram configuration
  if (!bgSettings?.telegramBotToken || !bgSettings?.telegramChatId) {
    logger.info({
      alertId,
      uid,
      symbol,
      mode: 'AUTO_TRADE',
      accuracy,
      status: 'SKIPPED',
      reason: 'Telegram configuration missing',
      alertSource: 'AUTO_TRADE_ENGINE'
    }, '⏭️ [TELEGRAM_ALERT_SKIPPED] Auto-trade alert skipped - Telegram not configured');

    return {
      shouldSend: false,
      reason: 'Telegram configuration missing'
    };
  } else {
    // Check accuracy threshold (from Telegram Background settings)
    // CRITICAL: Threshold comes from Telegram settings, but alert is sent from Auto-Trade engine
    // CRITICAL: Alert must trigger on research completion when accuracy >= trigger
    // CRITICAL: Trade execution is NOT required for alert
    const telegramAccuracyTrigger = bgSettings.accuracyTrigger;
    const minTrigger = telegramAccuracyTrigger?.min ?? (typeof telegramAccuracyTrigger === 'number' ? telegramAccuracyTrigger : 80);
    const maxTrigger = telegramAccuracyTrigger?.max ?? 100;
    const isInRange = accuracy >= minTrigger && accuracy <= maxTrigger;

    // HARD LOG: Active mode, frequency source, accuracy threshold check
    logger.info({
      alertId,
      uid,
      symbol,
      activeMode: 'AUTO_TRADE',
      frequencySource: 'AUTO_TRADE',
      telegramEngineBypassed: true,
      alertSource: 'AUTO_TRADE_ENGINE',
      accuracy,
      minTrigger,
      maxTrigger,
      isInRange,
      thresholdSource: 'TELEGRAM_SETTINGS',
      decision: isInRange ? 'SEND_ALERT' : 'SKIP_ALERT',
      reason: isInRange ? 'Accuracy >= trigger' : `Accuracy ${accuracy.toFixed(1)}% outside range [${minTrigger}-${maxTrigger}]%`
    }, '📱 [TELEGRAM_ALERT_THRESHOLD] Active mode: AUTO_TRADE, frequency source: AUTO_TRADE, accuracy threshold check - threshold from Telegram settings, alert from Auto-Trade engine');

    if (!isInRange) {
      logger.info({
        alertId,
        uid,
        symbol,
        activeMode: 'AUTO_TRADE',
        frequencySource: 'AUTO_TRADE',
        accuracy,
        minTrigger,
        maxTrigger,
        status: 'SKIPPED',
        reason: `Accuracy ${accuracy.toFixed(1)}% outside range [${minTrigger}-${maxTrigger}]%`
      }, '⏭️ [TELEGRAM_ALERT_SKIPPED] Auto-trade alert skipped - accuracy outside threshold');

      return {
        shouldSend: false,
        reason: `Accuracy ${accuracy.toFixed(1)}% outside range [${minTrigger}-${maxTrigger}]%`
      };
    } else {
      // CRITICAL: Alert must be sent EVERY TIME research completes AND accuracy >= trigger
      // CRITICAL: Trade execution is NOT required for alert
      // CRITICAL: Alerts fire based on accuracy threshold ONLY, not trade execution status
      logger.info({
        alertId,
        uid,
        symbol,
        activeMode: 'AUTO_TRADE',
        frequencySource: 'AUTO_TRADE',
        accuracy,
        minTrigger,
        maxTrigger,
        thresholdMet: true,
        status: 'SENDING',
        reason: 'Accuracy >= trigger, alert sent on research completion (trade execution not required)'
      }, '📱 [TELEGRAM_ALERT_SEND] Sending Telegram alert from Auto-Trade engine - accuracy >= trigger on research completion');

      return {
        shouldSend: true,
        reason: 'Accuracy >= trigger, alert sent on research completion (trade execution not required)',
        alertData: {
          symbol,
          signal,
          accuracy,
          tradePlan
        }
      };
    }
  }
}
