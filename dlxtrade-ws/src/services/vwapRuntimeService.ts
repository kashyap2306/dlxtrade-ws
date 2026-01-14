import { logger } from '../utils/logger';

interface VWAPRuntimeState {
  agentId: string;
  userId: string;
  status: 'STOPPED' | 'RUNNING';
  strategyType: 'VWAP_MEAN_REVERSION';
  startedAt?: Date;
  lastHeartbeat?: Date;
}

/**
 * Simple runtime state management for VWAP Strategy agents
 * In production, this would use Redis or a database for persistence
 */
export class VWAPRuntimeService {
  private static instance: VWAPRuntimeService;
  private runtimeStates: Map<string, VWAPRuntimeState> = new Map();

  private constructor() {}

  static getInstance(): VWAPRuntimeService {
    if (!VWAPRuntimeService.instance) {
      VWAPRuntimeService.instance = new VWAPRuntimeService();
    }
    return VWAPRuntimeService.instance;
  }

  /**
   * Start a VWAP strategy agent
   */
  startAgent(userId: string): VWAPRuntimeState {
    const agentId = `vwap_${userId}`;

    const state: VWAPRuntimeState = {
      agentId,
      userId,
      status: 'RUNNING',
      strategyType: 'VWAP_MEAN_REVERSION',
      startedAt: new Date(),
      lastHeartbeat: new Date()
    };

    this.runtimeStates.set(agentId, state);

    logger.info({
      agentId,
      userId,
      strategyType: 'VWAP_MEAN_REVERSION'
    }, 'VWAP Strategy runtime started');

    return state;
  }

  /**
   * Stop a VWAP strategy agent
   */
  stopAgent(userId: string): VWAPRuntimeState | null {
    const agentId = `vwap_${userId}`;
    const state = this.runtimeStates.get(agentId);

    if (state) {
      state.status = 'STOPPED';
      state.lastHeartbeat = new Date();

      logger.info({
        agentId,
        userId,
        strategyType: 'VWAP_MEAN_REVERSION'
      }, 'VWAP Strategy runtime stopped');
    }

    return state || null;
  }

  /**
   * Get runtime state for a VWAP strategy agent
   */
  getAgentState(userId: string): VWAPRuntimeState | null {
    const agentId = `vwap_${userId}`;
    return this.runtimeStates.get(agentId) || null;
  }

  /**
   * Check if a VWAP strategy agent is running
   */
  isAgentRunning(userId: string): boolean {
    const state = this.getAgentState(userId);
    return state?.status === 'RUNNING' || false;
  }

  /**
   * Get all running VWAP strategy agents
   */
  getRunningAgents(): VWAPRuntimeState[] {
    return Array.from(this.runtimeStates.values()).filter(state => state.status === 'RUNNING');
  }

  /**
   * Update heartbeat for a running agent
   */
  updateHeartbeat(userId: string): void {
    const agentId = `vwap_${userId}`;
    const state = this.runtimeStates.get(agentId);

    if (state && state.status === 'RUNNING') {
      state.lastHeartbeat = new Date();
    }
  }

  /**
   * Clean up old stopped agents (optional maintenance)
   */
  cleanupOldAgents(maxAgeHours: number = 24): void {
    const cutoffTime = new Date(Date.now() - (maxAgeHours * 60 * 60 * 1000));

    for (const [agentId, state] of this.runtimeStates.entries()) {
      if (state.status === 'STOPPED' && state.lastHeartbeat && state.lastHeartbeat < cutoffTime) {
        this.runtimeStates.delete(agentId);
        logger.info({ agentId }, 'Cleaned up old VWAP Strategy runtime state');
      }
    }
  }
}

// Export singleton instance
export const vwapRuntimeService = VWAPRuntimeService.getInstance();