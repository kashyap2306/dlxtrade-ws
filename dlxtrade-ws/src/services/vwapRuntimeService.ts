import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';

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
 * Runtime state management for VWAP Strategy agents with Firestore persistence
 * State is persisted to Firestore and restored on server restart
 */
export class VWAPRuntimeService {
  private static instance: VWAPRuntimeService;
  private runtimeStates: Map<string, VWAPRuntimeState> = new Map();
  private persistenceInitialized: boolean = false;

  private constructor() {}

  static getInstance(): VWAPRuntimeService {
    if (!VWAPRuntimeService.instance) {
      VWAPRuntimeService.instance = new VWAPRuntimeService();
    }
    return VWAPRuntimeService.instance;
  }

  /**
   * Private method to save state to Firestore
   * Handles errors gracefully - logs and continues with in-memory state
   */
  private async saveState(state: VWAPRuntimeState): Promise<void> {
    try {
      await firestoreAdapter.saveVWAPAgentState(state.userId, {
        agentId: state.agentId,
        userId: state.userId,
        status: state.status,
        strategyType: state.strategyType,
        exchange: state.exchange,
        startedAt: state.startedAt,
        lastHeartbeat: state.lastHeartbeat,
        stoppedAt: state.stoppedAt,
        stoppedReason: state.stoppedReason,
        stoppedForDayKey: state.stoppedForDayKey,
        dayKey: state.dayKey,
        dayStartEquity: state.dayStartEquity,
      });
    } catch (error: any) {
      logger.error({ error: error.message, userId: state.userId }, 'Failed to persist VWAP state to Firestore');
      // Don't throw - allow in-memory state to continue working
    }
  }

  /**
   * Load persisted states from Firestore on server startup
   * Restores running agents and respects stoppedForDayKey
   */
  async loadPersistedStates(): Promise<void> {
    if (this.persistenceInitialized) {
      logger.debug({}, 'VWAP persistence already initialized, skipping');
      return;
    }

    try {
      logger.info({}, 'Loading persisted VWAP agent states from Firestore...');
      const runningAgents = await firestoreAdapter.getAllRunningVWAPAgents();
      const todayKey = new Date().toISOString().slice(0, 10);
      let restoredCount = 0;
      let skippedCount = 0;

      for (const agent of runningAgents) {
        // Respect stoppedForDayKey - skip if matches today
        if (agent.stoppedForDayKey === todayKey) {
          logger.info({ userId: agent.userId, stoppedForDayKey: agent.stoppedForDayKey }, 
            'Skipping VWAP agent restoration - stopped for today');
          skippedCount++;
          continue;
        }

        // Restore to in-memory state
        const state: VWAPRuntimeState = {
          agentId: agent.agentId,
          userId: agent.userId,
          status: agent.status,
          strategyType: agent.strategyType,
          exchange: agent.exchange,
          startedAt: agent.startedAt,
          lastHeartbeat: agent.lastHeartbeat,
          stoppedAt: agent.stoppedAt,
          stoppedReason: agent.stoppedReason,
          stoppedForDayKey: agent.stoppedForDayKey,
          dayKey: agent.dayKey,
          dayStartEquity: agent.dayStartEquity,
        };

        this.runtimeStates.set(agent.agentId, state);
        restoredCount++;

        logger.info({ userId: agent.userId, agentId: agent.agentId, status: agent.status }, 
          'Restored VWAP agent state from Firestore');
      }

      this.persistenceInitialized = true;
      logger.info({ restoredCount, skippedCount }, 'VWAP agent state restoration complete');
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to load persisted VWAP states - starting with empty state');
      this.persistenceInitialized = true; // Mark as initialized to prevent retry loops
    }
  }

  /**
   * Start a VWAP strategy agent
   * Persists state to Firestore before returning
   * CRITICAL: Clears any previous stop reasons to allow fresh start
   */
  async startAgent(userId: string, wipeStopForDayFields: boolean = false): Promise<VWAPRuntimeState> {
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
    
    // CRITICAL: Clear stop reason when starting (manual start overrides manual stop)
    delete state.stoppedAt;
    delete state.stoppedReason;

    if (wipeStopForDayFields) {
      delete state.stoppedForDayKey;
    }

    this.runtimeStates.set(agentId, state);

    // Persist to Firestore before returning
    await this.saveState(state);

    logger.info({
      agentId,
      userId,
      strategyType: 'VWAP_MEAN_REVERSION'
    }, 'VWAP Strategy runtime started and persisted (stop reason cleared)');

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
   * Persists state to Firestore
   * CRITICAL: This is for MANUAL user stops - must override all skip conditions
   */
  async stopAgent(userId: string): Promise<VWAPRuntimeState | null> {
    const agentId = `vwap_${userId}`;
    const state = this.runtimeStates.get(agentId);

    if (state) {
      state.status = 'STOPPED';
      state.stoppedAt = new Date();
      state.stoppedReason = 'USER_REQUEST'; // CRITICAL: Mark as manual user stop
      state.lastHeartbeat = new Date();

      // Persist to Firestore
      await this.saveState(state);

      logger.info({
        agentId,
        userId,
        strategyType: 'VWAP_MEAN_REVERSION',
        stopReason: 'USER_REQUEST'
      }, 'VWAP Strategy manually stopped by user and persisted');
    }

    return state || null;
  }

  /**
   * Stop agent for the day with reason
   * Persists state to Firestore
   */
  async stopAgentForDay(userId: string, reason: string, dayKey: string): Promise<VWAPRuntimeState> {
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

    // Persist to Firestore
    await this.saveState(state);

    logger.info({ agentId, userId, reason, dayKey }, 'VWAP Strategy stopped for day and persisted');

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
   * Also persists to Firestore
   * CRITICAL: Only updates if agent status is RUNNING
   */
  async updateHeartbeat(userId: string): Promise<void> {
    const agentId = `vwap_${userId}`;
    const state = this.runtimeStates.get(agentId);

    // CRITICAL: Do NOT update heartbeat if agent is STOPPED
    // Manual STOP must be respected - no heartbeat means agent is truly stopped
    if (state && state.status === 'RUNNING') {
      state.lastHeartbeat = new Date();
      
      // Persist heartbeat update to Firestore
      await this.saveState(state);
    } else if (state && state.status === 'STOPPED') {
      logger.debug({ agentId, userId }, 'Heartbeat update skipped - agent is STOPPED');
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
