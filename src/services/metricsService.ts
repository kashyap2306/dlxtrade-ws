import { logger } from '../utils/logger';

interface TradeMetrics {
  tradesExecuted: number;
  failedOrders: number;
  cancels: number;
  totalLatency: number;
  latencyCount: number;
}

interface ResearchMetrics {
  researchRuns: number;
  autoTradesExecuted: number;
  researchFailures: number;
  avgConfidence: number;
  confidenceSum: number;
  confidenceCount: number;
}

class MetricsService {
  private userMetrics: Map<string, Map<string, TradeMetrics>> = new Map(); // uid -> strategy -> metrics
  private researchMetrics: Map<string, ResearchMetrics> = new Map(); // uid -> research metrics

  recordTrade(uid: string, strategy: string, success: boolean, latency?: number): void {
    if (!this.userMetrics.has(uid)) {
      this.userMetrics.set(uid, new Map());
    }
    const userStrategyMetrics = this.userMetrics.get(uid)!;
    
    if (!userStrategyMetrics.has(strategy)) {
      userStrategyMetrics.set(strategy, {
        tradesExecuted: 0,
        failedOrders: 0,
        cancels: 0,
        totalLatency: 0,
        latencyCount: 0,
      });
    }

    const metrics = userStrategyMetrics.get(strategy)!;
    
    if (success) {
      metrics.tradesExecuted++;
    } else {
      metrics.failedOrders++;
    }

    if (latency !== undefined) {
      metrics.totalLatency += latency;
      metrics.latencyCount++;
    }

    logger.debug({ uid, strategy, success, latency }, 'Trade metric recorded');
  }

  recordCancel(uid: string, strategy: string): void {
    if (!this.userMetrics.has(uid)) {
      this.userMetrics.set(uid, new Map());
    }
    const userStrategyMetrics = this.userMetrics.get(uid)!;
    
    if (!userStrategyMetrics.has(strategy)) {
      userStrategyMetrics.set(strategy, {
        tradesExecuted: 0,
        failedOrders: 0,
        cancels: 0,
        totalLatency: 0,
        latencyCount: 0,
      });
    }

    const metrics = userStrategyMetrics.get(strategy)!;
    metrics.cancels++;
  }

  getMetrics(uid?: string): Map<string, Map<string, TradeMetrics>> {
    if (uid) {
      const userMetrics = this.userMetrics.get(uid);
      if (userMetrics) {
        const result = new Map<string, Map<string, TradeMetrics>>();
        result.set(uid, userMetrics);
        return result;
      }
      return new Map();
    }
    return this.userMetrics;
  }

  reset(uid?: string): void {
    if (uid) {
      this.userMetrics.delete(uid);
      this.researchMetrics.delete(uid);
    } else {
      this.userMetrics.clear();
      this.researchMetrics.clear();
    }
  }

  // Research metrics
  recordResearchRun(uid: string, success: boolean, confidence?: number): void {
    if (!this.researchMetrics.has(uid)) {
      this.researchMetrics.set(uid, {
        researchRuns: 0,
        autoTradesExecuted: 0,
        researchFailures: 0,
        avgConfidence: 0,
        confidenceSum: 0,
        confidenceCount: 0,
      });
    }
    const metrics = this.researchMetrics.get(uid)!;
    metrics.researchRuns++;
    if (!success) {
      metrics.researchFailures++;
    }
    if (confidence !== undefined) {
      metrics.confidenceSum += confidence;
      metrics.confidenceCount++;
      metrics.avgConfidence = metrics.confidenceSum / metrics.confidenceCount;
    }
    logger.debug({ uid, success, confidence, researchRuns: metrics.researchRuns }, 'Research metric recorded');
  }

  recordAutoTrade(uid: string): void {
    if (!this.researchMetrics.has(uid)) {
      this.researchMetrics.set(uid, {
        researchRuns: 0,
        autoTradesExecuted: 0,
        researchFailures: 0,
        avgConfidence: 0,
        confidenceSum: 0,
        confidenceCount: 0,
      });
    }
    const metrics = this.researchMetrics.get(uid)!;
    metrics.autoTradesExecuted++;
    logger.debug({ uid, autoTradesExecuted: metrics.autoTradesExecuted }, 'Auto-trade metric recorded');
  }

  getResearchMetrics(uid?: string): Map<string, ResearchMetrics> {
    if (uid) {
      const metrics = this.researchMetrics.get(uid);
      if (metrics) {
        const result = new Map<string, ResearchMetrics>();
        result.set(uid, metrics);
        return result;
      }
      return new Map();
    }
    return this.researchMetrics;
  }

  getPrometheusMetrics(): string {
    const lines: string[] = [
      '# HELP dlxtrade_trades_executed_total Total number of trades executed',
      '# TYPE dlxtrade_trades_executed_total counter',
      '# HELP dlxtrade_failed_orders_total Total number of failed orders',
      '# TYPE dlxtrade_failed_orders_total counter',
      '# HELP dlxtrade_cancels_total Total number of order cancellations',
      '# TYPE dlxtrade_cancels_total counter',
      '# HELP dlxtrade_avg_latency_ms Average execution latency in milliseconds',
      '# TYPE dlxtrade_avg_latency_ms gauge',
      '# HELP dlxtrade_research_runs_total Total number of research runs',
      '# TYPE dlxtrade_research_runs_total counter',
      '# HELP dlxtrade_auto_trades_executed_total Total number of auto-trades executed',
      '# TYPE dlxtrade_auto_trades_executed_total counter',
      '# HELP dlxtrade_research_failures_total Total number of research failures',
      '# TYPE dlxtrade_research_failures_total counter',
      '# HELP dlxtrade_avg_confidence Average confidence score',
      '# TYPE dlxtrade_avg_confidence gauge',
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

    for (const [uid, metrics] of this.researchMetrics.entries()) {
      lines.push(`dlxtrade_research_runs_total{uid="${uid}"} ${metrics.researchRuns}`);
      lines.push(`dlxtrade_auto_trades_executed_total{uid="${uid}"} ${metrics.autoTradesExecuted}`);
      lines.push(`dlxtrade_research_failures_total{uid="${uid}"} ${metrics.researchFailures}`);
      lines.push(`dlxtrade_avg_confidence{uid="${uid}"} ${metrics.avgConfidence.toFixed(2)}`);
    }

    return lines.join('\n');
  }
}

export const metricsService = new MetricsService();

