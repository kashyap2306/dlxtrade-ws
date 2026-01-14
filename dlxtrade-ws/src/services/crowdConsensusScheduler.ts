import { logger } from '../utils/logger';
import { CrowdConsensusService } from './crowdConsensusService';
import { firestoreAdapter } from './firestoreAdapter';
import { getFirebaseAdmin } from '../utils/firebase';

export class CrowdConsensusScheduler {
  private static intervalId: NodeJS.Timeout | null = null;
  private static isRunning = false;

  /**
   * Start the Crowd Consensus scheduler
   */
  static async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Crowd Consensus scheduler is already running');
      return;
    }

    try {
      this.intervalId = setInterval(async () => {
        try {
          await this.executeAllActiveAgents();
        } catch (error) {
          logger.error({
            error: error instanceof Error ? error.message : 'Unknown error'
          }, 'Error in Crowd Consensus scheduled execution');
        }
      }, 5 * 60 * 1000); // 5 minutes

      this.isRunning = true;
      logger.info('Crowd Consensus scheduler started - executing every 5 minutes');
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to start Crowd Consensus scheduler');
      throw error;
    }
  }

  /**
   * Stop the Crowd Consensus scheduler
   */
  static stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('Crowd Consensus scheduler stopped');
  }

  /**
   * Execute all active Crowd Consensus agents
   */
  static async executeAllActiveAgents(): Promise<void> {
    try {
      // Find all users with active Crowd Consensus auto trading
      const activeUsers = await this.getActiveCrowdConsensusUsers();

      if (activeUsers.length === 0) {
        logger.info('No active Crowd Consensus agents found');
        return;
      }

      logger.info({ userCount: activeUsers.length }, 'Executing Crowd Consensus agents for active users');

      // Execute for each active user
      const results = await Promise.allSettled(
        activeUsers.map(uid => this.executeAgentForUser(uid))
      );

      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const failureCount = results.filter(r => r.status === 'rejected').length;

      logger.info({
        total: activeUsers.length,
        success: successCount,
        failed: failureCount
      }, 'Completed Crowd Consensus execution cycle');

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to execute Crowd Consensus agents');
    }
  }

  /**
   * Execute Crowd Consensus agent for a specific user
   */
  static async executeAgentForUser(uid: string): Promise<void> {
    try {
      logger.info({ uid }, 'Starting Crowd Consensus execution for user');

      // Check if user has Crowd Consensus enabled
      const settings = await CrowdConsensusService.getUserSettings(uid);
      if (!settings.autoTradeEnabled) {
        logger.info({ uid }, 'Crowd Consensus auto trade disabled for user');
        return;
      }

      // Check exchange connection
      const exchangeStatus = await CrowdConsensusService.getExchangeConnectionStatus(uid);
      if (!exchangeStatus.connected) {
        await CrowdConsensusService.saveSkippedTrade(uid, {
          pair: 'BTCUSDT', // Default pair for logging
          direction: 'LONG', // Default direction for logging
          reason: 'EXCHANGE_ERROR',
          timestamp: new Date(),
          details: { exchangeStatus }
        });
        logger.warn({ uid }, 'Exchange not connected for Crowd Consensus user');
        return;
      }

      // Check daily trade limit
      const dailyTradeCount = await CrowdConsensusService.getDailyTradeCount(uid);
      if (dailyTradeCount >= 6) {
        await CrowdConsensusService.saveSkippedTrade(uid, {
          pair: 'BTCUSDT',
          direction: 'LONG',
          reason: 'DAILY_LIMIT_REACHED',
          timestamp: new Date(),
          details: { dailyTradeCount }
        });
        logger.info({ uid, dailyTradeCount }, 'Daily trade limit reached for user');
        return;
      }

      // Execute consensus analysis and trading
      await this.executeConsensusAnalysisAndTrade(uid);

      logger.info({ uid }, 'Completed Crowd Consensus execution for user');

    } catch (error) {
      logger.error({
        uid,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to execute Crowd Consensus agent for user');
    }
  }

  /**
   * Execute consensus analysis and trade for a user
   */
  static async executeConsensusAnalysisAndTrade(uid: string): Promise<void> {
    try {
      // Analyze consensus from multiple exchanges
      const consensusSignals = await CrowdConsensusService.analyzeConsensus();

      if (consensusSignals.length === 0) {
        logger.info({ uid }, 'No consensus signals found');
        return;
      }

      // Process each consensus signal
      for (const signal of consensusSignals) {
        try {
          await this.processConsensusSignal(uid, signal);
        } catch (error) {
          logger.error({
            uid,
            pair: signal.pair,
            direction: signal.direction,
            error: error instanceof Error ? error.message : 'Unknown error'
          }, 'Failed to process consensus signal');
        }
      }

    } catch (error) {
      logger.error({
        uid,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to execute consensus analysis and trade');
    }
  }

  /**
   * Process a single consensus signal for a user
   */
  static async processConsensusSignal(uid: string, signal: any): Promise<void> {
    try {
      // Validate trade setup (S/R, RR ratio, etc.)
      const validation = await CrowdConsensusService.validateTradeSetup(signal);

      if (!validation.valid) {
        await CrowdConsensusService.saveSkippedTrade(uid, {
          pair: signal.pair,
          direction: signal.direction,
          reason: (validation.reason as any) || 'EXCHANGE_ERROR',
          timestamp: new Date(),
          details: validation
        });
        logger.info({
          uid,
          pair: signal.pair,
          direction: signal.direction,
          reason: validation.reason
        }, 'Consensus signal validation failed');
        return;
      }

      // Execute the trade
      const tradeResult = await CrowdConsensusService.executeConsensusTrade(signal, uid);

      if (!tradeResult.success) {
        await CrowdConsensusService.saveSkippedTrade(uid, {
          pair: signal.pair,
          direction: signal.direction,
          reason: (tradeResult.reason as any) || 'EXCHANGE_ERROR',
          timestamp: new Date(),
          details: tradeResult
        });
        logger.warn({
          uid,
          pair: signal.pair,
          direction: signal.direction,
          reason: tradeResult.reason
        }, 'Failed to execute consensus trade');
        return;
      }

      logger.info({
        uid,
        pair: signal.pair,
        direction: signal.direction,
        tradeId: tradeResult.tradeId
      }, 'Successfully executed consensus trade');

    } catch (error) {
      logger.error({
        uid,
        pair: signal.pair,
        direction: signal.direction,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to process consensus signal');
    }
  }

  /**
   * Get users with active Crowd Consensus auto trading
   */
  static async getActiveCrowdConsensusUsers(): Promise<string[]> {
    try {
      const db = getFirebaseAdmin().firestore();

      // Query users who have Crowd Consensus enabled
      const usersRef = db.collection('users');
      const activeUsers: string[] = [];

      // Since Firestore doesn't support direct queries on subcollection fields,
      // we need to get all users and check their agent settings
      const usersSnapshot = await usersRef.get();

      for (const userDoc of usersSnapshot.docs) {
        const uid = userDoc.id;
        try {
          const agentRef = db.collection('users').doc(uid)
            .collection('agents').doc('crowd_consensus_copy_trade');
          const agentDoc = await agentRef.get();

          if (agentDoc.exists) {
            const data = agentDoc.data();
            if (data?.autoTradeEnabled === true) {
              activeUsers.push(uid);
            }
          }
        } catch (error) {
          // Skip users with errors
          logger.warn({ uid, error: error instanceof Error ? error.message : 'Unknown error' },
            'Error checking Crowd Consensus status for user');
        }
      }

      return activeUsers;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to get active Crowd Consensus users');
      return [];
    }
  }

  /**
   * Check if scheduler is running
   */
  static isSchedulerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Execute specific user agent manually (for testing)
   */
  static async executeUserAgent(uid: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.executeAgentForUser(uid);
      return { success: true, message: 'Crowd Consensus agent executed successfully' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ uid, error: message }, 'Failed to execute Crowd Consensus agent manually');
      return { success: false, message };
    }
  }
}