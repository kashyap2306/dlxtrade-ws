import { logger } from '../utils/logger';
import { researchEngine } from './researchEngine';
import { getFirebaseAdmin } from '../utils/firebase';
import { type ExchangeName } from './exchangeConnector';
import * as admin from 'firebase-admin';

/**
 * Scheduled Research Service
 * Runs deep research every 5 minutes for all active users
 */
export class ScheduledResearchService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start the scheduled research job (runs every 5 minutes)
   */
  start() {
    if (this.intervalId) {
      logger.warn('Scheduled research service already running');
      return;
    }

    logger.info('Starting scheduled research service (every 5 minutes)');
    
    // Run immediately on start, then every 5 minutes
    this.runScheduledResearch();
    
    this.intervalId = setInterval(() => {
      this.runScheduledResearch();
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Stop the scheduled research job
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Stopped scheduled research service');
    }
  }

  /**
   * Run research for all active users
   */
  private async runScheduledResearch() {
    if (this.isRunning) {
      logger.warn('Scheduled research already running, skipping');
      return;
    }

    this.isRunning = true;
    logger.info('Running scheduled research for all users');

    try {
      const db = getFirebaseAdmin().firestore();
      
      // Get all users (limit to first 100 to avoid timeout)
      const usersSnapshot = await db.collection('users').limit(100).get();
      
      const results = [];
      for (const userDoc of usersSnapshot.docs) {
        const uid = userDoc.id;
        try {
          await this.runResearchForUser(uid);
          results.push({ uid, status: 'success' });
        } catch (error: any) {
          logger.error({ error: error.message, uid }, 'Error running scheduled research for user');
          results.push({ uid, status: 'error', error: error.message });
        }
      }

      logger.info({ 
        totalUsers: usersSnapshot.size, 
        successful: results.filter(r => r.status === 'success').length,
        failed: results.filter(r => r.status === 'error').length,
      }, 'Scheduled research completed');
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error in scheduled research service');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run research for a specific user
   */
  private async runResearchForUser(uid: string) {
    try {
      // Get exchange connector
      const connectorResult = await this.getExchangeConnector(uid);
      
      if (!connectorResult) {
        logger.debug({ uid }, 'No exchange connector found, skipping scheduled research');
        return;
      }

      const { connector, exchange } = connectorResult;
      const adapter = connector;

      // Default symbol to analyze
      const symbol = 'BTCUSDT';

      // Fetch exchange data with proper error handling
      let orderbook: any = null;
      let ticker: any = null;
      let klines: any = null;

      try {
        orderbook = await adapter.getOrderbook(symbol, 20);
      } catch (err: any) {
        logger.warn({ err: err.message, uid, symbol }, 'Scheduled research: Orderbook fetch failed');
        orderbook = { error: err.message };
      }

      try {
        ticker = await adapter.getTicker(symbol);
      } catch (err: any) {
        logger.warn({ err: err.message, uid, symbol }, 'Scheduled research: Ticker fetch failed');
        ticker = { error: err.message };
      }

      try {
        klines = await adapter.getKlines(symbol, '1h', 100);
      } catch (err: any) {
        logger.warn({ err: err.message, uid, symbol }, 'Scheduled research: Klines fetch failed');
        klines = { error: err.message };
      }

      // Calculate technical indicators
      let rsi = 50;
      let macd = { macd: 0, signal: 0, histogram: 0 };
      let ma50 = 0;
      let ma200 = 0;

      if (klines && !klines.error && Array.isArray(klines)) {
        const closes = klines.map((k: any) => parseFloat(k.close || k[4] || '0')).filter((p: number) => p > 0);
        
        if (closes.length >= 14) {
          rsi = this.calculateRSI(closes);
        }
        
        if (closes.length >= 26) {
          const ema12 = this.calculateEMA(closes, 12);
          const ema26 = this.calculateEMA(closes, 26);
          macd.macd = ema12 - ema26;
          macd.signal = this.calculateEMA(closes.slice(-9), 9);
          macd.histogram = macd.macd - macd.signal;
        }
        
        if (closes.length >= 50) {
          ma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
        }
        
        if (closes.length >= 200) {
          ma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
        } else if (closes.length > 0) {
          ma200 = closes.reduce((a, b) => a + b, 0) / closes.length;
        }
      }

      // Run research engine analysis (optional - don't fail if it errors)
      let researchResult: any = null;
      try {
        researchResult = await researchEngine.runResearch(symbol, uid, adapter);
      } catch (err: any) {
        logger.warn({ err: err.message, uid, symbol }, 'Scheduled research: Research engine analysis failed, using indicators only');
      }

      // Determine signal based on indicators and research
      let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
      let accuracy = 0.5;
      
      if (researchResult) {
        accuracy = researchResult.accuracy || 0.5;
        if (researchResult.signal) {
          signal = researchResult.signal as 'BUY' | 'SELL' | 'HOLD';
        }
      }
      
      // Fallback to indicator-based signal if research engine didn't provide one
      if (signal === 'HOLD' && rsi < 30 && ma50 > ma200) {
        signal = 'BUY';
        accuracy = Math.max(accuracy, 0.7);
      } else if (signal === 'HOLD' && rsi > 70 && ma50 < ma200) {
        signal = 'SELL';
        accuracy = Math.max(accuracy, 0.7);
      }

      // Calculate orderbook imbalance
      let orderbookImbalance = 0;
      if (orderbook && !orderbook.error && orderbook.bids && orderbook.asks) {
        const bidVolume = orderbook.bids.slice(0, 10).reduce((sum: number, bid: any) => 
          sum + parseFloat(bid.quantity || '0'), 0);
        const askVolume = orderbook.asks.slice(0, 10).reduce((sum: number, ask: any) => 
          sum + parseFloat(ask.quantity || '0'), 0);
        const totalVolume = bidVolume + askVolume;
        if (totalVolume > 0) {
          orderbookImbalance = (bidVolume - askVolume) / totalVolume;
        }
      }

      // Get current price
      const currentPrice = ticker && !ticker.error 
        ? parseFloat(ticker.price || ticker.lastPrice || '0')
        : 0;

      // Save to research logs
      const db = getFirebaseAdmin().firestore();
      await db.collection('users').doc(uid).collection('researchLogs').add({
        symbol,
        signal,
        accuracy,
        timestamp: admin.firestore.Timestamp.now(),
        orderbookImbalance,
        recommendedAction: signal,
        microSignals: {
          rsi,
          macd,
          ma50,
          ma200,
          price: currentPrice,
        },
        exchange,
        createdAt: admin.firestore.Timestamp.now(),
      });

      logger.info({ uid, symbol, signal, accuracy }, 'Scheduled research completed and saved');
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error running research for user');
      throw error;
    }
  }

  /**
   * Get exchange connector for user (uses unified resolver)
   */
  private async getExchangeConnector(uid: string): Promise<{ connector: any; exchange: ExchangeName } | null> {
    const { resolveExchangeConnector } = await import('./exchangeResolver');
    const resolved = await resolveExchangeConnector(uid);
    
    if (resolved) {
      return {
        connector: resolved.connector,
        exchange: resolved.exchange,
      };
    }
    
    // Silently skip users without credentials (no log spam)
    return null;
  }

  /**
   * Calculate EMA
   */
  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] || 0;
    
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    
    return ema;
  }

  /**
   * Calculate RSI
   */
  private calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 50;
    
    const gains: number[] = [];
    const losses: number[] = [];
    
    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }
    
    if (gains.length < period) return 50;
    
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }
}

export const scheduledResearchService = new ScheduledResearchService();

