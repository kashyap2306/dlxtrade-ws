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

      // Get user's notification preferences (defaults since SettingsDocument doesn't include these)
      const notificationPrefs = {
        enableAutoTradeAlerts: false,
        enableAccuracyAlerts: false,
        enableWhaleAlerts: false,
        tradeConfirmationRequired: false
      };

      logger.info({ uid, notificationPrefs }, 'Running background research for user');

      // Run deep research using the existing research engine
      const research = await researchEngine.runResearch('BTCUSDT', uid);
      if (!research) {
        logger.warn({ uid }, 'No research result returned');
        return;
      }

      // Update last research run timestamp
      await firestoreAdapter.saveBackgroundResearchSettings(uid, {
        ...settings,
        lastResearchRun: admin.firestore.Timestamp.now(),
      });

      const accuracyPercent = Math.round(research.accuracy * 100);
      const coin = 'BTCUSDT'; // Default for now, can be enhanced to analyze multiple coins

      // Check for auto-trade trigger
      const triggerThreshold = settings.accuracyTrigger || 80;
      let shouldAutoTrade = false;

      if (triggerThreshold >= 95) {
        shouldAutoTrade = accuracyPercent >= 95;
      } else if (triggerThreshold >= 85) {
        shouldAutoTrade = accuracyPercent >= 85;
      } else if (triggerThreshold >= 75) {
        shouldAutoTrade = accuracyPercent >= 75;
      } else {
        shouldAutoTrade = accuracyPercent >= 60;
      }

      // Send notifications based on user preferences
      let alertTriggered = false;

      // 1. Auto-trade trigger notification
      if (shouldAutoTrade && notificationPrefs.enableAutoTradeAlerts) {
        userNotificationService.sendAutoTradeAlert(uid, coin, accuracyPercent);
        alertTriggered = true;
      }

      // 2. High accuracy alert (when accuracy crosses 80%)
      if (accuracyPercent >= 80 && notificationPrefs.enableAccuracyAlerts) {
        userNotificationService.sendAccuracyAlert(uid, coin, accuracyPercent);
        alertTriggered = true;
      }

      // 3. Trade confirmation required
      if (shouldAutoTrade && notificationPrefs.tradeConfirmationRequired) {
        userNotificationService.sendTradeConfirmationAlert(uid, coin, accuracyPercent);
        alertTriggered = true;
      }

      // 4. Whale movement detection (simplified - can be enhanced with real whale tracking)
      // For now, we'll simulate whale detection based on volume spikes
      if ((research.microSignals?.volume || 0) > 50000 && notificationPrefs.enableWhaleAlerts) {
        const direction = research.signal === 'BUY' ? 'buy' : 'sell';
        const simulatedAmount = Math.floor(Math.random() * 500000) + 100000; // Simulated amount
        userNotificationService.sendWhaleAlert(uid, coin, direction, simulatedAmount);
        alertTriggered = true;
      }

      if (alertTriggered) {
        logger.info({ uid, accuracyPercent, coin }, 'Background research alerts sent');
      }

      // Send Telegram alert
      if (settings.telegramBotToken && settings.telegramChatId) {
        try {
          logger.info({ uid, accuracyPercent }, 'Sending Telegram alert for high accuracy signal');

          // Get additional research data for the alert
          let fullReport = '';
          try {
            fullReport = `Signal: ${research.signal}\nAccuracy: ${accuracyPercent}%\nRecommended Action: ${research.recommendedAction || 'N/A'}`;
          } catch (err: any) {
            fullReport = `Signal: ${research.signal}\nAccuracy: ${accuracyPercent}%\nBasic analysis completed.`;
          }

          const alertData = {
            symbol: coin,
            accuracy: research.accuracy,
            trend: research.signal === 'BUY' ? 'Bullish' : research.signal === 'SELL' ? 'Bearish' : 'Neutral',
            volumeSpike: (research.microSignals?.volume || 0) > 50000,
            support: undefined,
            resistance: undefined,
            fullReport,
          };

          const telegramResult = await telegramService.sendResearchAlert(
            settings.telegramBotToken,
            settings.telegramChatId,
            alertData
          );

          if (telegramResult.success) {
            logger.info({ uid }, 'Telegram alert sent successfully');
          } else {
            logger.error({ uid, error: telegramResult.error }, 'Failed to send Telegram alert');
          }
        } catch (error: any) {
          logger.error({ error: error.message, uid }, 'Error sending Telegram alert');
        }
      }
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error processing user background research');
    }
  }
}

export const backgroundResearchScheduler = new BackgroundResearchScheduler();
