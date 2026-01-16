import { logger } from '../utils/logger';

interface VWAPRuntimeState {
  agentId: string;
  userId: string;
  status: 'STOPPED' | 'RUNNING';
  strategyType: 'VWAP_MEAN_REVERSION';
  exchange?: string;
  credentials?: {
    apiKey: string;
    secret: string;
    passphrase?: string;
    testnet?: boolean;
  };
  startedAt?: Date;
  lastHeartbeat?: Date;
  stoppedAt?: Date;
  stoppedReason?: string;
  stoppedForDayKey?: string;
  dayKey?: string;
  dayStartEquity?: number;
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
  startAgent(userId: string, wipeStopForDayFields: boolean = false): VWAPRuntimeState {
    const agentId = `vwap_${userId}`;

    const existing = this.runtimeStates.get(agentId);
    const state: VWAPRuntimeState = existing || {
      agentId,
      userId,
      status: 'STOPPED',
      strategyType: 'VWAP_MEAN_REVERSION',
    };

    state.status = 'RUNNING';
    state.startedAt = new Date();
    state.lastHeartbeat = new Date();

    if (wipeStopForDayFields) {
      delete state.stoppedForDayKey;
      delete state.stoppedReason;
      delete state.stoppedAt;
    }

    this.runtimeStates.set(agentId, state);

    logger.info({
      agentId,
      userId,
      strategyType: 'VWAP_MEAN_REVERSION'
    }, 'VWAP Strategy runtime started');

    return state;
  }

  setAgentCredentials(userId: string, exchange: string, credentials: { apiKey: string; secret: string; passphrase?: string; testnet?: boolean }): VWAPRuntimeState {
    const agentId = `vwap_${userId}`;
    const existing = this.runtimeStates.get(agentId);
    const state: VWAPRuntimeState = existing || {
      agentId,
      userId,
      status: 'STOPPED',
      strategyType: 'VWAP_MEAN_REVERSION'
    };

    state.exchange = exchange;
    state.credentials = credentials;
    this.runtimeStates.set(agentId, state);
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

  stopAgentForDay(userId: string, reason: string, dayKey: string): VWAPRuntimeState {
    const agentId = `vwap_${userId}`;
    const existing = this.runtimeStates.get(agentId);
    const state: VWAPRuntimeState = existing || {
      agentId,
      userId,
      status: 'STOPPED',
      strategyType: 'VWAP_MEAN_REVERSION'
    };

    state.status = 'STOPPED';
    state.stoppedAt = new Date();
    state.stoppedReason = reason;
    state.stoppedForDayKey = dayKey;
    state.lastHeartbeat = new Date();
    this.runtimeStates.set(agentId, state);
    return state;
  }

  /**
   * Get runtime state for a VWAP strategy agent
   */
  getAgentState(userId: string): VWAPRuntimeState | null {
    const agentId = `vwap_${userId}`;
    const state = this.runtimeStates.get(agentId) || null;
    if (state?.stoppedForDayKey) {
      const todayKey = new Date().toISOString().slice(0, 10);
      if (state.stoppedForDayKey !== todayKey) {
        delete state.stoppedForDayKey;
        delete state.stoppedReason;
        delete state.stoppedAt;
      }
    }
    if (state?.dayKey) {
      const todayKey = new Date().toISOString().slice(0, 10);
      if (state.dayKey !== todayKey) {
        delete state.dayKey;
        delete state.dayStartEquity;
      }
    }
    return state;
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