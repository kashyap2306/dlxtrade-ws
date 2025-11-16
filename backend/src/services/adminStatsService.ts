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
    try {
      // Get all users
      const allUsers = await firestoreAdapter.getAllUsers();
      
      // Count active engines and HFT bots
      let activeEngines = 0;
      let activeHFTBots = 0;
      let activeUsers = 0;

      for (const user of allUsers) {
        const engineStatus = userEngineManager.getUserEngineStatus(user.uid);
        const hftStatus = userEngineManager.getHFTStatus(user.uid);
        
        if (engineStatus.running) {
          activeEngines++;
          activeUsers++;
        }
        if (hftStatus.running) {
          activeHFTBots++;
          if (!engineStatus.running) {
            activeUsers++;
          }
        }
      }

      // Get today's date
      const today = new Date().toISOString().split('T')[0];
      
      // Get today's trades and volume from orders table
      const todayOrders = await query<any>(
        `SELECT 
          COUNT(*) as trade_count,
          COALESCE(SUM(quantity * price), 0) as volume,
          COALESCE(SUM(pnl), 0) as total_pnl
        FROM orders 
        WHERE DATE(created_at) = $1 AND status = 'FILLED'`,
        [today]
      );

      const totalTradesToday = parseInt(todayOrders[0]?.trade_count || '0', 10);
      const totalVolumeToday = parseFloat(todayOrders[0]?.volume || '0');
      const totalPnLToday = parseFloat(todayOrders[0]?.total_pnl || '0');

      // Get errors and cancels from metrics
      const allMetrics = metricsService.getMetrics();
      let totalErrors = 0;
      let totalCancels = 0;
      let totalExecuted = 0;

      for (const [, strategyMetrics] of allMetrics.values()) {
        for (const metrics of strategyMetrics.values()) {
          totalErrors += metrics.failedOrders;
          totalCancels += metrics.cancels;
          totalExecuted += metrics.tradesExecuted;
        }
      }

      // Calculate success rate
      const totalAttempts = totalExecuted + totalErrors;
      const globalSuccessRate = totalAttempts > 0 
        ? (totalExecuted / totalAttempts) * 100 
        : 0;

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
    } catch (error) {
      logger.error({ error }, 'Error calculating global stats');
      throw error;
    }
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
    try {
      const engineStatus = userEngineManager.getUserEngineStatus(uid);
      const hftStatus = userEngineManager.getHFTStatus(uid);

      // Get current PnL (today's PnL)
      const today = new Date().toISOString().split('T')[0];
      const pnlRows = await query<any>(
        'SELECT total FROM pnl WHERE user_id = $1 AND date = $2',
        [uid, today]
      );
      const currentPnL = pnlRows.length > 0 ? parseFloat(pnlRows[0].total || '0') : 0;

      // Get open orders count
      const openOrdersRows = await query<any>(
        `SELECT COUNT(*) as count FROM orders WHERE user_id = $1 AND status IN ('NEW', 'PARTIALLY_FILLED')`,
        [uid]
      );
      const openOrders = parseInt(openOrdersRows[0]?.count || '0', 10);

      // Get API integrations status
      const integrations = await firestoreAdapter.getAllIntegrations(uid);
      const apiStatus: Record<string, { connected: boolean; hasKey: boolean }> = {};
      
      const apiNames = ['binance', 'cryptoquant', 'lunarcrush', 'coinapi'];
      for (const apiName of apiNames) {
        const integration = integrations[apiName];
        apiStatus[apiName] = {
          connected: integration?.enabled || false,
          hasKey: !!integration?.apiKey,
        };
      }

      // Get settings
      const settings = await firestoreAdapter.getSettings(uid);
      const hftSettings = await firestoreAdapter.getHFTSettings(uid);

      // Get unlocked agents
      const agents = await firestoreAdapter.getAllUserAgents(uid);
      const unlockedAgents = Object.entries(agents)
        .filter(([_, status]) => status.unlocked)
        .map(([name, _]) => name);

      return {
        engineRunning: engineStatus.running,
        hftRunning: hftStatus.running,
        currentPnL,
        openOrders,
        apiStatus,
        autoTradeEnabled: settings?.autoTradeEnabled || false,
        hftEnabled: hftSettings?.enabled || false,
        unlockedAgents,
      };
    } catch (error) {
      logger.error({ error, uid }, 'Error getting user stats');
      throw error;
    }
  }
}

export const adminStatsService = new AdminStatsService();

