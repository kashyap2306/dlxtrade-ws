import { researchEngine } from './researchEngine';
import { firestoreAdapter } from './firestoreAdapter';
import { resolveExchangeConnector } from './exchangeResolver';
import { logger } from '../utils/logger';
import type { LiveAnalysis } from './researchEngine';

/**
 * Service for managing live analysis updates
 * Updates live analysis every 5 minutes for active symbols
 */
export class LiveAnalysisService {
  private updateInterval: NodeJS.Timeout | null = null;
  private activeSymbols: Set<string> = new Set();
  private isRunning = false;

  /**
   * Start the live analysis scheduler
   * Updates every 5 minutes (300000 ms)
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Live analysis scheduler already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting live analysis scheduler (updates every 5 minutes)');

    // Run immediately on start
    this.updateAllActiveSymbols();

    // Then run every 5 minutes
    this.updateInterval = setInterval(() => {
      this.updateAllActiveSymbols();
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Stop the live analysis scheduler
   */
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.isRunning = false;
    logger.info('Live analysis scheduler stopped');
  }

  /**
   * Register a symbol for live analysis updates
   */
  registerSymbol(symbol: string): void {
    this.activeSymbols.add(symbol.toUpperCase());
    logger.debug({ symbol }, 'Symbol registered for live analysis');
  }

  /**
   * Unregister a symbol from live analysis updates
   */
  unregisterSymbol(symbol: string): void {
    this.activeSymbols.delete(symbol.toUpperCase());
    logger.debug({ symbol }, 'Symbol unregistered from live analysis');
  }

  /**
   * Get active symbols
   */
  getActiveSymbols(): string[] {
    return Array.from(this.activeSymbols);
  }

  /**
   * Update live analysis for a specific symbol and user
   */
  async updateLiveAnalysis(symbol: string, uid: string): Promise<LiveAnalysis | null> {
    try {
      logger.debug({ symbol, uid }, 'Updating live analysis');

      // Resolve exchange connector
      let exchangeAdapter = null;
      try {
        const resolved = await resolveExchangeConnector(uid);
        if (resolved && resolved.connector) {
          exchangeAdapter = resolved.connector;
        }
      } catch (err: any) {
        logger.debug({ err, uid }, 'No exchange connector available, using fallback');
      }

      // Run research to get latest analysis
      const result = await researchEngine.runResearch(symbol, uid, exchangeAdapter || undefined);

      // Extract liveAnalysis from result
      if (result.liveAnalysis) {
        // Store in Firestore for persistence
        try {
          const admin = await import('firebase-admin');
          const db = admin.firestore();
          await db.collection('liveAnalysis').doc(`${uid}_${symbol}`).set({
            symbol,
            uid,
            ...result.liveAnalysis,
            updatedAt: admin.firestore.Timestamp.now(),
          }, { merge: true });
        } catch (storeErr: any) {
          logger.warn({ err: storeErr, symbol, uid }, 'Failed to store liveAnalysis in Firestore');
        }

        console.log(`[DEEP-RESEARCH] LiveAnalysis updated for ${symbol} at ${result.liveAnalysis.lastUpdated}`);
        logger.info({ symbol, uid, lastUpdated: result.liveAnalysis.lastUpdated }, 'LiveAnalysis updated');

        return result.liveAnalysis;
      }

      return null;
    } catch (error: any) {
      logger.error({ error: error.message, symbol, uid }, 'Error updating live analysis');
      return null;
    }
  }

  /**
   * Update live analysis for all active symbols
   * This is called by the scheduler
   */
  private async updateAllActiveSymbols(): Promise<void> {
    if (this.activeSymbols.size === 0) {
      logger.debug('No active symbols to update');
      return;
    }

    logger.info({ count: this.activeSymbols.size }, 'Updating live analysis for all active symbols');

    // Get all users who have requested research for these symbols
    // For now, we'll update for a default user or get from Firestore
    // In production, you might want to track which users are watching which symbols
    const symbols = Array.from(this.activeSymbols);
    
    for (const symbol of symbols) {
      try {
        // For now, update without specific user (will use fallback mode)
        // In production, you'd want to get users watching this symbol from Firestore
        await this.updateLiveAnalysis(symbol, 'system');
      } catch (err: any) {
        logger.error({ err, symbol }, 'Error updating live analysis for symbol');
      }
    }
  }

  /**
   * Get latest live analysis for a symbol and user
   */
  async getLiveAnalysis(symbol: string, uid: string): Promise<LiveAnalysis | null> {
    try {
      // First try to get from Firestore
      const admin = await import('firebase-admin');
      const db = admin.firestore();
      const doc = await db.collection('liveAnalysis').doc(`${uid}_${symbol}`).get();

      if (doc.exists) {
        const data = doc.data()!;
        return {
          isLive: data.isLive || false,
          lastUpdated: data.lastUpdated || new Date().toISOString(),
          summary: data.summary || '',
          meta: data.meta || {},
        };
      }

      // If not in Firestore, generate fresh analysis
      return await this.updateLiveAnalysis(symbol, uid);
    } catch (error: any) {
      logger.error({ error: error.message, symbol, uid }, 'Error getting live analysis');
      return null;
    }
  }
}

export const liveAnalysisService = new LiveAnalysisService();

