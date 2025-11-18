import { query } from '../db';
import { userEngineManager } from './userEngineManager';
import { firestoreAdapter } from './firestoreAdapter';
import { metricsService } from './metricsService';
import { logger } from '../utils/logger';

export interface GlobalStats {
  activeUsers: number;
  activeEngines: number;
  activeHFTBots: number;
  totalVolumeToday: number;
  totalPnLToday: number;
  totalErrors: number;
  totalCancels: number;
  globalSuccessRate: number;
  totalTradesToday: number;
}

export class AdminStatsService {
  async getGlobalStats(): Promise<GlobalStats> {
    // Always be resilient - default to zeros if any dependency fails
    let activeUsers = 0;
    let activeEngines = 0;
    let activeHFTBots = 0;
    let totalTradesToday = 0;
    let totalVolumeToday = 0;
    let totalPnLToday = 0;
    let totalErrors = 0;
    let totalCancels = 0;
    let totalExecuted = 0;

    try {
      const allUsers = await firestoreAdapter.getAllUsers();
      for (const user of allUsers) {
        const engineStatus = userEngineManager.getUserEngineStatus(user.uid);
        const hftStatus = userEngineManager.getHFTStatus(user.uid);
        if (engineStatus.running) {
          activeEngines++;
          activeUsers++;
        }
        if (hftStatus.running) {
          activeHFTBots++;
          if (!engineStatus.running) activeUsers++;
        }
      }
    } catch (error) {
      logger.warn({ error }, 'Global stats: failed to compute engine counts, defaulting');
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const todayOrders = await query<any>(
        `SELECT 
          COUNT(*) as trade_count,
          COALESCE(SUM(quantity * price), 0) as volume,
          COALESCE(SUM(pnl), 0) as total_pnl
        FROM orders 
        WHERE DATE(created_at) = $1 AND status = 'FILLED'`,
        [today]
      );
      totalTradesToday = parseInt(todayOrders[0]?.trade_count || '0', 10);
      totalVolumeToday = parseFloat(todayOrders[0]?.volume || '0');
      totalPnLToday = parseFloat(todayOrders[0]?.total_pnl || '0');
    } catch (error) {
      logger.warn({ error }, 'Global stats: DB unavailable, defaulting trade metrics');
    }

    try {
      const allMetrics = metricsService.getMetrics();
      for (const [, strategyMetrics] of allMetrics.values()) {
        for (const metrics of strategyMetrics.values()) {
          if (typeof metrics === 'string') continue;
          totalErrors += metrics.failedOrders;
          totalCancels += metrics.cancels;
          totalExecuted += metrics.tradesExecuted;
        }
      }
    } catch (error) {
      logger.warn({ error }, 'Global stats: metrics unavailable, defaulting error metrics');
    }

    const totalAttempts = totalExecuted + totalErrors;
    const globalSuccessRate = totalAttempts > 0 ? (totalExecuted / totalAttempts) * 100 : 0;

    return {
      activeUsers,
      activeEngines,
      activeHFTBots,
      totalVolumeToday,
      totalPnLToday,
      totalErrors,
      totalCancels,
      globalSuccessRate: Math.round(globalSuccessRate * 100) / 100,
      totalTradesToday,
    };
  }

  async getUserStats(uid: string): Promise<{
    engineRunning: boolean;
    hftRunning: boolean;
    currentPnL: number;
    openOrders: number;
    apiStatus: Record<string, { connected: boolean; hasKey: boolean }>;
    autoTradeEnabled: boolean;
    hftEnabled: boolean;
    unlockedAgents: string[];
  }> {
    const engineStatus = userEngineManager.getUserEngineStatus(uid);
    const hftStatus = userEngineManager.getHFTStatus(uid);

    let currentPnL = 0;
    let openOrders = 0;
    try {
      const today = new Date().toISOString().split('T')[0];
      const pnlRows = await query<any>('SELECT total FROM pnl WHERE user_id = $1 AND date = $2', [uid, today]);
      currentPnL = pnlRows.length > 0 ? parseFloat(pnlRows[0].total || '0') : 0;
      const openOrdersRows = await query<any>(
        `SELECT COUNT(*) as count FROM orders WHERE user_id = $1 AND status IN ('NEW', 'PARTIALLY_FILLED')`,
        [uid]
      );
      openOrders = parseInt(openOrdersRows[0]?.count || '0', 10);
    } catch (error) {
      logger.warn({ error, uid }, 'User stats: DB unavailable, defaulting PnL/open orders');
    }

    const apiStatus: Record<string, { connected: boolean; hasKey: boolean }> = {};
    try {
      const integrations = await firestoreAdapter.getAllIntegrations(uid);
      const apiNames = ['binance', 'cryptoquant', 'lunarcrush', 'coinapi'];
      for (const apiName of apiNames) {
        const integration = integrations[apiName];
        apiStatus[apiName] = {
          connected: integration?.enabled || false,
          hasKey: !!integration?.apiKey,
        };
      }
    } catch (error) {
      logger.warn({ error, uid }, 'User stats: integrations unavailable, defaulting api status');
    }

    let autoTradeEnabled = false;
    let hftEnabled = false;
    try {
      const settings = await firestoreAdapter.getSettings(uid);
      const hftSettings = await firestoreAdapter.getHFTSettings(uid);
      autoTradeEnabled = settings?.autoTradeEnabled || false;
      hftEnabled = hftSettings?.enabled || false;
    } catch (error) {
      logger.warn({ error, uid }, 'User stats: settings unavailable, defaulting feature flags');
    }

    let unlockedAgents: string[] = [];
    try {
      const agents = await firestoreAdapter.getAllUserAgents(uid);
      unlockedAgents = Object.entries(agents)
        .filter(([_, status]) => status.unlocked)
        .map(([name, _]) => name);
    } catch (error) {
      logger.warn({ error, uid }, 'User stats: agents unavailable, defaulting unlocked agents');
    }

    return {
      engineRunning: engineStatus.running,
      hftRunning: hftStatus.running,
      currentPnL,
      openOrders,
      apiStatus,
      autoTradeEnabled,
      hftEnabled,
      unlockedAgents,
    };
  }
}

export const adminStatsService = new AdminStatsService();

