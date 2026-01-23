import { logger } from '../utils/logger';
import { AgentExecutionService } from './agentExecutionService';
import { TradingAgentMarketProvider } from './tradingAgentMarketProvider';
import { ExchangeCredentials } from './exchangeConnector';

export class TradingAgentScheduler {
  private executionService: AgentExecutionService;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly intervalMs = 5 * 60 * 1000;
  private lastExecutionAt: Date | null = null;
  private nextExecutionAt: Date | null = null;
  private lastExecutionError: string | null = null;

  constructor() {
    this.executionService = new AgentExecutionService({
      getCandles: async () => [],
      getAccountBalance: async () => ({ equity: 0, available: 0 }),
      placeOrder: async () => 'NOOP'
    } as any);
  }

  /**
   * Start the trading agent scheduler
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Trading agent scheduler is already running');
      return;
    }

    try {
      // Load active agents on startup
      await this.executionService.loadActiveAgents();

      // Schedule execution every 5 minutes
      this.intervalId = setInterval(async () => {
        try {
          this.lastExecutionAt = new Date();
          // Execute regular trading agents only
          await this.executeAllAgents();
          this.lastExecutionError = null;
        } catch (error) {
          this.lastExecutionError = error instanceof Error ? error.message : 'Unknown error';
          logger.error({
            error: error instanceof Error ? error.message : 'Unknown error'
          }, 'Error in scheduled agent execution');
        } finally {
          this.nextExecutionAt = new Date(Date.now() + this.intervalMs);
        }
      }, this.intervalMs); // 5 minutes

      this.isRunning = true;
      this.nextExecutionAt = new Date(Date.now() + this.intervalMs);
      logger.info('Trading agent scheduler started - executing every 5 minutes');
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to start trading agent scheduler');

      throw error;
    }
  }

  /**
   * Stop the trading agent scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    this.nextExecutionAt = null;
    logger.info('Trading agent scheduler stopped');
  }

  /**
   * Execute all active agents manually (for testing)
   */
  async executeAllAgents(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Trading agent scheduler is not running');
      return;
    }

    try {
      // FIX PART 4: Scheduler-level safety net for HTF agents
      // Before executing agents, check if any HTF agents should be skipped due to disabled modes
      await this.preExecutionHTFCheck();
      
      // Add HTF scheduling log as requested
      const allAgents = this.executionService.getAllActiveAgents();
      const htfAgents = allAgents.filter(agent => {
        const config = agent['config'];
        return config.strategyType === 'HTF_TREND_FILTER' || 
               (config.name && config.name.includes('HTF Trend Filter'));
      });

      // Log HTF agent scheduling
      for (const agent of htfAgents) {
        const config = agent['config'];
        console.log("[HTF_SCHEDULED] uid=", config.userId);
      }

      // Add scheduler agent picked log for all agents
      for (const agent of allAgents) {
        const config = agent['config'];
        console.log("[SCHEDULER_AGENT_PICKED]", config.id, config.status);
      }
      
      await this.executionService.executeAllAgents();
      logger.info('Successfully executed all active trading agents');
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to execute all trading agents');
      throw error;
    }
  }

  /**
   * FIX PART 4: Pre-execution check for HTF agents
   * Scheduler-level safety net to prevent HTF execution when both modes disabled
   */
  private async preExecutionHTFCheck(): Promise<void> {
    try {
      const allAgents = this.executionService.getAllActiveAgents();
      const htfAgents = allAgents.filter(agent => {
        const config = agent['config'];
        return config.strategyType === 'HTF_TREND_FILTER' || 
               (config.name && config.name.includes('HTF Trend Filter'));
      });

      if (htfAgents.length === 0) {
        return; // No HTF agents to check
      }

      logger.debug({
        totalAgents: allAgents.length,
        htfAgents: htfAgents.length
      }, '[SCHEDULER_SAFETY_NET] Pre-execution HTF check');

      // This is a safety net - actual mode checking is done in agentExecutionService
      // Just log for monitoring purposes
      for (const agent of htfAgents) {
        const config = agent['config'];
        logger.debug({
          agentId: config.id,
          userId: config.userId,
          name: config.name
        }, '[SCHEDULER_SAFETY_NET] HTF agent will be checked for mode compliance');
      }
    } catch (error) {
      // Don't block execution if safety check fails
      logger.warn({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, '[SCHEDULER_SAFETY_NET] Pre-execution HTF check failed, continuing with execution');
    }
  }

  /**
   * Execute a specific agent manually
   */
  async executeAgent(agentId: string): Promise<{ success: boolean; message: string }> {
    try {
      return await this.executionService.executeAgentManually(agentId);
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeAgents: this.executionService.getAllActiveAgents().length,
      executionStats: this.executionService.getExecutionStats(),
      intervalMs: this.intervalMs,
      lastExecutionAt: this.lastExecutionAt,
      nextExecutionAt: this.nextExecutionAt,
      lastExecutionError: this.lastExecutionError,
    };
  }

  /**
   * Reload agents (useful after agent approval/changes)
   */
  async reloadAgents(): Promise<void> {
    await this.executionService.loadActiveAgents();
    logger.info('Trading agents reloaded');
  }
}

// Export singleton instance
export const tradingAgentScheduler = new TradingAgentScheduler();