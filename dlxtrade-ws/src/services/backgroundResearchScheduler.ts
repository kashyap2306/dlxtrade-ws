import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { researchEngine } from './researchEngine';
import { telegramService } from './telegramService';
import { getFirebaseAdmin } from '../utils/firebase';
import * as admin from 'firebase-admin';

export class BackgroundResearchScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start the background research scheduler (runs every minute)
   */
  start() {
    if (this.isRunning) {
      logger.warn('Background research scheduler is already running');
      return;
    }
    this.isRunning = true;
    logger.info('Starting background research scheduler (every minute)');

    // Run every minute
    this.intervalId = setInterval(() => {
      this.runScheduledResearch();
    }, 60 * 1000);

    // Run immediately on start for testing
    setTimeout(() => {
      this.runScheduledResearch();
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
    this.isRunning = false;
    logger.info('Background research scheduler stopped');
  }

  /**
   * Run scheduled background research for all users
   */
  private async runScheduledResearch() {
    try {
      logger.debug('Running scheduled background research check');
      // Get all users with background research enabled
      const usersSnapshot = await admin.firestore((getFirebaseAdmin())).collection('users').get();
      const userPromises = [];

      for (const userDoc of usersSnapshot.docs) {
        const uid = userDoc.id;
        userPromises.push(this.processUserResearch(uid));
      }

      // Wait for all user processing to complete
      await Promise.allSettled(userPromises);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error in scheduled research run');
    }
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

      // Check if it's time to run research
      const now = new Date();
      const lastRun = settings.lastResearchRun?.toDate();
      const frequencyMinutes = settings.researchFrequencyMinutes || 5;

      if (lastRun) {
        const minutesSinceLastRun = (now.getTime() - lastRun.getTime()) / (1000 * 60);
        if (minutesSinceLastRun < frequencyMinutes) {
          return; // Not time yet
        }
      }

      logger.info({ uid, frequencyMinutes }, 'Running background research for user');

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

      // Check if accuracy meets the trigger threshold
      const accuracyPercent = Math.round(research.accuracy * 100);
      const triggerThreshold = settings.accuracyTrigger || 80;
      let shouldTrigger = false;

      if (triggerThreshold >= 95) {
        shouldTrigger = accuracyPercent >= 95;
      } else if (triggerThreshold >= 85) {
        shouldTrigger = accuracyPercent >= 85;
      } else if (triggerThreshold >= 75) {
        shouldTrigger = accuracyPercent >= 75;
      } else {
        shouldTrigger = accuracyPercent >= 60;
      }

      if (!shouldTrigger) {
        logger.debug({ uid, accuracyPercent, triggerThreshold }, 'Accuracy below trigger threshold, skipping alert');
        return;
      }

      // Send Telegram alert
      if (settings.telegramBotToken && settings.telegramChatId) {
        logger.info({ uid, accuracyPercent }, 'Sending Telegram alert for high accuracy signal');

        // Get additional research data for the alert
        const integrations = await firestoreAdapter.getEnabledIntegrations(uid);
        let fullReport = '';
        try {
          // Try to get more detailed report from research engine
          const detailedResearch = await researchEngine.runResearch('BTCUSDT', uid);
          if (detailedResearch) {
            fullReport = `Signal: ${detailedResearch.signal}\nAccuracy: ${accuracyPercent}%\nRecommended Action: ${detailedResearch.recommendedAction || 'N/A'}`;
          }
        } catch (err: any) {
          fullReport = `Signal: ${research.signal}\nAccuracy: ${accuracyPercent}%\nBasic analysis completed.`;
        }

        const alertData = {
          symbol: 'BTCUSDT',
          accuracy: research.accuracy,
          trend: research.signal === 'BUY' ? 'Bullish' : research.signal === 'SELL' ? 'Bearish' : 'Neutral',
          volumeSpike: false, // Could be enhanced later
          support: undefined, // Could be enhanced later
          resistance: undefined, // Could be enhanced later
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
      } else {
        logger.warn({ uid }, 'Telegram credentials missing, cannot send alert');
      }
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error processing user background research');
    }
  }
}

export const backgroundResearchScheduler = new BackgroundResearchScheduler();
