/**
 * Telegram Alert Orchestrator
 * ONLY orchestration logic that calls config → formatter → sender
 */

import { formatTelegramMessage } from './telegramMessageFormatter';
import { validateTelegramAlertConfig, getTelegramConfig } from './telegramConfigService';
import { sendTelegramAlert } from './telegramAlertSender';

export async function sendConsolidatedTelegramAlert(
  uid: string,
  alertType: 'research' | 'execution' | 'skipped',
  data: {
    symbol?: string;
    signal?: string;
    accuracy?: number;
    reason?: string;
    entryPrice?: number;
    stopLoss?: number;
    takeProfit?: number;
    takeProfit1?: number;
    takeProfit2?: number;
    takeProfit3?: number;
    tradePlan?: any;
    requestId?: string;
  }
): Promise<void> {
  try {
    const isConfigValid = await validateTelegramAlertConfig(uid);
    if (!isConfigValid) {
      return; // Silently skip if Telegram not configured
    }

    const telegramConfig = await getTelegramConfig(uid);

    const timestamp = new Date().toISOString();
    const message = formatTelegramMessage(alertType, data, timestamp);

    if (message) {
      await sendTelegramAlert(
        uid,
        alertType,
        data.symbol,
        telegramConfig.botToken!,
        telegramConfig.chatId!,
        message
      );
    }
  } catch (error: any) {
    const logger = (await import('../utils/logger')).logger;
    logger.warn({ uid, alertType, error: error.message }, `Failed to send Telegram ${alertType} alert`);
  }
}
