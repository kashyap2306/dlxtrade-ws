import { logger } from '../utils/logger';
import { CrowdConsensusService } from './crowdConsensusService';
import { runBackgroundTask } from '../utils/safeBackgroundRunner';

export class CrowdConsensusAnalyzer {
  private static isRunning = false;
  private static lastRunAt: Date | null = null;

  /**
   * Start the background consensus analysis
   */
  static async startBackgroundAnalysis(): Promise<void> {
    if (this.isRunning) {
      logger.info('Crowd consensus analysis already running');
      return;
    }

    try {
      this.isRunning = true;

      // Mark as running in global state
      // await CrowdConsensusService.saveGlobalConsensus([], 'RUNNING'); // TODO: Implement if needed

      // Run the heavy analysis in background
      await runBackgroundTask(
        async () => {
          logger.info('Starting background crowd consensus analysis');
          const signals = await CrowdConsensusService.analyzeConsensus();
          // await CrowdConsensusService.saveGlobalConsensus(signals, 'COMPLETED'); // TODO: Implement if needed
          this.lastRunAt = new Date();
          logger.info({ signalCount: signals.length }, 'Completed background crowd consensus analysis');
        },
        'crowd-consensus-analysis',
        120000 // 2 minute timeout for the heavy analysis
      );

    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to start background consensus analysis');
      // await CrowdConsensusService.saveGlobalConsensus([], 'ERROR'); // TODO: Implement if needed
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Check if analysis is currently running
   */
  static isAnalysisRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get last run time
   */
  static getLastRunAt(): Date | null {
    return this.lastRunAt;
  }

  /**
   * Force trigger analysis (for admin use)
   */
  static async forceAnalysis(): Promise<void> {
    logger.info('Force triggering crowd consensus analysis');
    await this.startBackgroundAnalysis();
  }
}

export default CrowdConsensusAnalyzer;