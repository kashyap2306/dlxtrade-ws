import { query } from '../db';
import { logger } from '../utils/logger';
import type { RiskLimits } from '../types';

class RiskManager {
  private circuitBreaker: boolean = false;
  private paused: boolean = false;
  private riskLimits: RiskLimits = {
    maxDailyPnL: 1000, // $1000 max daily PnL
    maxDrawdown: 500, // $500 max drawdown
    maxPosition: 0.01, // 0.01 BTC max position
    circuitBreaker: false,
  };

  async canTrade(): Promise<boolean> {
    if (this.circuitBreaker || this.paused) {
      return false;
    }

    // Check daily PnL
    const dailyPnL = await this.getDailyPnL();
    if (Math.abs(dailyPnL) > this.riskLimits.maxDailyPnL) {
      logger.warn({ dailyPnL }, 'Daily PnL limit exceeded');
      this.circuitBreaker = true;
      return false;
    }

    // Check drawdown
    const drawdown = await this.getDrawdown();
    if (drawdown > this.riskLimits.maxDrawdown) {
      logger.warn({ drawdown }, 'Max drawdown exceeded');
      this.circuitBreaker = true;
      return false;
    }

    return true;
  }

  async getPosition(symbol: string): Promise<number> {
    // Calculate net position from fills
    const rows = await query<any>(
      `SELECT 
        SUM(CASE WHEN side = 'BUY' THEN quantity ELSE -quantity END) as position
       FROM fills
       WHERE symbol = $1`,
      [symbol]
    );

    return parseFloat(rows[0]?.position || '0');
  }

  async getDailyPnL(): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const rows = await query<any>(
      'SELECT total FROM pnl WHERE date = $1',
      [today]
    );

    return rows.length > 0 ? parseFloat(rows[0].total || '0') : 0;
  }

  async getDrawdown(): Promise<number> {
    // Calculate max drawdown from PnL history
    const rows = await query<any>(
      `SELECT total FROM pnl 
       ORDER BY date DESC 
       LIMIT 30`
    );

    if (rows.length === 0) return 0;

    let peak = 0;
    let maxDrawdown = 0;

    for (const row of rows) {
      const pnl = parseFloat(row.total || '0');
      if (pnl > peak) {
        peak = pnl;
      }
      const drawdown = peak - pnl;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown;
  }

  setCircuitBreaker(enabled: boolean): void {
    this.circuitBreaker = enabled;
    logger.info({ enabled }, 'Circuit breaker toggled');
  }

  pause(): void {
    this.paused = true;
    logger.info('Risk manager paused');
  }

  resume(): void {
    this.paused = false;
    logger.info('Risk manager resumed');
  }

  updateLimits(limits: Partial<RiskLimits>): void {
    this.riskLimits = { ...this.riskLimits, ...limits };
    logger.info({ limits: this.riskLimits }, 'Risk limits updated');
  }

  getLimits(): RiskLimits {
    return { ...this.riskLimits };
  }

  getStatus(): {
    circuitBreaker: boolean;
    paused: boolean;
    limits: RiskLimits;
  } {
    return {
      circuitBreaker: this.circuitBreaker,
      paused: this.paused,
      limits: this.riskLimits,
    };
  }
}

export const riskManager = new RiskManager();

