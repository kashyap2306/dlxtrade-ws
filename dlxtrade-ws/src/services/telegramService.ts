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

export interface AlertMetadata {
  alertId: string;
  uid: string;
  symbol: string;
  mode: 'MANUAL' | 'TELEGRAM_BACKGROUND' | 'AUTO_TRADE';
  accuracy: number;
  status: 'ATTEMPT' | 'RETRY' | 'SENT' | 'FAILED' | 'SKIPPED';
  reason?: string;
  attemptNumber?: number;
}

export class TelegramService {
  /**
   * Send Telegram message with retry mechanism
   * Max 2 retries with exponential backoff: 2s → 5s
   */
  async sendMessage(
    botToken: string, 
    chatId: string, 
    message: string,
    metadata?: AlertMetadata
  ): Promise<{ success: boolean; error?: string; alertId?: string }> {
    const alertId = metadata?.alertId || `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const maxRetries = 2;
    const backoffDelays = [2000, 5000]; // 2s, 5s

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const isRetry = attempt > 0;
      const status: AlertMetadata['status'] = isRetry ? 'RETRY' : attempt === 0 ? 'ATTEMPT' : 'FAILED';

      if (metadata) {
        logger.info({
          alertId,
          uid: metadata.uid,
          symbol: metadata.symbol,
          mode: metadata.mode,
          accuracy: metadata.accuracy,
          status,
          attemptNumber: attempt + 1,
          isRetry
        }, `📱 [TELEGRAM_ALERT] ${isRetry ? 'Retry' : 'Attempt'} ${attempt + 1}/${maxRetries + 1}`);
      }

      try {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        // CRITICAL: Add timeout to prevent blocking event loop
        const response = await axios.post(url, {
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        }, {
          timeout: 3000 // 3 second timeout
        });

        if (response.data.ok) {
          if (metadata) {
            logger.info({
              alertId,
              uid: metadata.uid,
              symbol: metadata.symbol,
              mode: metadata.mode,
              accuracy: metadata.accuracy,
              status: 'SENT',
              attemptNumber: attempt + 1
            }, '✅ [TELEGRAM_ALERT_SENT] Telegram message sent successfully');
          } else {
            logger.info({ chatId, alertId }, 'Telegram message sent successfully');
          }
          return { success: true, alertId };
        } else {
          const error = response.data.description || 'Telegram API returned error';
          if (metadata) {
            logger.error({
              alertId,
              uid: metadata.uid,
              symbol: metadata.symbol,
              mode: metadata.mode,
              accuracy: metadata.accuracy,
              status: 'FAILED',
              attemptNumber: attempt + 1,
              error
            }, '❌ [TELEGRAM_ALERT_FAILED] Telegram API returned error');
          } else {
            logger.error({ chatId, error, alertId }, 'Telegram API returned error');
          }

          // If this was the last attempt, return failure
          if (attempt === maxRetries) {
            return { success: false, error, alertId };
          }

          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, backoffDelays[attempt - 1]));
          continue;
        }
      } catch (error: any) {
        const errorMessage = error.message || 'Failed to send Telegram message';
        
        if (metadata) {
          logger.error({
            alertId,
            uid: metadata.uid,
            symbol: metadata.symbol,
            mode: metadata.mode,
            accuracy: metadata.accuracy,
            status: 'FAILED',
            attemptNumber: attempt + 1,
            error: errorMessage
          }, `❌ [TELEGRAM_ALERT_FAILED] ${isRetry ? 'Retry' : 'Attempt'} failed`);
        } else {
          logger.error({ error: errorMessage, chatId, alertId }, 'Failed to send Telegram message');
        }

        // If this was the last attempt, return failure
        if (attempt === maxRetries) {
          return { success: false, error: errorMessage, alertId };
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, backoffDelays[attempt - 1]));
      }
    }

    return { success: false, error: 'Max retries exceeded', alertId };
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

    // CRITICAL: Add timeout to prevent blocking
    const TIMEOUT_MS = 3000; // 3 seconds max

    try {
      const sendPromise = this.sendMessage(botToken, chatId, testMessage);
      const timeoutPromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
        setTimeout(() => {
          resolve({ success: false, error: 'Telegram API timeout - service may be slow' });
        }, TIMEOUT_MS);
      });

      return await Promise.race([sendPromise, timeoutPromise]);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Telegram test connection error');
      return { success: false, error: error.message || 'Failed to test Telegram connection' };
    }
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
  async sendTradeExecutionAlert(botToken: string, chatId: string, data: { symbol: string; side: 'BUY' | 'SELL'; price: number; accuracy: number; sl: number; tp: number; requestId: string }): Promise<{ success: boolean; error?: string }> {
    const { symbol, side, price, accuracy, sl, tp, requestId } = data;
    const emoji = side === 'BUY' ? '🟢' : '🔴';

    // Format prices with dynamic precision to prevent identical values
    const formatPrice = (p: number): string => {
      if (!p || p <= 0) return '0.00';
      if (p >= 1000) return p.toFixed(2);
      if (p >= 100) return p.toFixed(3);
      if (p >= 10) return p.toFixed(4);
      if (p >= 1) return p.toFixed(5);
      return p.toFixed(6);
    };

    let message = `✅ *Auto-Trade EXECUTED*\n\n`;
    message += `${emoji} **Action:** ${side}\n`;
    message += `📈 **Symbol:** ${symbol}\n`;
    message += `🎯 **Accuracy:** ${accuracy.toFixed(1)}%\n`;
    message += `💰 **Entry Price:** $${formatPrice(price)}\n`;
    message += `🛡️ **Stop Loss:** $${formatPrice(sl)}\n`;
    message += `🎯 **Take Profit:** $${formatPrice(tp)}\n`;
    message += `\n🆔 *Request ID:* \`${requestId}\``;

    return await this.sendMessage(botToken, chatId, message);
  }

  async sendTradeSkippedAlert(botToken: string, chatId: string, data: { symbol: string; reason: string; accuracy?: number }): Promise<{ success: boolean; error?: string }> {
    const { symbol, reason, accuracy } = data;

    let message = `⚠️ *Auto-Trade SKIPPED*\n\n`;
    message += `📈 **Symbol:** ${symbol}\n`;
    if (accuracy !== undefined) {
      message += `🎯 **Accuracy:** ${accuracy.toFixed(1)}%\n`;
    }
    message += `❗ **Reason:** ${reason}`;

    return await this.sendMessage(botToken, chatId, message);
  }

  async sendTradeClosedAlert(botToken: string, chatId: string, data: { symbol: string; side: 'BUY' | 'SELL'; pnl: number; exitPrice: number; reason: 'TP' | 'SL' | 'MANUAL' | 'PANIC' }): Promise<{ success: boolean; error?: string }> {
    const { symbol, side, pnl, exitPrice, reason } = data;
    const isWin = pnl > 0;
    const resultEmoji = isWin ? '✅' : '❌';
    const typeLabel = reason === 'TP' ? 'Take Profit HIT' : reason === 'SL' ? 'Stop Loss HIT' : `Closed (${reason})`;

    // Format prices with dynamic precision to prevent identical values
    const formatPrice = (p: number): string => {
      if (!p || p <= 0) return '0.00';
      if (p >= 1000) return p.toFixed(2);
      if (p >= 100) return p.toFixed(3);
      if (p >= 10) return p.toFixed(4);
      if (p >= 1) return p.toFixed(5);
      return p.toFixed(6);
    };

    let message = `${resultEmoji} *Trade CLOSED: ${typeLabel}*\n\n`;
    message += `📈 **Symbol:** ${symbol}\n`;
    message += `📑 **Side:** ${side}\n`;
    message += `💰 **Exit Price:** $${formatPrice(exitPrice)}\n`;
    message += `💵 **PnL:** ${isWin ? '+' : ''}${pnl.toFixed(2)} USDT\n`;
    message += `\n${isWin ? '🚀 To the moon!' : '📉 Better luck next time.'}`;

    return await this.sendMessage(botToken, chatId, message);
  }
}

export const telegramService = new TelegramService();
