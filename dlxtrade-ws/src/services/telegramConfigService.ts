/**
 * Telegram Config Service
 * ONLY Telegram config validation and settings access logic
 */

import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';

export interface TelegramConfig {
  isEnabled: boolean;
  botToken?: string;
  chatId?: string;
}

export async function getTelegramConfig(uid: string): Promise<TelegramConfig> {
  const backgroundResearchSettings = await firestoreAdapter.getBackgroundResearchSettings(uid);
  const isEnabled = !!(backgroundResearchSettings?.telegramBotToken?.trim() && backgroundResearchSettings?.telegramChatId?.trim());

  return {
    isEnabled,
    botToken: backgroundResearchSettings?.telegramBotToken,
    chatId: backgroundResearchSettings?.telegramChatId
  };
}

export async function isTelegramEnabled(uid: string): Promise<boolean> {
  const backgroundResearchSettings = await firestoreAdapter.getBackgroundResearchSettings(uid);
  return !!(backgroundResearchSettings?.telegramBotToken?.trim() && backgroundResearchSettings?.telegramChatId?.trim());
}

export async function adjustAutoTradeFrequencyForTelegram(
  uid: string,
  baseFrequency: number
): Promise<number> {
  const isTelegramEnabled = await getTelegramConfig(uid).then(config => config.isEnabled);

  // Rule: If Telegram disabled, default Auto Trade interval to 5 minutes.
  if (!isTelegramEnabled) {
    logger.debug({ uid }, 'Telegram disabled: Forcing 5-minute auto-trade interval');
    return 5;
  }

  return baseFrequency;
}

export async function validateTelegramAlertConfig(uid: string): Promise<boolean> {
  const bgSettings = await firestoreAdapter.getBackgroundResearchSettings(uid);
  return !!(bgSettings?.telegramBotToken && bgSettings?.telegramChatId && bgSettings?.backgroundResearchEnabled);
}
