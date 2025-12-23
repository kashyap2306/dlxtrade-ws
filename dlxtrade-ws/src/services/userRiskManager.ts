import { query } from '../db';
import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { userEngineManager } from './userEngineManager';

interface UserRiskState {
  dailyLoss: number;
  dailyStartBalance: number;
  peakBalance: number;
  consecutiveFailures: number;
  lastFailureTime: number;
  paused: boolean;
  pausedReason?: string;
}

export class UserRiskManager {
  private userStates: Map<string, UserRiskState> = new Map();
  private readonly MAX_CONSECUTIVE_FAILURES = parseInt(process.env.MAX_CONSECUTIVE_FAILURES || '5', 10);
  private readonly RISK_PAUSE_MINUTES = parseInt(process.env.RISK_PAUSE_MINUTES || '30', 10);

  async canTrade(uid: string, symbol: string, tradeSize: number, midPrice?: number, assumedAdverseMove?: number): Promise<{ allowed: boolean; reason?: string }> {
    const state = this.getOrCreateState(uid);
    const settings = await firestoreAdapter.getSettings(uid);

    if (!settings) {
      return { allowed: false, reason: 'Settings not found' };
    }

    // Check if manually paused
    if (settings.status === 'paused_manual' || settings.status === 'paused_by_risk') {
      return { allowed: false, reason: `Engine paused: ${settings.status}` };
    }

    // Check if risk manager paused
    if (state.paused) {
      const pauseTime = Date.now() - state.lastFailureTime;
      const pauseMs = this.RISK_PAUSE_MINUTES * 60 * 1000;
      if (pauseTime < pauseMs) {
        return { allowed: false, reason: state.pausedReason || 'Paused due to risk limits' };
      } else {
        // Auto-resume after pause period
        state.paused = false;
        state.pausedReason = undefined;
      }
    }

    // Check consecutive failures
    if (state.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
      const timeSinceLastFailure = Date.now() - state.lastFailureTime;
      const pauseMs = this.RISK_PAUSE_MINUTES * 60 * 1000;
      if (timeSinceLastFailure < pauseMs) {
        state.paused = true;
        state.pausedReason = `Too many consecutive failures: ${state.consecutiveFailures}`;
        await this.pauseEngine(uid, 'paused_by_risk');
        return { allowed: false, reason: state.pausedReason };
      } else {
        // Reset after pause period
        state.consecutiveFailures = 0;
      }
    }

    // Check max position
    const currentPosition = await this.getPosition(uid, symbol);
    if (settings.maxPos && Math.abs(currentPosition + tradeSize) > settings.maxPos) {
      return { allowed: false, reason: `Max position exceeded: ${currentPosition + tradeSize} > ${settings.maxPos}` };
    }

    // Check per-trade risk
    if (settings.per_trade_risk_pct) {
      const balance = await this.getBalance(uid);
      const maxTradeRisk = balance * (settings.per_trade_risk_pct / 100);
      const price = midPrice && midPrice > 0 ? midPrice : 0;
      const adverseMove = typeof assumedAdverseMove === 'number' && assumedAdverseMove > 0 ? assumedAdverseMove : 0.01; // default 1%
      const estimatedRisk = price > 0 ? tradeSize * price * adverseMove : tradeSize * 1000;
      if (estimatedRisk > maxTradeRisk) {
        return { allowed: false, reason: `Per-trade risk exceeded` };
      }
    }

    // Check daily loss limit
    if (settings.max_loss_pct) {
      const balance = await this.getBalance(uid);
      const maxDailyLoss = balance * (settings.max_loss_pct / 100);
      if (state.dailyLoss < -maxDailyLoss) {
        state.paused = true;
        state.pausedReason = `Daily loss limit exceeded: ${state.dailyLoss} < -${maxDailyLoss}`;
        await this.pauseEngine(uid, 'paused_by_risk');
        return { allowed: false, reason: state.pausedReason };
      }
    }

    // Check drawdown
    if (settings.max_drawdown_pct) {
      const balance = await this.getBalance(uid);
      const drawdown = state.peakBalance - balance;
      const maxDrawdown = state.peakBalance * (settings.max_drawdown_pct / 100);
      if (drawdown > maxDrawdown) {
        state.paused = true;
        state.pausedReason = `Max drawdown exceeded: ${drawdown} > ${maxDrawdown}`;
        await this.pauseEngine(uid, 'paused_by_risk');
        return { allowed: false, reason: state.pausedReason };
      }
    }

    return { allowed: true };
  }

  async recordTradeResult(uid: string, pnl: number, success: boolean): Promise<void> {
    const state = this.getOrCreateState(uid);
    
    // Update daily loss
    state.dailyLoss += pnl;

    // Update peak balance
    const balance = await this.getBalance(uid);
    if (balance > state.peakBalance) {
      state.peakBalance = balance;
    }

    // Track consecutive failures
    if (success) {
      state.consecutiveFailures = 0;
    } else {
      state.consecutiveFailures++;
      state.lastFailureTime = Date.now();
    }

    // Reset daily loss at start of new day
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const stateDate = new Date(state.dailyStartBalance > 0 ? state.dailyStartBalance : Date.now());
    const stateDay = new Date(stateDate.getFullYear(), stateDate.getMonth(), stateDate.getDate());
    
    if (today.getTime() !== stateDay.getTime()) {
      state.dailyLoss = 0;
      state.dailyStartBalance = balance;
    }

    logger.info({ uid, pnl, success, consecutiveFailures: state.consecutiveFailures }, 'Trade result recorded');
  }

  async pauseEngine(uid: string, reason: 'paused_by_risk' | 'paused_manual'): Promise<void> {
    await firestoreAdapter.saveSettings(uid, { status: reason });
    
    // Stop the engine
    await userEngineManager.stopUserEngineRunning(uid);
    
    logger.warn({ uid, reason }, 'Engine paused due to risk');
  }

  async resumeEngine(uid: string): Promise<void> {
    const state = this.getOrCreateState(uid);
    state.paused = false;
    state.pausedReason = undefined;
    state.consecutiveFailures = 0;
    
    await firestoreAdapter.saveSettings(uid, { status: 'active' });
    
    logger.info({ uid }, 'Engine resumed');
  }

  private getOrCreateState(uid: string): UserRiskState {
    if (!this.userStates.has(uid)) {
      this.userStates.set(uid, {
        dailyLoss: 0,
        dailyStartBalance: 0,
        peakBalance: 0,
        consecutiveFailures: 0,
        lastFailureTime: 0,
        paused: false,
      });
    }
    return this.userStates.get(uid)!;
  }

  private async getPosition(uid: string, symbol: string): Promise<number> {
    const rows = await query<any>(
      `SELECT 
        SUM(CASE WHEN o.side = 'BUY' THEN f.quantity ELSE -f.quantity END) as position
       FROM fills f
       INNER JOIN orders o ON f.order_id = o.id
       WHERE o.user_id = $1 AND o.symbol = $2`,
      [uid, symbol]
    );

    return parseFloat(rows[0]?.position || '0');
  }

  private async getBalance(uid: string): Promise<number> {
    // For testnet, use a simulated balance
    // For live, would query exchange balance
    // For now, return a default value
    return 10000; // $10k default for simulation
  }

  getState(uid: string): UserRiskState | null {
    return this.userStates.get(uid) || null;
  }
}

export const userRiskManager = new UserRiskManager();

