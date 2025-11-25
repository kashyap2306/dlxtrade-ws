"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metricsRoutes = metricsRoutes;
const db_1 = require("../db");
const riskManager_1 = require("../services/riskManager");
const metricsService_1 = require("../services/metricsService");
async function metricsRoutes(fastify) {
    fastify.get('/health', async (request, reply) => {
        try {
            // Check database
            await (0, db_1.query)('SELECT 1');
            return {
                status: 'healthy',
                timestamp: new Date().toISOString(),
            };
        }
        catch (err) {
            return reply.code(503).send({
                status: 'unhealthy',
                error: 'Database connection failed',
            });
        }
    });
    fastify.get('/metrics', async (request, reply) => {
        try {
            // Get basic metrics
            const orderCount = await (0, db_1.query)('SELECT COUNT(*) as count FROM orders');
            const fillCount = await (0, db_1.query)('SELECT COUNT(*) as count FROM fills');
            const dailyPnL = await riskManager_1.riskManager.getDailyPnL();
            const drawdown = await riskManager_1.riskManager.getDrawdown();
            // Get per-user, per-strategy metrics
            const strategyMetrics = metricsService_1.metricsService.getPrometheusMetrics();
            // Prometheus format
            const metrics = [
                `# HELP dlxtrade_orders_total Total number of orders`,
                `# TYPE dlxtrade_orders_total counter`,
                `dlxtrade_orders_total ${orderCount[0].count}`,
                ``,
                `# HELP dlxtrade_fills_total Total number of fills`,
                `# TYPE dlxtrade_fills_total counter`,
                `dlxtrade_fills_total ${fillCount[0].count}`,
                ``,
                `# HELP dlxtrade_daily_pnl Daily PnL in USD`,
                `# TYPE dlxtrade_daily_pnl gauge`,
                `dlxtrade_daily_pnl ${dailyPnL}`,
                ``,
                `# HELP dlxtrade_drawdown Current drawdown in USD`,
                `# TYPE dlxtrade_drawdown gauge`,
                `dlxtrade_drawdown ${drawdown}`,
                ``,
                strategyMetrics,
            ].join('\n');
            reply.type('text/plain');
            return metrics;
        }
        catch (err) {
            return reply.code(500).send({ error: 'Failed to get metrics' });
        }
    });
}
