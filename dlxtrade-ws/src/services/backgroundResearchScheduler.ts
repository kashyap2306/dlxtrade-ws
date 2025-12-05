import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { researchEngine } from './researchEngine';
import { telegramService } from './telegramService';
import { userNotificationService } from './userNotificationService';
import { getFirebaseAdmin } from '../utils/firebase';
import * as admin from 'firebase-admin';

export class BackgroundResearchScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private userIntervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Start the background research scheduler
   */
  start() {
    if (this.isRunning) {
      logger.warn('Background research scheduler is already running');
      return;
    }
    this.isRunning = true;
    logger.info('Starting background research scheduler');

    // Check for users with enabled background research every minute
    this.intervalId = setInterval(() => {
      this.checkAndScheduleUserResearch();
    }, 60 * 1000);

    // Initial check
    setTimeout(() => {
      this.checkAndScheduleUserResearch();
    }, 5000);
  }

  /**
   * Stop the background research scheduler
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Clear all user-specific intervals
    for (const [uid, intervalId] of this.userIntervals.entries()) {
      clearInterval(intervalId);
      logger.debug({ uid }, 'User research interval cleared');
    }
    this.userIntervals.clear();

    this.isRunning = false;
    logger.info('Background research scheduler stopped');
  }

  /**
   * Check all users and schedule/cancel their research intervals as needed
   */
  private async checkAndScheduleUserResearch() {
    try {
      logger.debug('Checking users for background research scheduling');

      const usersSnapshot = await admin.firestore((getFirebaseAdmin())).collection('users').get();

      for (const userDoc of usersSnapshot.docs) {
        const uid = userDoc.id;
        await this.updateUserResearchSchedule(uid);
      }
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error checking user research schedules');
    }
  }

  /**
   * Update research schedule for a specific user based on their settings
   */
  private async updateUserResearchSchedule(uid: string) {
    try {
      const settings = await firestoreAdapter.getBackgroundResearchSettings(uid);

      if (!settings || !settings.backgroundResearchEnabled) {
        // Cancel existing interval if user disabled research
        const existingInterval = this.userIntervals.get(uid);
        if (existingInterval) {
          clearInterval(existingInterval);
          this.userIntervals.delete(uid);
          logger.info({ uid }, 'User background research disabled, interval cancelled');
        }
        return;
      }

      const frequencyMinutes = settings.researchFrequencyMinutes || 5;
      const intervalMs = frequencyMinutes * 60 * 1000;

      // Check if we need to update the interval
      const existingInterval = this.userIntervals.get(uid);
      if (existingInterval) {
        // For simplicity, we'll restart intervals if frequency changed
        // In production, you might want to track the frequency and only restart if changed
        clearInterval(existingInterval);
        this.userIntervals.delete(uid);
      }

      // Schedule user-specific research
      const userInterval = setInterval(() => {
        this.processUserResearch(uid);
      }, intervalMs);

      this.userIntervals.set(uid, userInterval);

      logger.info({ uid, frequencyMinutes }, 'User background research scheduled');

      // Run immediately for new schedules (with a small delay to avoid spam)
      setTimeout(() => {
        this.processUserResearch(uid);
      }, Math.random() * 5000); // Random delay up to 5 seconds

    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error updating user research schedule');
    }
  }

  /**
   * Handle settings update for a user (call this when user settings change)
   */
  async onUserSettingsChanged(uid: string) {
    await this.updateUserResearchSchedule(uid);
  }

  /**
   * Process background research for a single user
   */
  private async processUserResearch(uid: string) {
    try {
      // Get user's background research settings
      const settings = await firestoreAdapter.getBackgroundResearchSettings(uid);
      if (!settings || !settings.backgroundResearchEnabled) {
        return; // Skip if not enabled
      }

      // Get user's selected coins and trading settings
      const userSettings = await firestoreAdapter.getSettings(uid) || {} as any;
      const selectedCoins = settings.selectedCoins || userSettings.tradingSettings?.manualCoins || ['BTCUSDT'];
      const accuracyTrigger = settings.accuracyTrigger || userSettings.tradingSettings?.accuracyTrigger || 80;

      // Get user's notification settings
      const notifications = userSettings.notifications || {
        autoTradeAlerts: false,
        accuracyAlerts: false,
        whaleAlerts: false,
        confirmBeforeTrade: false,
        playSound: false,
        vibrate: false
      };

      // Get user's provider settings
      const userProviderSettings = await firestoreAdapter.getUserProviderSettings(uid) || {};

      logger.info({ uid, selectedCoins, accuracyTrigger }, 'Running background research for user');

      // Process each selected coin
      for (const coin of selectedCoins) {
        try {
          logger.debug({ uid, coin }, 'Processing coin for background research');

          // Run deep research using the existing research engine
          const research = await researchEngine.runResearch(coin, uid);

          if (!research) {
            logger.warn({ uid, coin }, 'No research result returned for coin');
            continue;
          }

          const accuracyPercent = Math.round(research.accuracy * 100);

          // Check if accuracy crosses the trigger threshold
          const shouldTriggerAlert = accuracyPercent >= accuracyTrigger;

          // Send notifications based on user preferences
          let alertTriggered = false;

          // 1. Auto-trade trigger notification
          if (shouldTriggerAlert && notifications.autoTradeAlerts) {
            userNotificationService.sendAutoTradeAlert(uid, coin, accuracyPercent);
            alertTriggered = true;
          }

          // 2. High accuracy alert
          if (shouldTriggerAlert && notifications.accuracyAlerts) {
            userNotificationService.sendAccuracyAlert(uid, coin, accuracyPercent);
            alertTriggered = true;
          }

          // 3. Trade confirmation required
          if (shouldTriggerAlert && notifications.confirmBeforeTrade) {
            userNotificationService.sendTradeConfirmationAlert(uid, coin, accuracyPercent);
            alertTriggered = true;
          }

          // 4. Whale movement detection
          if ((research.microSignals?.volume || 0) > 50000 && notifications.whaleAlerts) {
            const direction = research.signal === 'BUY' ? 'buy' : 'sell';
            const simulatedAmount = Math.floor(Math.random() * 500000) + 100000;
            userNotificationService.sendWhaleAlert(uid, coin, direction, simulatedAmount);
            alertTriggered = true;
          }

          if (alertTriggered) {
            logger.info({ uid, accuracyPercent, coin }, 'Background research alerts sent');
          }

          // Send Telegram alert if accuracy crosses trigger
          if (shouldTriggerAlert && settings.telegramBotToken && settings.telegramChatId) {
            await this.sendTelegramAlertWithRetry(uid, settings, research, coin, accuracyPercent);
          }

        } catch (coinError: any) {
          logger.error({ error: coinError.message, uid, coin }, 'Error processing coin in background research');
        }
      }

      // Update last research run timestamp
      await firestoreAdapter.saveBackgroundResearchSettings(uid, {
        ...settings,
        lastResearchRun: admin.firestore.Timestamp.now(),
      });

      logger.info({ uid }, 'Background research completed for user');

    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error processing user background research');
    }
  }

  /**
   * Send Telegram alert with retry logic and backoff
   */
  private async sendTelegramAlertWithRetry(
    uid: string,
    settings: any,
    research: any,
    coin: string,
    accuracyPercent: number,
    maxRetries: number = 3
  ): Promise<void> {
    let attempt = 0;
    let delay = 1000; // Start with 1 second delay

    while (attempt < maxRetries) {
      try {
        logger.info({ uid, accuracyPercent, coin, attempt: attempt + 1 }, 'Sending Telegram alert for high accuracy signal');

        // Calculate suggested position size using positionSizingMap from user settings
        const userSettings = await firestoreAdapter.getSettings(uid) || {} as any;
        const positionSizingMap = userSettings.tradingSettings?.positionSizingMap || [];
        const suggestedPositionSize = this.calculatePositionSize(accuracyPercent, positionSizingMap);

        // Get provider information used
        const providersUsed = this.getProvidersUsed(research);

        // Format the Telegram message according to requirements
        const timestamp = new Date().toISOString();
        const signal = research.signal || 'HOLD';
        const positionSize = suggestedPositionSize > 0 ? `$${suggestedPositionSize.toFixed(2)}` : 'N/A';

        const message = `🚨 *DLXTRADE High-Accuracy Signal Alert*

📅 **Timestamp:** ${timestamp}
📈 **Coin:** ${coin}
🎯 **Accuracy:** ${accuracyPercent}%
📊 **Signal:** ${signal}
💰 **Suggested Position Size:** ${positionSize}
🔧 **Providers Used:** ${providersUsed.join(', ')}

📋 **Signal Details:**
${research.recommendedAction || 'Deep research analysis completed'}

⚡ *Action Required:* Review and execute trade if conditions are favorable.`;

        const telegramResult = await telegramService.sendMessage(
          settings.telegramBotToken,
          settings.telegramChatId,
          message
        );

        if (telegramResult.success) {
          logger.info({ uid, coin }, 'Telegram alert sent successfully');
          return;
        } else {
          throw new Error(telegramResult.error || 'Telegram API error');
        }

      } catch (error: any) {
        attempt++;
        logger.error({
          error: error.message,
          uid,
          coin,
          attempt,
          maxRetries
        }, `Telegram alert attempt ${attempt} failed`);

        if (attempt < maxRetries) {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Double the delay for next attempt
        }
      }
    }

    logger.error({ uid, coin, maxRetries }, 'All Telegram alert attempts failed');
  }

  /**
   * Calculate suggested position size based on accuracy and position sizing map
   */
  private calculatePositionSize(accuracyPercent: number, positionSizingMap: any[]): number {
    // Find the appropriate range for this accuracy
    for (const range of positionSizingMap) {
      if (accuracyPercent >= range.min && accuracyPercent <= range.max) {
        return range.percent;
      }
    }
    // Default fallback
    return 1.0;
  }

  /**
   * Extract providers used from research result
   */
  private getProvidersUsed(research: any): string[] {
    const providers: string[] = [];

    // Check which providers returned successful data
    if (research.providers?.marketData?.success) providers.push('Market Data');
    if (research.providers?.metadata?.success) providers.push('Metadata');
    if (research.providers?.cryptocompare?.success) providers.push('CryptoCompare');
    if (research.providers?.news?.success) providers.push('News');

    return providers.length > 0 ? providers : ['Multiple Providers'];
  }
}

export const backgroundResearchScheduler = new BackgroundResearchScheduler();
