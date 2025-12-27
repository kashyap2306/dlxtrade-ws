/**
 * Telegram Alert Sender
 * ONLY Telegram API send logic and send result handling
 */

import { logger } from '../utils/logger';

export interface TelegramSendResult {
  success: boolean;
  error?: string;
}

export async function sendTelegramAlert(
  uid: string,
  alertType: string,
  symbol: string | undefined,
  botToken: string,
  chatId: string,
  message: string
): Promise<TelegramSendResult> {
  // Validate message before sending
  if (message.length > 4096) {
    logger.error({ uid, alertType, messageLength: message.length }, '❌ [TELEGRAM] Message too long, truncating');
    message = message.substring(0, 4090) + '...';
  }

  const { telegramService } = await import('./telegramService');

  const telegramResult = await telegramService.sendMessage(
    botToken.trim(),
    chatId.trim(),
    message.trim()
  );

  if (telegramResult.success) {
    logger.info({ uid, alertType, symbol }, `✅ [TELEGRAM_${alertType.toUpperCase()}] Alert sent successfully`);
    return { success: true };
  } else {
    logger.error({ uid, alertType, error: telegramResult.error }, `❌ [TELEGRAM_${alertType.toUpperCase()}] Alert failed`);
    return { success: false, error: telegramResult.error };
  }
}
