"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metricsService = void 0;
const logger_1 = require("../utils/logger");
class MetricsService {
    constructor() {
        this.userMetrics = new Map(); // uid -> strategy -> metrics
    }
    recordTrade(uid, strategy, success, latency) {
        if (!this.userMetrics.has(uid)) {
            this.userMetrics.set(uid, new Map());
        }
        const userStrategyMetrics = this.userMetrics.get(uid);
        if (!userStrategyMetrics.has(strategy)) {
            userStrategyMetrics.set(strategy, {
                tradesExecuted: 0,
                failedOrders: 0,
                cancels: 0,
                totalLatency: 0,
                latencyCount: 0,
            });
        }
        const metrics = userStrategyMetrics.get(strategy);
        if (success) {
            metrics.tradesExecuted++;
        }
        else {
            metrics.failedOrders++;
        }
        if (latency !== undefined) {
            metrics.totalLatency += latency;
            metrics.latencyCount++;
        }
        logger_1.logger.debug({ uid, strategy, success, latency }, 'Trade metric recorded');
    }
    recordCancel(uid, strategy) {
        if (!this.userMetrics.has(uid)) {
            this.userMetrics.set(uid, new Map());
        }
        const userStrategyMetrics = this.userMetrics.get(uid);
        if (!userStrategyMetrics.has(strategy)) {
            userStrategyMetrics.set(strategy, {
                tradesExecuted: 0,
                failedOrders: 0,
                cancels: 0,
                totalLatency: 0,
                latencyCount: 0,
            });
        }
        const metrics = userStrategyMetrics.get(strategy);
        metrics.cancels++;
    }
    getMetrics(uid) {
        if (uid) {
            const userMetrics = this.userMetrics.get(uid);
            if (userMetrics) {
                const result = new Map();
                result.set(uid, userMetrics);
                return result;
            }
            return new Map();
        }
        return this.userMetrics;
    }
    getPrometheusMetrics() {
        const lines = [
            '# HELP dlxtrade_trades_executed_total Total number of trades executed',
            '# TYPE dlxtrade_trades_executed_total counter',
            '# HELP dlxtrade_failed_orders_total Total number of failed orders',
            '# TYPE dlxtrade_failed_orders_total counter',
            '# HELP dlxtrade_cancels_total Total number of order cancellations',
            '# TYPE dlxtrade_cancels_total counter',
            '# HELP dlxtrade_avg_latency_ms Average execution latency in milliseconds',
            '# TYPE dlxtrade_avg_latency_ms gauge',
        ];
        for (const [uid, strategyMetrics] of this.userMetrics.entries()) {
            for (const [strategy, metrics] of strategyMetrics.entries()) {
                lines.push(`dlxtrade_trades_executed_total{uid="${uid}",strategy="${strategy}"} ${metrics.tradesExecuted}`);
                lines.push(`dlxtrade_failed_orders_total{uid="${uid}",strategy="${strategy}"} ${metrics.failedOrders}`);
                lines.push(`dlxtrade_cancels_total{uid="${uid}",strategy="${strategy}"} ${metrics.cancels}`);
                const avgLatency = metrics.latencyCount > 0
                    ? metrics.totalLatency / metrics.latencyCount
                    : 0;
                lines.push(`dlxtrade_avg_latency_ms{uid="${uid}",strategy="${strategy}"} ${avgLatency.toFixed(2)}`);
            }
        }
        return lines.join('\n');
    }
    reset(uid) {
        if (uid) {
            this.userMetrics.delete(uid);
        }
        else {
            this.userMetrics.clear();
        }
    }
}
exports.metricsService = new MetricsService();
