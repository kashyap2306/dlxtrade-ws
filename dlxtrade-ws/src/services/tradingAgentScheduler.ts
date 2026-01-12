import { logger } from '../utils/logger';
import { AgentExecutionService } from './agentExecutionService';
import { TradingAgentMarketProvider } from './tradingAgentMarketProvider';
import { ExchangeCredentials } from './exchangeConnector';

export class TradingAgentScheduler {
  private executionService: AgentExecutionService;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor() {
    // Create a basic market provider - this will be replaced with agent-specific providers
    const defaultCredentials: ExchangeCredentials = {
      apiKey: '',
      secret: '',
      testnet: true
    };
    const marketProvider = new TradingAgentMarketProvider(defaultCredentials);

    this.executionService = new AgentExecutionService(marketProvider);
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
          await this.executeAllAgents();
        } catch (error) {
          logger.error({
            error: error instanceof Error ? error.message : 'Unknown error'
          }, 'Error in scheduled agent execution');
        }
      }, 5 * 60 * 1000); // 5 minutes

      this.isRunning = true;
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
      nextExecution: this.isRunning ? new Date(Date.now() + 5 * 60 * 1000) : null
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