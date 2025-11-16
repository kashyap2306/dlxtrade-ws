import { logger } from '../utils/logger';
import { researchEngine } from './researchEngine';
import { firestoreAdapter } from './firestoreAdapter';
import { OrderManager } from './orderManager';
import { BinanceAdapter } from './binanceAdapter';
import { strategyManager } from '../strategies/strategyManager';
import { userRiskManager } from './userRiskManager';
import { metricsService } from './metricsService';
import type { Orderbook } from '../types';

export class AccuracyEngine {
  private adapter: BinanceAdapter | null = null;
  private uid: string | null = null;
  private orderManager: OrderManager | null = null;
  private isRunning: boolean = false;
  private researchInterval: NodeJS.Timeout | null = null;
  private wsClients: Set<any> = new Set();
  // Best-effort exit monitoring cadence
  private lastExitCheckAt: number = 0;

  setAdapter(adapter: BinanceAdapter): void {
    this.adapter = adapter;
    researchEngine.setAdapter(adapter);
  }

  setOrderManager(orderManager: OrderManager): void {
    this.orderManager = orderManager;
  }

  // Minimal, defensive exit monitor. Uses optional methods on orderManager if present.
  private async monitorExits(symbol: string): Promise<void> {
    // Throttle checks to at most once per 2 seconds
    const now = Date.now();
    if (now - this.lastExitCheckAt < 2000) return;
    this.lastExitCheckAt = now;

    if (!this.uid || !this.adapter || !this.orderManager) return;

    try {
      // Fetch current mid price
      const ob: Orderbook = await this.adapter.getOrderbook(symbol, 5);
      const bb = parseFloat(ob.bids[0]?.price || '0');
      const ba = parseFloat(ob.asks[0]?.price || '0');
      const mid = (bb + ba) / 2;
      if (!mid) return;

      // Try to get open positions and their SL/TP (if orderManager implements these)
      const getPositions = (this.orderManager as any).getOpenPositions;
      const closePosition = (this.orderManager as any).closePosition;
      if (typeof getPositions !== 'function') return;

      const positions: any[] = await getPositions(this.uid, symbol);
      if (!Array.isArray(positions) || positions.length === 0) return;

      for (const pos of positions) {
        const side = (pos.side || '').toUpperCase();
        const sl = pos.stopLoss;
        const tp = pos.takeProfit;
        const qty = pos.quantity || pos.qty || 0;
        if (!qty || typeof closePosition !== 'function') continue;

        let hit = false;
        let reason = '';
        if (typeof sl === 'number') {
          if ((side === 'BUY' && mid <= sl) || (side === 'SELL' && mid >= sl)) {
            hit = true;
            reason = 'Stop loss hit';
          }
        }
        if (!hit && typeof tp === 'number') {
          if ((side === 'BUY' && mid >= tp) || (side === 'SELL' && mid <= tp)) {
            hit = true;
            reason = 'Take profit hit';
          }
        }

        // Time-based exit if configured on the position (ttlMs)
        if (!hit && pos.openedAt && pos.ttlMs) {
          const openedAt = typeof pos.openedAt === 'number' ? pos.openedAt : new Date(pos.openedAt).getTime();
          if (now - openedAt >= pos.ttlMs) {
            hit = true;
            reason = 'Time-based exit';
          }
        }

        if (hit) {
          try {
            await closePosition(this.uid, symbol, pos.id);
            const admin = await import('firebase-admin');
            await firestoreAdapter.saveExecutionLog(this.uid, {
              symbol,
              timestamp: admin.firestore.Timestamp.now(),
              action: 'CLOSED',
              reason,
              status: 'FILLED',
            });
            this.broadcast({
              type: 'execution',
              data: { symbol, action: 'CLOSED', reason, timestamp: new Date().toISOString() },
            });
          } catch (err) {
            logger.error({ err, symbol, posId: pos.id }, 'Error closing position on exit monitor');
          }
        }
      }
    } catch (err) {
      logger.debug({ err }, 'Exit monitor skipped due to error');
    }
  }

  setUserId(uid: string): void {
    this.uid = uid;
  }

  registerWebSocketClient(ws: any): void {
    this.wsClients.add(ws);
  }

  unregisterWebSocketClient(ws: any): void {
    this.wsClients.delete(ws);
  }

  private broadcast(data: any): void {
    const message = JSON.stringify(data);
    this.wsClients.forEach((ws) => {
      try {
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(message);
        }
      } catch (err) {
        logger.error({ err }, 'Error broadcasting to WebSocket client');
      }
    });
  }

  async start(symbol: string, researchIntervalMs: number = 5000): Promise<void> {
    if (this.isRunning) {
      throw new Error('Accuracy engine already running');
    }

    if (!this.uid) {
      throw new Error('User ID not set');
    }

    this.isRunning = true;
    logger.info({ symbol, interval: researchIntervalMs }, 'Accuracy engine started');

    // Start research loop
    this.researchInterval = setInterval(async () => {
      try {
        await this.runResearchCycle(symbol);
      } catch (err) {
        logger.error({ err }, 'Error in research cycle');
      }
    }, researchIntervalMs);

    // Run first cycle immediately
    await this.runResearchCycle(symbol);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.researchInterval) {
      clearInterval(this.researchInterval);
      this.researchInterval = null;
    }

    logger.info('Accuracy engine stopped');
  }

  private async runResearchCycle(symbol: string): Promise<void> {
    if (!this.uid || !this.adapter) return;

    const startTime = Date.now();

    // Run research with this user's adapter
    const research = await researchEngine.runResearch(symbol, this.uid, this.adapter);

    // Get settings
    const settings = await firestoreAdapter.getSettings(this.uid);
    const minAccuracy = settings?.minAccuracyThreshold || 0.85;
    const autoTradeEnabled = settings?.autoTradeEnabled || false;

    // Broadcast research result
    this.broadcast({
      type: 'research',
      data: {
        symbol: research.symbol,
        signal: research.signal,
        accuracy: research.accuracy,
        orderbookImbalance: research.orderbookImbalance,
        recommendedAction: research.recommendedAction,
        timestamp: new Date().toISOString(),
      },
    });

    // Check if we should execute
    if (autoTradeEnabled && research.accuracy >= minAccuracy && research.signal !== 'HOLD') {
      await this.executeTrade(symbol, research, startTime);
    } else {
      // Log skipped trade
      const admin = await import('firebase-admin');
      await firestoreAdapter.saveExecutionLog(this.uid, {
        symbol,
        timestamp: admin.firestore.Timestamp.now(),
        action: 'SKIPPED',
        reason: research.accuracy < minAccuracy
          ? `Accuracy ${(research.accuracy * 100).toFixed(1)}% below threshold ${(minAccuracy * 100).toFixed(1)}%`
          : !autoTradeEnabled
          ? 'Auto-trade disabled'
          : 'HOLD signal',
        accuracy: research.accuracy,
      });

      this.broadcast({
        type: 'execution',
        data: {
          symbol,
          action: 'SKIPPED',
          reason: research.accuracy < minAccuracy
            ? `Accuracy ${(research.accuracy * 100).toFixed(1)}% below threshold`
            : 'HOLD signal',
          accuracy: research.accuracy,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Passive exit monitoring (non-blocking)
    try {
      await this.monitorExits(symbol);
    } catch (e) {
      logger.debug({ e }, 'Exit monitor error (non-fatal)');
    }
  }

  private async executeTrade(
    symbol: string,
    research: any,
    startTime: number
  ): Promise<void> {
    if (!this.uid || !this.adapter || !this.orderManager) return;

    try {
      // Get settings
      const settings = await firestoreAdapter.getSettings(this.uid);
      if (!settings) {
        throw new Error('Settings not found');
      }

      const strategyName = settings.strategy || 'orderbook_imbalance';
      const quoteSize = settings.quoteSize || 0.001;

      // Get current orderbook
      const orderbook = await this.adapter.getOrderbook(symbol, 20);
      const bestBid = parseFloat(orderbook.bids[0]?.price || '0');
      const bestAsk = parseFloat(orderbook.asks[0]?.price || '0');
      const midPrice = (bestBid + bestAsk) / 2;

      // Check risk limits before executing (use price-aware risk)
      const assumedAdverseMove = 0.01; // default 1% until volatility is wired here
      const riskCheck = await userRiskManager.canTrade(this.uid, symbol, quoteSize, midPrice, assumedAdverseMove);
      if (!riskCheck.allowed) {
        logger.warn({ uid: this.uid, reason: riskCheck.reason }, 'Trade blocked by risk manager');
        
        const admin = await import('firebase-admin');
        await firestoreAdapter.saveExecutionLog(this.uid, {
          symbol,
          timestamp: admin.firestore.Timestamp.now(),
          action: 'SKIPPED',
          reason: riskCheck.reason || 'Risk check failed',
          accuracy: research.accuracy,
        });

        this.broadcast({
          type: 'risk:alert',
          data: {
            symbol,
            reason: riskCheck.reason,
            timestamp: new Date().toISOString(),
          },
        });

        return;
      }

      // orderbook already fetched above

      // Skip market_making_hft - that's handled by HFT engine only
      if (strategyName === 'market_making_hft') {
        logger.warn({ uid: this.uid, symbol }, 'market_making_hft should be run via HFT engine, not AI engine');
        return;
      }

      // Initialize strategy if not already done
      const strategyConfig = {
        quoteSize,
        adversePct: settings.adversePct || 0.0002,
        cancelMs: settings.cancelMs || 40,
        maxPos: settings.maxPos || 0.01,
      };

      try {
        await strategyManager.initializeStrategy(
          this.uid,
          strategyName,
          strategyConfig,
          this.adapter,
          this.orderManager
        );
      } catch (err) {
        // Strategy might already be initialized, that's okay
        logger.debug({ uid: this.uid, strategy: strategyName }, 'Strategy initialization (may already be initialized)');
      }

      // Execute strategy
      const tradeDecision = await strategyManager.executeStrategy(
        this.uid,
        strategyName,
        research,
        orderbook
      );

      // For other strategies, execute the trade decision
      if (tradeDecision && tradeDecision.action !== 'HOLD') {
        let order = null;

        if (tradeDecision.action === 'BUY' || tradeDecision.action === 'SELL') {
          order = await this.orderManager.placeOrder(this.uid, {
            symbol,
            side: tradeDecision.action,
            type: tradeDecision.type,
            quantity: tradeDecision.quantity,
            price: tradeDecision.price,
          });
        }

        if (order) {
          const executionLatency = Date.now() - startTime;
          const slippage = tradeDecision.price
            ? Math.abs((order.avgPrice || order.price || 0) - tradeDecision.price) / tradeDecision.price
            : 0;

          // Record trade result (success for now, will update on fill)
          await userRiskManager.recordTradeResult(this.uid, 0, true);

          // PART 4: Save trade to Firestore trades collection with full schema
          const admin = await import('firebase-admin');
          const entryPrice = order.avgPrice || order.price || tradeDecision.price || 0;
          
          const tradeId = await firestoreAdapter.saveTrade(this.uid, {
            symbol,
            side: order.side.toLowerCase() as 'buy' | 'sell',
            qty: order.quantity,
            entryPrice,
            exitPrice: undefined, // Will be set when trade closes
            pnl: undefined, // Will be calculated when trade closes
            timestamp: admin.firestore.Timestamp.now(),
            engineType: 'auto' as const,
            orderId: order.id,
          });

          // PART 4: Update user's totalTrades
          const userData = await firestoreAdapter.getUser(this.uid);
          const currentTrades = userData?.totalTrades || 0;
          await firestoreAdapter.createOrUpdateUser(this.uid, {
            totalTrades: currentTrades + 1,
          });

          // PART 4: Update globalStats
          const globalStats = await firestoreAdapter.getGlobalStats();
          if (globalStats) {
            await firestoreAdapter.updateGlobalStats({
              totalTrades: (globalStats.totalTrades || 0) + 1,
            });
          }

          // PART 6: Log execution with all required fields
          await firestoreAdapter.saveExecutionLog(this.uid, {
            symbol,
            timestamp: admin.firestore.Timestamp.now(),
            action: 'EXECUTED',
            accuracy: research.accuracy,
            accuracyUsed: research.accuracy, // The accuracy used for this decision
            orderId: order.id,
            orderIds: [order.id], // For market making, could be multiple
            executionLatency,
            slippage,
            strategy: strategyName,
            signal: research.signal,
            pnl: 0, // Will be updated when position closes
            status: order.status,
          });

          // PART 6: Log activity
          await firestoreAdapter.logActivity(this.uid, 'TRADE_EXECUTED', {
            message: `Auto-trade executed: ${order.side} ${order.quantity} ${symbol} at ${entryPrice}`,
            symbol,
            side: order.side,
            price: entryPrice,
            quantity: order.quantity,
            orderId: order.id,
            tradeId,
          });

          // Also save to Postgres (orderManager already does this, but we can add strategy field)
          // The order is already in Postgres via orderManager.placeOrder

          this.broadcast({
            type: 'execution',
            data: {
              symbol,
              action: 'EXECUTED',
              orderId: order.id,
              side: order.side,
              quantity: order.quantity,
              price: order.price,
              accuracy: research.accuracy,
              executionLatency,
              slippage,
              strategy: strategyName,
              timestamp: new Date().toISOString(),
            },
          });

          // Record metrics
          metricsService.recordTrade(this.uid, strategyName, true, executionLatency);

          // Notify admin WebSocket
          const { adminWebSocketManager } = await import('./adminWebSocketManager');
          adminWebSocketManager.notifyExecutionTrade(this.uid, {
            symbol,
            action: 'EXECUTED',
            orderId: order.id,
            side: order.side,
            quantity: order.quantity,
            price: order.price,
            accuracy: research.accuracy,
            strategy: strategyName,
          });

          logger.info(
            { symbol, orderId: order.id, accuracy: research.accuracy, strategy: strategyName },
            'Trade executed via strategy'
          );
        }
      } else {
        // Strategy decided to hold or returned null
        const admin = await import('firebase-admin');
        await firestoreAdapter.saveExecutionLog(this.uid, {
          symbol,
          timestamp: admin.firestore.Timestamp.now(),
          action: 'SKIPPED',
          reason: tradeDecision?.reason || 'Strategy returned HOLD',
          accuracy: research.accuracy,
          strategy: strategyName,
        });
      }
    } catch (err) {
      logger.error({ err, symbol, uid: this.uid }, 'Error executing trade');
      
      // Record failure
      const settings = await firestoreAdapter.getSettings(this.uid);
      const strategyName = settings?.strategy || 'orderbook_imbalance';
      metricsService.recordTrade(this.uid, strategyName, false);
      await userRiskManager.recordTradeResult(this.uid, 0, false);

      const admin = await import('firebase-admin');
      await firestoreAdapter.saveExecutionLog(this.uid, {
        symbol,
        timestamp: admin.firestore.Timestamp.now(),
        action: 'SKIPPED',
        reason: `Execution error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        accuracy: research.accuracy,
      });
    }
  }
}

export const accuracyEngine = new AccuracyEngine();

