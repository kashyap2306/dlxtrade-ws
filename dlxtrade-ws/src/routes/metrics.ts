import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db';
import { riskManager } from '../services/riskManager';
import { metricsService } from '../services/metricsService';

export async function metricsRoutes(fastify: FastifyInstance) {
  // Detailed health check with database status (for monitoring)
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Check database
      await query('SELECT 1');

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return reply.code(503).send({
        status: 'unhealthy',
        error: 'Database connection failed',
      });
    }
  });

  fastify.get('/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get basic metrics
      const orderCount = await query('SELECT COUNT(*) as count FROM orders');
      const fillCount = await query('SELECT COUNT(*) as count FROM fills');
      const dailyPnL = await riskManager.getDailyPnL();
      const drawdown = await riskManager.getDrawdown();

      // Get per-user, per-strategy metrics
      const strategyMetrics = metricsService.getPrometheusMetrics();

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
    } catch (err) {
      return reply.code(500).send({ error: 'Failed to get metrics' });
    }
  });
}

