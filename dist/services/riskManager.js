"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.riskManager = void 0;
const db_1 = require("../db");
const logger_1 = require("../utils/logger");
class RiskManager {
    constructor() {
        this.circuitBreaker = false;
        this.paused = false;
        this.riskLimits = {
            maxDailyPnL: 1000, // $1000 max daily PnL
            maxDrawdown: 500, // $500 max drawdown
            maxPosition: 0.01, // 0.01 BTC max position
            circuitBreaker: false,
        };
    }
    async canTrade() {
        if (this.circuitBreaker || this.paused) {
            return false;
        }
        // Check daily PnL
        const dailyPnL = await this.getDailyPnL();
        if (Math.abs(dailyPnL) > this.riskLimits.maxDailyPnL) {
            logger_1.logger.warn({ dailyPnL }, 'Daily PnL limit exceeded');
            this.circuitBreaker = true;
            return false;
        }
        // Check drawdown
        const drawdown = await this.getDrawdown();
        if (drawdown > this.riskLimits.maxDrawdown) {
            logger_1.logger.warn({ drawdown }, 'Max drawdown exceeded');
            this.circuitBreaker = true;
            return false;
        }
        return true;
    }
    async getPosition(symbol) {
        // Calculate net position from fills
        const rows = await (0, db_1.query)(`SELECT 
        SUM(CASE WHEN side = 'BUY' THEN quantity ELSE -quantity END) as position
       FROM fills
       WHERE symbol = $1`, [symbol]);
        return parseFloat(rows[0]?.position || '0');
    }
    async getDailyPnL() {
        const today = new Date().toISOString().split('T')[0];
        const rows = await (0, db_1.query)('SELECT total FROM pnl WHERE date = $1', [today]);
        return rows.length > 0 ? parseFloat(rows[0].total || '0') : 0;
    }
    async getDrawdown() {
        // Calculate max drawdown from PnL history
        const rows = await (0, db_1.query)(`SELECT total FROM pnl 
       ORDER BY date DESC 
       LIMIT 30`);
        if (rows.length === 0)
            return 0;
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
    setCircuitBreaker(enabled) {
        this.circuitBreaker = enabled;
        logger_1.logger.info({ enabled }, 'Circuit breaker toggled');
    }
    pause() {
        this.paused = true;
        logger_1.logger.info('Risk manager paused');
    }
    resume() {
        this.paused = false;
        logger_1.logger.info('Risk manager resumed');
    }
    updateLimits(limits) {
        this.riskLimits = { ...this.riskLimits, ...limits };
        logger_1.logger.info({ limits: this.riskLimits }, 'Risk limits updated');
    }
    getLimits() {
        return { ...this.riskLimits };
    }
    getStatus() {
        return {
            circuitBreaker: this.circuitBreaker,
            paused: this.paused,
            limits: this.riskLimits,
        };
    }
}
exports.riskManager = new RiskManager();
