import axios from 'axios';
import { logger } from '../utils/logger';

export interface ResearchAlertData {
  symbol: string;
  accuracy: number;
  trend: string;
  volumeSpike?: boolean;
  support?: string;
  resistance?: string;
  fullReport: string;
}

export class TelegramService {
  async sendMessage(botToken: string, chatId: string, message: string): Promise<{ success: boolean; error?: string }> {
    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const response = await axios.post(url, {
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });

      if (response.data.ok) {
        logger.info({ chatId }, 'Telegram message sent successfully');
        return { success: true };
      } else {
        logger.error({ chatId, error: response.data }, 'Telegram API returned error');
        return { success: false, error: response.data.description };
      }
    } catch (error: any) {
      logger.error({ error: error.message, chatId }, 'Failed to send Telegram message');
      return { success: false, error: error.message };
    }
  }

  async testConnection(botToken: string, chatId: string): Promise<{ success: boolean; error?: string }> {
    // Validate bot token format
    const botTokenRegex = /^\d+:[A-Za-z0-9_-]+$/;
    if (!botTokenRegex.test(botToken)) {
      return { success: false, error: 'Invalid bot token format' };
    }

    // Validate chat ID format
    const chatIdRegex = /^(@[A-Za-z0-9_]+|-\d+|\d+)$/;
    if (!chatIdRegex.test(chatId)) {
      return { success: false, error: 'Invalid chat ID format' };
    }

    const testMessage = `🚀 *DLXTRADE Background Research Test*\n\n✅ Your Telegram bot is configured correctly!\n\nThis is a test message from your Background Deep Research system.`;
    return await this.sendMessage(botToken, chatId, testMessage);
  }

  async sendResearchAlert(botToken: string, chatId: string, researchData: ResearchAlertData): Promise<{ success: boolean; error?: string }> {
    try {
      const { symbol, accuracy, trend, volumeSpike, support, resistance, fullReport } = researchData;
      const accuracyPercent = Math.round(accuracy * 100);
      let trendEmoji = '📊';
      if (trend.toLowerCase().includes('bull')) {
        trendEmoji = '🚀';
      } else if (trend.toLowerCase().includes('bear')) {
        trendEmoji = '📉';
      }

      let message = `🚨 *High-Accuracy Signal Detected!*\n\n`;
      message += `📈 **Symbol:** ${symbol}\n`;
      message += `🎯 **Accuracy:** ${accuracyPercent}%\n`;
      message += `${trendEmoji} **Trend:** ${trend}\n`;
      if (volumeSpike) {
        message += `📊 **Volume Spike:** Yes\n`;
      }
      if (support) {
        message += `🛡️ **Support:** $${support}\n`;
      }
      if (resistance) {
        message += `🎯 **Resistance:** $${resistance}\n`;
      }
      message += `\n📋 *Full Deep Research Report included below:*\n\n`;
      message += `${fullReport}`;

      // Telegram has a 4096 character limit, so truncate if necessary
      if (message.length > 4000) {
        message = message.substring(0, 4000) + '\n\n... (message truncated)';
      }

      return await this.sendMessage(botToken, chatId, message);
    } catch (error: any) {
      logger.error({ error: error.message, chatId, symbol: researchData.symbol }, 'Failed to send research alert');
      return { success: false, error: error.message };
    }
  }
}

export const telegramService = new TelegramService();
