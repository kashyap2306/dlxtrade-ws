import { getFirebaseAdmin } from '../utils/firebase';
import { logger } from '../utils/logger';

interface MasterTraderPosition {
  exchange: string;
  traderId: string;
  pair: 'BTCUSDT' | 'ETHUSDT';
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  quantity: number;
  timestamp: Date;
  leverage: number;
}

interface ConsensusSignal {
  pair: 'BTCUSDT' | 'ETHUSDT';
  direction: 'LONG' | 'SHORT';
  consensusStrength: number; // Number of exchanges agreeing
  avgEntryPrice: number;
  totalVolume: number;
  exchanges: string[];
  timestamp: Date;
  confidence: number; // 0-100
}

interface SupportResistance {
  support: number;
  resistance: number;
  lastSwingLow: number;
  lastSwingHigh: number;
}

interface CrowdConsensusTrade {
  id: string;
  consensusId?: string;
  pair: 'BTCUSDT' | 'ETHUSDT';
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity?: number;
  leverage?: number;
  riskAmount?: number;
  rrRatio: number;
  executedAt: Date;
  status: 'PENDING' | 'EXECUTED' | 'FAILED' | 'SIMULATED';
  orderId?: string;
}

export class CrowdConsensusService {
  private static readonly MONITORED_EXCHANGES = [
    'binance', 'bybit', 'bitget', 'okx', 'kucoin',
    'bingx', 'gate', 'mexc', 'phemex', 'coinex'
  ];

  private static readonly SUPPORTED_PAIRS = ['BTCUSDT', 'ETHUSDT'];

  /**
   * Analyze consensus from multiple exchanges (main entry point)
   */
  static async analyzeConsensus(): Promise<ConsensusSignal[]> {
    try {
      logger.info('Starting consensus analysis across exchanges');

      // Monitor master trader positions across all exchanges
      const allPositions = await this.monitorMasterTraders();

      if (allPositions.length === 0) {
        logger.info('No master trader positions found across exchanges');
        return [];
      }

      logger.info({ positionCount: allPositions.length }, 'Collected master trader positions');

      // Detect consensus signals
      const signals = this.detectConsensus(allPositions);

      logger.info({ signalCount: signals.length }, 'Consensus analysis completed');

      return signals;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to analyze consensus');
      return [];
    }
  }

  /**
   * Monitor master trader positions across exchanges
   */
  static async monitorMasterTraders(): Promise<MasterTraderPosition[]> {
    const positions: MasterTraderPosition[] = [];

    try {
      // Monitor all supported exchanges concurrently
      const monitoringPromises = this.MONITORED_EXCHANGES.flatMap(exchange =>
        this.SUPPORTED_PAIRS.map(pair =>
          this.fetchExchangeMasterPositions(exchange, pair)
        )
      );

      const results = await Promise.allSettled(monitoringPromises);

      // Collect successful results
      for (const result of results) {
        if (result.status === 'fulfilled') {
          positions.push(...result.value);
        } else {
          logger.warn({ error: result.reason }, 'Failed to fetch positions from exchange');
        }
      }

      logger.info({
        totalPositions: positions.length,
        exchangesMonitored: this.MONITORED_EXCHANGES.length,
        pairsMonitored: this.SUPPORTED_PAIRS.length
      }, 'Completed master trader monitoring');

    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to monitor master traders');
    }

    return positions;
  }

  /**
   * Fetch master trader positions from a specific exchange
   * In production, this would integrate with actual exchange copy trading APIs
   * For now, simulates realistic master trader activity
   */
  private static async fetchExchangeMasterPositions(exchange: string, pair: string): Promise<MasterTraderPosition[]> {
    try {
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

      const positions: MasterTraderPosition[] = [];

      // Simulate master trader activity (in production, this would come from exchange APIs)
      // Generate 0-3 random positions per exchange/pair combination
      const positionCount = Math.floor(Math.random() * 4); // 0-3 positions

      for (let i = 0; i < positionCount; i++) {
        // 60% chance for BTC, 40% for ETH
        const actualPair = Math.random() < 0.6 ? 'BTCUSDT' : 'ETHUSDT';

        // Skip if not the requested pair
        if (actualPair !== pair) continue;

        const direction = Math.random() < 0.5 ? 'LONG' : 'SHORT';
        const basePrice = pair === 'BTCUSDT' ? 45000 + Math.random() * 10000 : 2500 + Math.random() * 500;
        const priceVariation = (Math.random() - 0.5) * 200; // ±100 variation
        const entryPrice = Math.round((basePrice + priceVariation) * 100) / 100;

        const leverage = Math.floor(Math.random() * 8) + 3; // 3-10x leverage
        const quantity = Math.round((Math.random() * 0.5 + 0.1) * 100) / 100; // 0.1-0.6 BTC/ETH

        // Recent activity (last 30 minutes)
        const minutesAgo = Math.floor(Math.random() * 30);
        const timestamp = new Date(Date.now() - minutesAgo * 60 * 1000);

        positions.push({
          exchange,
          traderId: `${exchange}_master_${Math.floor(Math.random() * 1000)}`,
          pair: actualPair as 'BTCUSDT' | 'ETHUSDT',
          direction: direction as 'LONG' | 'SHORT',
          entryPrice,
          quantity,
          timestamp,
          leverage
        });
      }

      logger.info({
        exchange,
        pair,
        positionCount: positions.length
      }, 'Fetched master trader positions');

      return positions;

    } catch (error: any) {
      logger.error({
        exchange,
        pair,
        error: error.message
      }, 'Failed to fetch master trader positions');
      return [];
    }
  }

  /**
   * Detect consensus signals from master trader positions
   */
  static detectConsensus(positions: MasterTraderPosition[]): ConsensusSignal[] {
    const signals: ConsensusSignal[] = [];

    for (const pair of this.SUPPORTED_PAIRS) {
      const pairPositions = positions.filter(p => p.pair === pair);

      if (pairPositions.length === 0) continue;

      // Group by direction
      const longPositions = pairPositions.filter(p => p.direction === 'LONG');
      const shortPositions = pairPositions.filter(p => p.direction === 'SHORT');

      // Check for consensus (minimum 2-3 exchanges agreeing)
      const longConsensus = this.hasConsensus(longPositions);
      const shortConsensus = this.hasConsensus(shortPositions);

      // Skip if conflicting signals
      if (longConsensus && shortConsensus) {
        logger.info({ pair }, 'Conflicting consensus signals - skipping');
        continue;
      }

      if (longConsensus) {
        const signal = this.createConsensusSignal(pair, 'LONG', longPositions);
        if (signal) signals.push(signal);
      } else if (shortConsensus) {
        const signal = this.createConsensusSignal(pair, 'SHORT', shortPositions);
        if (signal) signals.push(signal);
      }
    }

    return signals;
  }

  /**
   * Check if positions form a consensus (2-3+ exchanges agreeing)
   */
  private static hasConsensus(positions: MasterTraderPosition[]): boolean {
    if (positions.length < 2) return false;

    const exchanges = [...new Set(positions.map(p => p.exchange))];
    return exchanges.length >= 2; // At least 2 exchanges agreeing
  }

  /**
   * Create consensus signal from agreeing positions
   */
  private static createConsensusSignal(
    pair: string,
    direction: 'LONG' | 'SHORT',
    positions: MasterTraderPosition[]
  ): ConsensusSignal | null {
    if (positions.length === 0) return null;

    const exchanges = [...new Set(positions.map(p => p.exchange))];
    const avgPrice = positions.reduce((sum, p) => sum + p.entryPrice, 0) / positions.length;
    const totalVolume = positions.reduce((sum, p) => sum + p.quantity, 0);
    const consensusStrength = exchanges.length;

    // Calculate confidence based on consensus strength and recency
    let confidence = 50;
    confidence += (consensusStrength - 2) * 15; // +15 per extra exchange
    confidence += positions.length > 5 ? 10 : 0; // Bonus for many traders

    return {
      pair: pair as 'BTCUSDT' | 'ETHUSDT',
      direction,
      consensusStrength,
      avgEntryPrice: avgPrice,
      totalVolume,
      exchanges,
      timestamp: new Date(),
      confidence: Math.min(100, confidence)
    };
  }


  /**
   * Calculate support and resistance levels from candles
   */
  private static calculateSupportResistance(candles: any[]): SupportResistance {
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    // Find swing points (simplified)
    const swingHighs: number[] = [];
    const swingLows: number[] = [];

    for (let i = 2; i < candles.length - 2; i++) {
      const current = candles[i];
      const prev2 = candles[i - 2];
      const prev1 = candles[i - 1];
      const next1 = candles[i + 1];
      const next2 = candles[i + 2];

      // Swing high
      if (current.high > prev2.high && current.high > prev1.high &&
          current.high > next1.high && current.high > next2.high) {
        swingHighs.push(current.high);
      }

      // Swing low
      if (current.low < prev2.low && current.low < prev1.low &&
          current.low < next1.low && current.low < next2.low) {
        swingLows.push(current.low);
      }
    }

    const lastSwingHigh = swingHighs.length > 0 ? Math.max(...swingHighs.slice(-3)) : candles[0].high * 1.05;
    const lastSwingLow = swingLows.length > 0 ? Math.min(...swingLows.slice(-3)) : candles[0].low * 0.95;

    return {
      support: lastSwingLow,
      resistance: lastSwingHigh,
      lastSwingLow,
      lastSwingHigh
    };
  }

  /**
   * Calculate optimal entry price based on consensus and S/R
   */
  private static calculateEntryPrice(
    signal: ConsensusSignal,
    sr: SupportResistance,
    latestCandle: any
  ): number {
    const currentPrice = latestCandle.close;

    if (signal.direction === 'LONG') {
      // Enter near support or on pullback
      const idealEntry = Math.min(sr.support * 1.002, currentPrice * 0.998);
      return Math.max(idealEntry, sr.support * 0.995); // Ensure entry is valid
    } else {
      // Enter near resistance or on pullback
      const idealEntry = Math.max(sr.resistance * 0.998, currentPrice * 1.002);
      return Math.min(idealEntry, sr.resistance * 1.005); // Ensure entry is valid
    }
  }

  /**
   * Calculate stop loss and take profit based on S/R and market structure
   */
  private static calculateStopLossTakeProfit(
    direction: 'LONG' | 'SHORT',
    entryPrice: number,
    sr: SupportResistance,
    candles: any[]
  ): { stopLoss: number; takeProfit: number } {
    const atr = this.calculateATR(candles, 14);

    if (direction === 'LONG') {
      const stopLoss = Math.min(sr.lastSwingLow * 0.995, entryPrice - atr);
      const takeProfit = Math.max(sr.resistance * 0.998, entryPrice + (3 * atr));
      return { stopLoss, takeProfit };
    } else {
      const stopLoss = Math.max(sr.lastSwingHigh * 1.005, entryPrice + atr);
      const takeProfit = Math.min(sr.support * 1.002, entryPrice - (3 * atr));
      return { stopLoss, takeProfit };
    }
  }

  /**
   * Calculate ATR for risk management
   */
  private static calculateATR(candles: any[], period: number): number {
    if (candles.length < period + 1) return 0;

    const trueRanges: number[] = [];
    for (let i = 1; i < Math.min(candles.length, period + 1); i++) {
      const current = candles[i];
      const previous = candles[i - 1];
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      );
      trueRanges.push(tr);
    }

    return trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;
  }

  /**
   * Get user consensus signals (for UI display)
   */
  static async getUserSignals(uid: string, limit: number = 50): Promise<any[]> {
    try {
      const db = getFirebaseAdmin().firestore();
      const signalsQuery = db.collection('users').doc(uid).collection('crowdConsensusTrades')
        .orderBy('executedAt', 'desc')
        .limit(limit);

      const snapshot = await signalsQuery.get();
      const signals = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().executedAt
      }));

      logger.info({ uid, signalCount: signals.length }, 'Retrieved user consensus signals');
      return signals;
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to get user consensus signals');
      return [];
    }
  }

  /**
   * Get user executed trades (for UI display)
   */
  static async getUserTrades(uid: string, limit: number = 50): Promise<any[]> {
    try {
      const db = getFirebaseAdmin().firestore();
      const tradesQuery = db.collection('users').doc(uid).collection('crowdConsensusTrades')
        .where('status', 'in', ['EXECUTED', 'OPEN', 'WIN', 'LOSS'])
        .orderBy('executedAt', 'desc')
        .limit(limit);

      const snapshot = await tradesQuery.get();
      const trades = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      logger.info({ uid, tradeCount: trades.length }, 'Retrieved user executed trades');
      return trades;
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to get user executed trades');
      return [];
    }
  }

  /**
   * Save executed consensus trade
   */
  static async saveConsensusTrade(uid: string, trade: CrowdConsensusTrade): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const tradeRef = db.collection('users').doc(uid).collection('crowdConsensusTrades').doc(trade.id);

      await tradeRef.set(trade);
      logger.info({ uid, tradeId: trade.id }, 'Saved consensus trade');
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to save consensus trade');
    }
  }

  /**
   * Get user settings
   */
  static async getUserSettings(uid: string): Promise<any> {
    try {
      const db = getFirebaseAdmin().firestore();
      const settingsDoc = await db.collection('users').doc(uid)
        .collection('agents').doc('crowd_consensus_copy_trade').get();

      if (settingsDoc.exists) {
        return settingsDoc.data();
      }

      // Return default settings
      return {
        autoTradeEnabled: false,
        selectedAutoTradeExchange: '',
        riskPercent: 4, // Updated default
        stopLossPercent: 2,
        takeProfitPercent: 6, // For 1:3 RR
        leverage: 8, // Updated default
        maxDailyLossPercent: 5,
        dryRun: false, // Safety mode
        lastUpdated: null
      };
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to get user settings');
      return {
        autoTradeEnabled: false,
        selectedAutoTradeExchange: '',
        riskPercent: 4,
        stopLossPercent: 2,
        takeProfitPercent: 6,
        leverage: 8,
        maxDailyLossPercent: 5,
        dryRun: false,
        lastUpdated: null
      };
    }
  }

  /**
   * Save user settings (legacy compatibility)
   */
  static async saveUserSettings(uid: string, settings: any): Promise<void> {
    // No-op for simplified implementation
    logger.info({ uid }, 'Crowd consensus settings saved (no-op)');
  }

  /**
   * Get daily trade count for user
   */
  static async getDailyTradeCount(uid: string): Promise<number> {
    try {
      const db = getFirebaseAdmin().firestore();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tradesQuery = db.collection('users').doc(uid).collection('crowdConsensusTrades')
        .where('executedAt', '>=', today)
        .where('status', '==', 'EXECUTED');

      const snapshot = await tradesQuery.get();
      return snapshot.size;
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to get daily trade count');
      return 0;
    }
  }

  /**
   * Set auto trade enabled/disabled for user
   */
  static async setAutoTradeEnabled(uid: string, enabled: boolean): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const userAgentRef = db.collection('users').doc(uid).collection('agents').doc('crowd_consensus_copy_trade');

      await userAgentRef.set({
        autoTradeEnabled: enabled,
        lastUpdated: new Date()
      }, { merge: true });

      logger.info({ uid, enabled }, 'Crowd consensus auto trade status updated');
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to set auto trade enabled status');
      throw error;
    }
  }

  /**
   * Get exchange connection status from user settings
   */
  static async getExchangeConnectionStatus(uid: string): Promise<{ connected: boolean; exchange?: string; message?: string }> {
    try {
      const db = getFirebaseAdmin().firestore();

      // Check user's exchange config from Settings
      const exchangeConfigRef = db.collection('users').doc(uid).collection('exchangeConfig').doc('current');
      const exchangeConfigDoc = await exchangeConfigRef.get();

      if (!exchangeConfigDoc.exists) {
        return {
          connected: false,
          message: 'No exchange connection found. Please connect an exchange in Settings.'
        };
      }

      const config = exchangeConfigDoc.data();
      if (!config) {
        return {
          connected: false,
          message: 'No exchange connection found. Please connect an exchange in Settings.'
        };
      }

      // Check if exchange config has required fields
      const exchangeName = (config.exchange || config.exchangeName || config.providerName || '').toLowerCase();
      const hasApiKey = Boolean(config.apiKeyEncrypted);
      const hasSecret = Boolean(config.secretEncrypted ?? config.secretKeyEncrypted);
      const isBitget = exchangeName === 'bitget';
      const hasPassphrase = isBitget ? Boolean(config.passphraseEncrypted) : true;

      const connected = Boolean(exchangeName && hasApiKey && hasSecret && hasPassphrase);

      if (connected) {
        return {
          connected: true,
          exchange: exchangeName,
          message: `Connected to ${exchangeName}`
        };
      } else {
        return {
          connected: false,
          message: 'Exchange connection incomplete. Please complete exchange setup in Settings.'
        };
      }
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to get exchange connection status');
      return {
        connected: false,
        message: 'Error checking exchange connection status.'
      };
    }
  }

  /**
   * Get skipped/rejected trades for user
   */
  static async getSkippedTrades(uid: string, limit: number = 50): Promise<any[]> {
    try {
      const db = getFirebaseAdmin().firestore();
      const skippedTradesQuery = db.collection('users').doc(uid).collection('crowdConsensusSkippedTrades')
        .orderBy('timestamp', 'desc')
        .limit(limit);

      const snapshot = await skippedTradesQuery.get();
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to get skipped trades');
      return [];
    }
  }

  /**
   * Save skipped/rejected trade with comprehensive diagnostics
   */
  static async saveSkippedTrade(uid: string, skippedTrade: {
    pair: 'BTCUSDT' | 'ETHUSDT';
    direction: 'LONG' | 'SHORT';
    reason: 'NO_CONSENSUS' | 'RR_TOO_LOW' | 'ENTRY_LATE' | 'SR_BLOCKED' | 'DAILY_LIMIT_REACHED' | 'EXCHANGE_ERROR';
    timestamp: Date;
    details?: any;
  }): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const skippedTradeRef = db.collection('users').doc(uid).collection('crowdConsensusSkippedTrades').doc();

      // Store comprehensive diagnostic data
      const diagnosticRecord = {
        id: skippedTradeRef.id,
        timestamp: skippedTrade.timestamp,
        pair: skippedTrade.pair,
        direction: skippedTrade.direction,
        reason: skippedTrade.reason,

        // Market data snapshot
        marketSnapshot: {
          pair: skippedTrade.pair,
          direction: skippedTrade.direction,
          timestamp: skippedTrade.timestamp
        },

        // Consensus detection data
        consensusSnapshot: skippedTrade.details?.consensusData ? {
          exchanges: skippedTrade.details.consensusData.exchanges,
          strength: skippedTrade.details.consensusData.strength,
          avgEntryPrice: skippedTrade.details.consensusData.avgEntryPrice
        } : null,

        // Validation results
        validationSnapshot: skippedTrade.details?.validation ? {
          entryPrice: skippedTrade.details.validation.entryPrice,
          stopLoss: skippedTrade.details.validation.stopLoss,
          takeProfit: skippedTrade.details.validation.takeProfit,
          rrRatio: skippedTrade.details.validation.rrRatio,
          priceDeviation: skippedTrade.details.validation.priceDeviation
        } : null,

        // Support & Resistance analysis
        srSnapshot: skippedTrade.details?.srAnalysis ? {
          support: skippedTrade.details.srAnalysis.support,
          resistance: skippedTrade.details.srAnalysis.resistance,
          tpBlocked: skippedTrade.details.srAnalysis.tpBlocked,
          reason: skippedTrade.details.srAnalysis.reason
        } : null,

        // Risk analysis
        riskSnapshot: skippedTrade.details?.riskAnalysis ? {
          accountBalance: skippedTrade.details.riskAnalysis.accountBalance,
          riskPercent: skippedTrade.details.riskAnalysis.riskPercent,
          positionSize: skippedTrade.details.riskAnalysis.positionSize,
          marginRequired: skippedTrade.details.riskAnalysis.marginRequired,
          liquidationRisk: skippedTrade.details.riskAnalysis.liquidationRisk
        } : null,

        // Exchange execution attempt
        executionAttempt: skippedTrade.details?.executionAttempt ? {
          attempted: skippedTrade.details.executionAttempt.attempted,
          exchange: skippedTrade.details.executionAttempt.exchange,
          error: skippedTrade.details.executionAttempt.error
        } : null
      };

      await skippedTradeRef.set(diagnosticRecord);

      logger.info({
        uid,
        reason: skippedTrade.reason,
        pair: skippedTrade.pair,
        tradeId: skippedTradeRef.id
      }, 'Saved comprehensive skipped trade diagnostics');
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to save skipped trade diagnostics');
    }
  }

  /**
   * Validate trade setup including S/R analysis and RR ratio
   */
  static async validateTradeSetup(signal: ConsensusSignal): Promise<{
    valid: boolean;
    reason?: string;
    entryPrice?: number;
    stopLoss?: number;
    takeProfit?: number;
    rrRatio?: number;
  }> {
    try {
      // Get market data for S/R calculation
      const candles = await this.getMarketData(signal.pair);
      if (candles.length < 50) {
        return { valid: false, reason: 'INSUFFICIENT_MARKET_DATA' };
      }

      // Calculate S/R levels
      const sr = this.calculateSupportResistance(candles);

      // Calculate entry price based on consensus and S/R
      const entryPrice = this.calculateEntryPrice(signal, sr, candles[0]);

      // Calculate stop loss and take profit
      const { stopLoss, takeProfit } = this.calculateStopLossTakeProfit(
        signal.direction,
        entryPrice,
        sr,
        candles
      );

      // Validate S/R blocking
      if (signal.direction === 'LONG' && takeProfit <= sr.resistance) {
        return { valid: false, reason: 'SR_BLOCKED' };
      }
      if (signal.direction === 'SHORT' && takeProfit >= sr.support) {
        return { valid: false, reason: 'SR_BLOCKED' };
      }

      // Calculate RR ratio
      const riskAmount = Math.abs(entryPrice - stopLoss);
      const rewardAmount = Math.abs(takeProfit - entryPrice);
      const rrRatio = rewardAmount / riskAmount;

      // Validate RR ratio (must be at least 1:3)
      if (rrRatio < 3) {
        return {
          valid: false,
          reason: 'RR_TOO_LOW',
          entryPrice,
          stopLoss,
          takeProfit,
          rrRatio
        };
      }

      // Check if entry is too late (price moved too far from consensus)
      const currentPrice = candles[0].close;
      const priceDiff = Math.abs(currentPrice - signal.avgEntryPrice) / signal.avgEntryPrice;
      if (priceDiff > 0.02) { // 2% deviation max
        return { valid: false, reason: 'ENTRY_LATE' };
      }

      return {
        valid: true,
        entryPrice,
        stopLoss,
        takeProfit,
        rrRatio
      };

    } catch (error: any) {
      logger.error({
        pair: signal.pair,
        direction: signal.direction,
        error: error.message
      }, 'Failed to validate trade setup');
      return { valid: false, reason: 'VALIDATION_ERROR' };
    }
  }

  /**
   * Get market data for S/R calculation
   */
  private static async getMarketData(pair: string): Promise<any[]> {
    try {
      // In production, this would fetch from a market data provider
      // For now, simulate realistic candle data
      const candles = [];
      const basePrice = pair === 'BTCUSDT' ? 45000 : 2500;
      let currentPrice = basePrice + (Math.random() - 0.5) * 2000;

      // Generate 100 candles (5-minute intervals)
      for (let i = 0; i < 100; i++) {
        const volatility = 0.005; // 0.5% volatility
        const open = currentPrice;
        const close = open + (Math.random() - 0.5) * 2 * volatility * open;
        const high = Math.max(open, close) + Math.random() * volatility * open;
        const low = Math.min(open, close) - Math.random() * volatility * open;
        const volume = Math.random() * 1000 + 500;

        candles.unshift({ // Add to beginning for chronological order (oldest first)
          timestamp: Date.now() - (100 - i) * 5 * 60 * 1000,
          open,
          high,
          low,
          close,
          volume
        });

        currentPrice = close;
      }

      return candles;
    } catch (error: any) {
      logger.error({ pair, error: error.message }, 'Failed to get market data');
      return [];
    }
  }

  /**
   * Execute consensus trade for a user
   */
  static async executeConsensusTrade(
    signal: ConsensusSignal,
    uid: string
  ): Promise<{ success: boolean; reason?: string; tradeId?: string; trade?: CrowdConsensusTrade }> {
    try {
      // Generate consensus ID for idempotency
      const consensusId = this.generateConsensusId(signal);

      // Create trade record early for consistent ID usage
      const trade: CrowdConsensusTrade = {
        id: `cc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        consensusId,
        pair: signal.pair,
        direction: signal.direction,
        entryPrice: 0, // Will be set later
        stopLoss: 0, // Will be set later
        takeProfit: 0, // Will be set later
        rrRatio: 0, // Will be set later
        status: 'PENDING',
        executedAt: new Date()
      };

      // Check if this consensus was already executed
      const existingTrade = await this.checkConsensusIdempotency(uid, consensusId);
      if (existingTrade) {
        logger.info({
          uid,
          consensusId,
          existingTradeId: existingTrade.id
        }, 'Consensus already executed - skipping duplicate');

        return {
          success: false,
          reason: 'DUPLICATE_CONSENSUS',
          tradeId: existingTrade.id
        };
      }
      // Validate trade setup first
      const validation = await this.validateTradeSetup(signal);
      if (!validation.valid) {
        return { success: false, reason: validation.reason };
      }

      // Get user's exchange connection
      const exchangeStatus = await this.getExchangeConnectionStatus(uid);
      if (!exchangeStatus.connected) {
        return { success: false, reason: 'EXCHANGE_NOT_CONNECTED' };
      }

      // Get user's exchange credentials
      const credentials = await this.getUserExchangeCredentials(uid, exchangeStatus.exchange!);
      if (!credentials) {
        return { success: false, reason: 'EXCHANGE_CREDENTIALS_MISSING' };
      }

      // Check daily trade limit
      const dailyTradeCount = await this.getDailyTradeCount(uid);
      if (dailyTradeCount >= 6) {
        return { success: false, reason: 'DAILY_LIMIT_REACHED' };
      }

      // Calculate position size
      const positionSize = await this.calculatePositionSize(
        uid,
        signal,
        validation.entryPrice!,
        validation.stopLoss!
      );

      if (positionSize <= 0) {
        return { success: false, reason: 'INVALID_POSITION_SIZE' };
      }

      // Check for DRY RUN mode
      const settings = await this.getUserSettings(uid);
      if (settings.dryRun) {
        logger.info({
          uid,
          tradeId: trade.id,
          pair: signal.pair,
          direction: signal.direction,
          entryPrice: validation.entryPrice,
          quantity: positionSize,
          dryRun: true
        }, 'DRY RUN: Consensus trade simulated (not executed)');

        // Update trade status to SIMULATED
        trade.status = 'SIMULATED';
        await this.saveConsensusTrade(uid, trade);

        return { success: true, tradeId: trade.id, trade };
      }

      // Execute bracket order
      const orderResult = await this.executeBracketOrder(
        exchangeStatus.exchange!,
        credentials,
        {
          pair: signal.pair,
          direction: signal.direction,
          entryPrice: validation.entryPrice!,
          stopLoss: validation.stopLoss!,
          takeProfit: validation.takeProfit!,
          quantity: positionSize
        }
      );

      if (!orderResult.success) {
        // Normalize exchange errors
        const normalizedError = this.normalizeExchangeError(orderResult.error);
        return { success: false, reason: normalizedError };
      }

      // Update trade with order ID
      trade.orderId = orderResult.orderId;
      await this.saveConsensusTrade(uid, trade);

      // Update trade record with execution details
      trade.entryPrice = validation.entryPrice!;
      trade.stopLoss = validation.stopLoss!;
      trade.takeProfit = validation.takeProfit!;
      trade.quantity = positionSize;
      trade.leverage = 8; // Fixed leverage for Crowd Consensus
      trade.riskAmount = positionSize * Math.abs(validation.entryPrice! - validation.stopLoss!);
      trade.rrRatio = validation.rrRatio!;
      trade.executedAt = new Date();
      trade.status = 'EXECUTED';

      // Save trade
      await this.saveConsensusTrade(uid, trade);

      logger.info({
        uid,
        tradeId: trade.id,
        pair: signal.pair,
        direction: signal.direction,
        entryPrice: validation.entryPrice,
        quantity: positionSize
      }, 'Consensus trade executed successfully');

      return { success: true, tradeId: trade.id, trade };

    } catch (error: any) {
      logger.error({
        uid,
        pair: signal.pair,
        direction: signal.direction,
        error: error.message
      }, 'Failed to execute consensus trade');
      return { success: false, reason: 'EXECUTION_ERROR' };
    }
  }

  /**
   * Get user's exchange credentials
   */
  private static async getUserExchangeCredentials(uid: string, exchange: string): Promise<any> {
    try {
      const db = getFirebaseAdmin().firestore();
      const integrationsRef = db.collection('users').doc(uid).collection('integrations');
      const snapshot = await integrationsRef.where('exchange', '==', exchange).get();

      if (snapshot.empty) {
        return null;
      }

      const integration = snapshot.docs[0].data();
      return {
        apiKey: integration.apiKey,
        secret: integration.secret,
        passphrase: integration.passphrase
      };
    } catch (error: any) {
      logger.error({ uid, exchange, error: error.message }, 'Failed to get exchange credentials');
      return null;
    }
  }

  /**
   * Calculate position size based on risk management
   */
  private static async calculatePositionSize(
    uid: string,
    signal: ConsensusSignal,
    entryPrice: number,
    stopLoss: number
  ): Promise<number> {
    try {
      // Get user's balance (simplified - in production would fetch from exchange)
      const balance = await this.getUserBalance(uid);
      if (balance <= 0) {
        return 0;
      }

      // Risk 1% of balance per trade
      const riskAmount = balance * 0.01;
      const riskPerUnit = Math.abs(entryPrice - stopLoss);

      // Calculate max position size
      const maxUnits = riskAmount / riskPerUnit;

      // Cap at 10% of consensus volume
      const consensusBasedSize = signal.totalVolume * 0.1;

      // Use the smaller of the two
      const positionSize = Math.min(maxUnits, consensusBasedSize);

      // Minimum position size check
      return Math.max(positionSize, 0.001);
    } catch (error: any) {
      logger.error({ uid, error: error.message }, 'Failed to calculate position size');
      return 0;
    }
  }

  /**
   * Get user's balance (simplified)
   */
  private static async getUserBalance(uid: string): Promise<number> {
    // In production, this would fetch from the connected exchange
    // For now, simulate a balance
    return 1000 + Math.random() * 9000; // $1000-$10000
  }

  /**
   * Execute bracket order on Bitget Futures
   */
  private static async executeBracketOrder(
    exchange: string,
    credentials: any,
    order: {
      pair: string;
      direction: 'LONG' | 'SHORT';
      entryPrice: number;
      stopLoss: number;
      takeProfit: number;
      quantity: number;
    }
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    try {
      // Only support Bitget for now
      if (exchange !== 'bitget') {
        return { success: false, error: 'EXCHANGE_NOT_SUPPORTED' };
      }

      // Create Bitget adapter
      const { BitgetAdapter } = await import('./bitgetAdapter');
      const bitgetAdapter = new BitgetAdapter(
        credentials.apiKey,
        credentials.secret,
        credentials.passphrase,
        false // Never use testnet
      );

      // Execute bracket order
      const result = await bitgetAdapter.placeCoinMBracketOrder({
        symbol: order.pair,
        side: order.direction === 'LONG' ? 'BUY' : 'SELL',
        quantity: order.quantity,
        entryPrice: order.entryPrice,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        leverage: 8 // Fixed leverage for Crowd Consensus
      });

      logger.info({
        exchange,
        pair: order.pair,
        direction: order.direction,
        orderId: result.orderId,
        quantity: order.quantity
      }, 'Crowd Consensus bracket order executed on Bitget');

      return { success: true, orderId: result.orderId };

    } catch (error: any) {
      const normalizedError = this.normalizeExchangeError(error.message || error);

      logger.error({
        exchange,
        pair: order.pair,
        direction: order.direction,
        error: error.message,
        normalizedError
      }, 'Crowd Consensus bracket order execution failed');

      return { success: false, error: normalizedError };
    }
  }

  /**
   * Generate consensus ID for idempotency checking
   */
  private static generateConsensusId(signal: ConsensusSignal): string {
    // Round timestamp to nearest 5-minute interval for grouping
    const roundedTimestamp = Math.floor(signal.timestamp.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000);

    const consensusData = `${signal.pair}_${signal.direction}_${roundedTimestamp}_${signal.consensusStrength}`;
    // Simple hash for deterministic ID
    let hash = 0;
    for (let i = 0; i < consensusData.length; i++) {
      const char = consensusData.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `consensus_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Check if consensus was already executed (idempotency)
   */
  private static async checkConsensusIdempotency(uid: string, consensusId: string): Promise<CrowdConsensusTrade | null> {
    try {
      const db = getFirebaseAdmin().firestore();
      const tradesQuery = db.collection('users').doc(uid).collection('crowdConsensusTrades')
        .where('consensusId', '==', consensusId)
        .where('status', 'in', ['EXECUTED', 'SIMULATED'])
        .limit(1);

      const snapshot = await tradesQuery.get();
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        return {
          id: doc.id,
          ...doc.data()
        } as CrowdConsensusTrade;
      }

      return null;
    } catch (error) {
      logger.error({
        uid,
        consensusId,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to check consensus idempotency');
      return null;
    }
  }

  /**
   * Normalize exchange errors to standard codes
   */
  private static normalizeExchangeError(error?: string): string {
    if (!error) return 'EXECUTION_ERROR';

    const errorMap: { [key: string]: string } = {
      'insufficient_balance': 'INSUFFICIENT_MARGIN',
      'margin_not_enough': 'INSUFFICIENT_MARGIN',
      'balance_not_enough': 'INSUFFICIENT_MARGIN',
      'invalid_price': 'INVALID_PRICE',
      'price_too_high': 'INVALID_PRICE',
      'price_too_low': 'INVALID_PRICE',
      'rate_limit': 'RATE_LIMIT',
      'too_many_requests': 'RATE_LIMIT',
      'order_rejected': 'EXCHANGE_REJECTED',
      'invalid_order': 'EXCHANGE_REJECTED'
    };

    return errorMap[error.toLowerCase()] || 'EXCHANGE_REJECTED';
  }

  /**
   * Save user signal (legacy method for compatibility)
   */
  static async saveUserSignal(uid: string, signal: any): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const signalRef = db.collection('users').doc(uid).collection('crowdConsensusSignals').doc(signal.id);

      await signalRef.set(signal);
      logger.info({ uid, signalId: signal.id }, 'Saved user signal');
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to save user signal');
    }
  }
}