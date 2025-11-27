import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { BinanceAdapter } from './binanceAdapter';
import { decrypt } from './keyManager';
import { getFirebaseAdmin } from '../utils/firebase';
// Dynamic import for binancePublicAdapter to avoid module resolution issues
import { CryptoCompareAdapter } from './cryptocompareAdapter';
import { fetchNewsData } from './newsDataAdapter';
import { fetchCoinMarketCapMarketData } from './coinMarketCapAdapter';
import { tradingStrategies, OHLCData } from './tradingStrategies';
import * as admin from 'firebase-admin';

export interface AutoTradeConfig {
  autoTradeEnabled: boolean;
  perTradeRiskPct: number; // percent of account equity per trade (default 1)
  maxConcurrentTrades: number; // default 3
  maxDailyLossPct: number; // stop trading if loss exceeds (default 5)
  stopLossPct: number; // default 1.5
  takeProfitPct: number; // default 3
  manualOverride: boolean; // when true, engine pauses for user actions
  mode: 'AUTO' | 'MANUAL';
  lastRun?: Date;
  stats?: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalPnL: number;
    dailyPnL: number;
    dailyTrades: number;
  };
  equitySnapshot?: number;
}

export interface TradeSignal {
  symbol: string;
  signal: 'BUY' | 'SELL';
  entryPrice: number;
  accuracy: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
  requestId: string;
  timestamp: Date;
}

export interface TradeExecution {
  tradeId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  status: 'PENDING' | 'FILLED' | 'CANCELLED' | 'REJECTED';
  orderId?: string;
  fillPrice?: number;
  pnl?: number;
  timestamp: Date;
  mode: 'AUTO' | 'MANUAL';
}

export interface MarketData {
  symbol: string;
  price: number;
  volume24h: number;
  change24h: number;
  high24h: number;
  low24h: number;
  open24h: number;
  marketCap?: number;
  liquidity?: number;
  ohlc?: OHLCData[];
  orderbook?: {
    bids: Array<{price: number, quantity: number}>;
    asks: Array<{price: number, quantity: number}>;
  };
}

export interface StrategySignal {
  name: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number; // 0-100
  weight: number; // Strategy weight in master signal
}

export interface MasterSignal {
  symbol: string;
  direction: 'BUY' | 'SELL' | 'HOLD';
  accuracy: number; // 0-100, overall accuracy score
  strategySignals: StrategySignal[];
  masterScore: number; // Weighted average of all signals
  agreementCount: number; // How many strategies agree
  requiredAgreement: number; // Minimum required agreement
  marketData: MarketData;
  timestamp: Date;
}

const DEFAULT_CONFIG: AutoTradeConfig = {
  autoTradeEnabled: false,
  perTradeRiskPct: 1, // 1% of equity per trade
  maxConcurrentTrades: 3,
  maxDailyLossPct: 5, // 5% max daily loss
  stopLossPct: 1.5, // 1.5% stop loss
  takeProfitPct: 3, // 3% take profit
  manualOverride: false,
  mode: 'MANUAL', // Start in manual mode for safety
  stats: {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    totalPnL: 0,
    dailyPnL: 0,
    dailyTrades: 0,
  },
};

export class AutoTradeEngine {
  private userEngines: Map<string, {
    config: AutoTradeConfig;
    adapter: BinanceAdapter | null;
    activeTrades: Map<string, TradeExecution>;
    circuitBreaker: boolean;
    lastEquityCheck: Date;
  }> = new Map();

  /**
   * Aggregate market data from all providers
   */
  async aggregateMarketData(symbol: string, uid: string): Promise<MarketData> {
    const startTime = Date.now();
    logger.info({ symbol, uid }, 'Starting market data aggregation');

    const integrations = await firestoreAdapter.getEnabledIntegrations(uid);

    // Fetch data from all providers in parallel
    const BinancePublicAdapterClass = (await import('./binancepublicAdapter')).default;
    const binanceAdapter = new BinancePublicAdapterClass();
    const [binanceData, cryptocompareData, newsData, cmcData, ohlcData, orderbookData] = await Promise.allSettled([
      binanceAdapter.getPublicMarketData(symbol),
      integrations.cryptocompare ? new CryptoCompareAdapter(integrations.cryptocompare.apiKey).getMarketData(symbol) : Promise.resolve(null),
      fetchNewsData(integrations.newsdata?.apiKey, symbol),
      fetchCoinMarketCapMarketData(symbol, integrations.coinmarketcap?.apiKey),
      binanceAdapter.getOHLCData(symbol),
      binanceAdapter.getOrderbook(symbol)
    ]);

    // Extract successful results
    const binance = binanceData.status === 'fulfilled' ? binanceData.value : null;
    const cc = cryptocompareData.status === 'fulfilled' ? cryptocompareData.value : null;
    const news = newsData.status === 'fulfilled' ? newsData.value : null;
    const cmc = cmcData.status === 'fulfilled' ? cmcData.value : null;
    const ohlc = ohlcData.status === 'fulfilled' ? ohlcData.value : null;
    const orderbook = orderbookData.status === 'fulfilled' ? orderbookData.value : null;

    // Consolidate price data with priority: Binance > CryptoCompare > CMC
    let price = 0;
    let volume24h = 0;
    let change24h = 0;
    let high24h = 0;
    let low24h = 0;
    let open24h = 0;
    let marketCap = 0;
    let liquidity = 0;

    if (binance?.success) {
      price = binance.price;
      volume24h = binance.volume24h;
      change24h = binance.priceChangePercent24h;
      high24h = binance.high24h;
      low24h = binance.low24h;
      open24h = binance.open24h;
    } else if (cc?.success) {
      price = cc.price;
      volume24h = cc.volume24h;
      change24h = cc.priceChangePercent24h;
      high24h = cc.high;
      low24h = cc.low;
      open24h = cc.open;
    } else if (cmc?.success) {
      price = cmc.marketData.price;
      volume24h = cmc.marketData.volume24h;
      change24h = cmc.marketData.priceChangePercent24h;
      marketCap = cmc.marketCap;
      liquidity = cmc.liquidity;
    }

    const marketData: MarketData = {
      symbol,
      price,
      volume24h,
      change24h,
      high24h,
      low24h,
      open24h,
      marketCap,
      liquidity,
      ohlc: ohlc?.success ? ohlc.ohlc : [],
      orderbook: orderbook?.success ? orderbook : undefined
    };

    logger.info({
      symbol,
      uid,
      price,
      providers: {
        binance: !!binance?.success,
        cryptocompare: !!cc?.success,
        newsdata: !!news?.success,
        coinmarketcap: !!cmc?.success,
        ohlc: !!ohlc?.success,
        orderbook: !!orderbook?.success
      },
      latency: Date.now() - startTime
    }, 'Market data aggregation completed');

    return marketData;
  }

  /**
   * Compute individual strategy signals
   */
  async computeStrategySignals(marketData: MarketData, uid: string): Promise<StrategySignal[]> {
    const signals: StrategySignal[] = [];
    const ohlcData = marketData.ohlc || [];

    if (ohlcData.length === 0) {
      logger.warn({ symbol: marketData.symbol }, 'No OHLC data available for strategy computation');
      return signals;
    }

    // 1. Trend Strategy (EMA/SMA) - Weight: 20%
    try {
      const emaTrend = tradingStrategies.calculateEMATrend(ohlcData);
      const smaTrend = tradingStrategies.calculateSMATrend(ohlcData);

      let trendSignal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
      let trendConfidence = 50;

      if (emaTrend.emaTrend === 'bullish' && smaTrend.smaTrend === 'bullish') {
        trendSignal = 'BUY';
        trendConfidence = 80;
      } else if (emaTrend.emaTrend === 'bearish' && smaTrend.smaTrend === 'bearish') {
        trendSignal = 'SELL';
        trendConfidence = 80;
      } else if (emaTrend.emaTrend !== smaTrend.smaTrend) {
        trendConfidence = 60; // Mixed signals
      }

      signals.push({
        name: 'trend',
        signal: trendSignal,
        confidence: trendConfidence,
        weight: 20
      });
    } catch (error) {
      logger.debug({ error: error.message, strategy: 'trend' }, 'Trend strategy calculation failed');
    }

    // 2. Volume Spike Strategy - Weight: 20%
    try {
      const volumeAnalysis = tradingStrategies.calculateVolumeAnalysis(ohlcData);

      let volumeSignal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
      let volumeConfidence = volumeAnalysis.score * 100;

      if (volumeAnalysis.score > 0.7) {
        volumeSignal = marketData.change24h > 0 ? 'BUY' : 'SELL';
      }

      signals.push({
        name: 'volume',
        signal: volumeSignal,
        confidence: volumeConfidence,
        weight: 20
      });
    } catch (error) {
      logger.debug({ error: error.message, strategy: 'volume' }, 'Volume strategy calculation failed');
    }

    // 3. Momentum Strategy - Weight: 20%
    try {
      const momentum = tradingStrategies.calculateMomentum(ohlcData);

      let momentumSignal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
      let momentumConfidence = momentum.score * 100;

      if (momentum.score > 0.6) {
        momentumSignal = momentum.direction === 'up' ? 'BUY' : 'SELL';
      }

      signals.push({
        name: 'momentum',
        signal: momentumSignal,
        confidence: momentumConfidence,
        weight: 20
      });
    } catch (error) {
      logger.debug({ error: error.message, strategy: 'momentum' }, 'Momentum strategy calculation failed');
    }

    // 4. Volatility Strategy (ATR) - Weight: 10%
    try {
      const volatility = tradingStrategies.calculateVolatility(ohlcData);

      let volatilitySignal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
      let volatilityConfidence = 50;

      // Lower volatility = more stable = potential breakout
      if (volatility.classification === 'low') {
        volatilitySignal = 'HOLD'; // Wait for breakout
        volatilityConfidence = 70;
      } else if (volatility.classification === 'high') {
        volatilitySignal = 'HOLD'; // Too volatile, avoid
        volatilityConfidence = 30;
      }

      signals.push({
        name: 'volatility',
        signal: volatilitySignal,
        confidence: volatilityConfidence,
        weight: 10
      });
    } catch (error) {
      logger.debug({ error: error.message, strategy: 'volatility' }, 'Volatility strategy calculation failed');
    }

    // 5. VWAP Deviation Strategy - Weight: 10%
    try {
      const vwap = tradingStrategies.calculateVWAP(ohlcData);

      let vwapSignal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
      let vwapConfidence = 50;

      if (vwap.signal === 'above') {
        vwapSignal = 'SELL'; // Price above fair value
        vwapConfidence = 65;
      } else if (vwap.signal === 'below') {
        vwapSignal = 'BUY'; // Price below fair value
        vwapConfidence = 65;
      }

      signals.push({
        name: 'vwap',
        signal: vwapSignal,
        confidence: vwapConfidence,
        weight: 10
      });
    } catch (error) {
      logger.debug({ error: error.message, strategy: 'vwap' }, 'VWAP strategy calculation failed');
    }

    // 6. Price Action Strategy - Weight: 10%
    try {
      const priceAction = tradingStrategies.calculatePriceAction(ohlcData);

      signals.push({
        name: 'price_action',
        signal: priceAction.pattern === 'bullish' ? 'BUY' : priceAction.pattern === 'bearish' ? 'SELL' : 'HOLD',
        confidence: priceAction.confidence,
        weight: 10
      });
    } catch (error) {
      logger.debug({ error: error.message, strategy: 'price_action' }, 'Price action strategy calculation failed');
    }

    // 7. Support/Resistance Strength - Weight: 5%
    try {
      const supportResistance = tradingStrategies.calculateSupportResistance(ohlcData);

      let srSignal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
      let srConfidence = 50;

      if (supportResistance.nearSupport && !supportResistance.nearResistance) {
        srSignal = 'BUY'; // Near support, potential bounce
        srConfidence = 70;
      } else if (supportResistance.nearResistance && !supportResistance.nearSupport) {
        srSignal = 'SELL'; // Near resistance, potential rejection
        srConfidence = 70;
      }

      signals.push({
        name: 'support_resistance',
        signal: srSignal,
        confidence: srConfidence,
        weight: 5
      });
    } catch (error) {
      logger.debug({ error: error.message, strategy: 'support_resistance' }, 'Support/resistance strategy calculation failed');
    }

    // 8. News Sentiment Strategy - Weight: 5%
    try {
      const integrations = await firestoreAdapter.getEnabledIntegrations(uid);
      const news = await fetchNewsData(integrations.newsdata?.apiKey, marketData.symbol);

      let newsSignal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
      let newsConfidence = 50;

      if (news.success && news.sentiment !== undefined) {
        if (news.sentiment > 0.6) {
          newsSignal = 'BUY';
          newsConfidence = news.sentiment * 100;
        } else if (news.sentiment < 0.4) {
          newsSignal = 'SELL';
          newsConfidence = (1 - news.sentiment) * 100;
        }
      }

      signals.push({
        name: 'news_sentiment',
        signal: newsSignal,
        confidence: newsConfidence,
        weight: 5
      });
    } catch (error) {
      logger.debug({ error: error.message, strategy: 'news_sentiment' }, 'News sentiment strategy calculation failed');
    }

    logger.info({
      symbol: marketData.symbol,
      signalsCount: signals.length,
      signals: signals.map(s => ({ name: s.name, signal: s.signal, confidence: s.confidence }))
    }, 'Strategy signals computed');

    return signals;
  }

  /**
   * Compute master signal from individual strategy signals
   */
  async computeMasterSignal(symbol: string, uid: string): Promise<MasterSignal> {
    // Aggregate market data
    const marketData = await this.aggregateMarketData(symbol, uid);

    // Compute individual strategy signals
    const strategySignals = await this.computeStrategySignals(marketData, uid);

    // Calculate master score (weighted average)
    let totalWeight = 0;
    let weightedScore = 0;
    let buyVotes = 0;
    let sellVotes = 0;

    for (const signal of strategySignals) {
      totalWeight += signal.weight;
      if (signal.signal === 'BUY') {
        weightedScore += (signal.confidence / 100) * signal.weight;
        buyVotes++;
      } else if (signal.signal === 'SELL') {
        weightedScore -= (signal.confidence / 100) * signal.weight;
        sellVotes++;
      }
    }

    const masterScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
    const agreementCount = Math.max(buyVotes, sellVotes);
    const requiredAgreement = 4; // Need at least 4 out of 8 strategies to agree

    // Determine direction
    let direction: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    if (Math.abs(masterScore) > 0.1 && agreementCount >= requiredAgreement) {
      direction = masterScore > 0 ? 'BUY' : 'SELL';
    }

    // Calculate overall accuracy (0-100)
    // Base accuracy from agreement and market conditions
    let accuracy = 50;

    // Agreement bonus
    if (agreementCount >= requiredAgreement) {
      accuracy += 20;
    }

    // Market cap bonus (larger caps = more reliable signals)
    if (marketData.marketCap && marketData.marketCap > 1000000000) { // > $1B
      accuracy += 10;
    }

    // Volume bonus (higher volume = more reliable)
    if (marketData.volume24h && marketData.volume24h > 100000000) { // > $100M daily volume
      accuracy += 10;
    }

    // Volatility penalty (high volatility = less reliable)
    if (marketData.change24h && Math.abs(marketData.change24h) > 10) {
      accuracy -= 15;
    }

    // Strategy consistency bonus
    const totalSignals = strategySignals.length;
    if (totalSignals > 0) {
      const consistencyRatio = agreementCount / totalSignals;
      accuracy += consistencyRatio * 10;
    }

    accuracy = Math.max(10, Math.min(95, accuracy)); // Cap between 10-95%

    const masterSignal: MasterSignal = {
      symbol,
      direction,
      accuracy,
      strategySignals,
      masterScore,
      agreementCount,
      requiredAgreement,
      marketData,
      timestamp: new Date()
    };

    logger.info({
      symbol,
      direction,
      accuracy,
      masterScore,
      agreementCount,
      requiredAgreement,
      strategySignals: strategySignals.map(s => `${s.name}:${s.signal}(${s.confidence.toFixed(1)}%)`)
    }, 'Master signal computed');

    return masterSignal;
  }

  /**
   * Get or create user engine instance
   */
  private async getUserEngine(uid: string): Promise<{
    config: AutoTradeConfig;
    adapter: BinanceAdapter | null;
    activeTrades: Map<string, TradeExecution>;
    circuitBreaker: boolean;
    lastEquityCheck: Date;
  }> {
    if (!this.userEngines.has(uid)) {
      const config = await this.loadConfig(uid);
      this.userEngines.set(uid, {
        config,
        adapter: null,
        activeTrades: new Map(),
        circuitBreaker: false,
        lastEquityCheck: new Date(0),
      });
    }
    return this.userEngines.get(uid)!;
  }

  /**
   * Load user configuration from Firestore
   */
  async loadConfig(uid: string): Promise<AutoTradeConfig> {
    try {
      const db = getFirebaseAdmin().firestore();
      const configDoc = await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').get();
      
      if (configDoc.exists) {
        const data = configDoc.data()!;
        return {
          ...DEFAULT_CONFIG,
          ...data,
          lastRun: data.lastRun?.toDate(),
          stats: data.stats || DEFAULT_CONFIG.stats,
        } as AutoTradeConfig;
      }
      
      // Create default config if doesn't exist
      await this.saveConfig(uid, DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error loading auto-trade config');
      return DEFAULT_CONFIG;
    }
  }

  /**
   * Save user configuration to Firestore
   */
  async saveConfig(uid: string, config: Partial<AutoTradeConfig>): Promise<AutoTradeConfig> {
    try {
      const db = getFirebaseAdmin().firestore();
      const currentConfig = await this.loadConfig(uid);
      const updatedConfig = { ...currentConfig, ...config, lastRun: new Date() };
      
      // Save to Firestore with all fields
      const configDoc = {
        autoTradeEnabled: updatedConfig.autoTradeEnabled,
        perTradeRiskPct: updatedConfig.perTradeRiskPct,
        maxConcurrentTrades: updatedConfig.maxConcurrentTrades,
        maxDailyLossPct: updatedConfig.maxDailyLossPct,
        stopLossPct: updatedConfig.stopLossPct,
        takeProfitPct: updatedConfig.takeProfitPct,
        manualOverride: updatedConfig.manualOverride,
        mode: updatedConfig.mode,
        stats: updatedConfig.stats || DEFAULT_CONFIG.stats,
        equitySnapshot: updatedConfig.equitySnapshot,
        lastRun: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
      };
      
      await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').set(configDoc, { merge: true });

      logger.info({ uid, config: configDoc }, 'Auto-trade config saved to Firestore');

      // Update in-memory config
      const engine = await this.getUserEngine(uid);
      engine.config = updatedConfig as AutoTradeConfig;
      
      return updatedConfig as AutoTradeConfig;
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack, uid }, 'Error saving auto-trade config');
      throw error;
    }
  }

  /**
   * Initialize adapter for user (load API keys securely using unified resolver)
   * Supports all exchanges: binance, bitget, bingx, weex
   */
  async initializeAdapter(uid: string): Promise<any> {
    try {
      const { resolveExchangeConnector } = await import('./exchangeResolver');
      const resolved = await resolveExchangeConnector(uid);
      
      if (!resolved) {
        logger.warn({ uid }, 'No exchange API credentials found for auto-trade');
        return null;
      }
      
      const { connector, exchange } = resolved;
      
      // Validate connector has required methods
      if (!connector || typeof connector.placeOrder !== 'function') {
        logger.error({ uid, exchange }, 'Exchange connector missing required methods');
        return null;
      }
      
      // For Binance, optionally validate API key permissions
      if (exchange === 'binance' && typeof connector.validateApiKey === 'function') {
        try {
          const validation = await connector.validateApiKey();
          if (!validation.valid || !validation.canTrade) {
            logger.error({ uid, exchange }, 'API key validation failed - insufficient permissions');
            return null;
          }
        } catch (valError: any) {
          logger.warn({ uid, exchange, error: valError.message }, 'API key validation error, continuing anyway');
        }
      }
      
      const engine = await this.getUserEngine(uid);
      engine.adapter = connector;
      
      logger.info({ uid, exchange }, 'Auto-trade adapter initialized successfully');
      return connector;
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack, uid }, 'Error initializing adapter');
      return null;
    }
  }

  /**
   * Calculate support/resistance levels for SL/TP
   */
  calculateSupportResistanceLevels(marketData: MarketData): { support: number; resistance: number } {
    let support = 0;
    let resistance = 0;

    try {
      if (marketData.ohlc && marketData.ohlc.length > 0) {
        // Use support/resistance calculation from trading strategies
        const sr = tradingStrategies.calculateSupportResistance(marketData.ohlc);

        // For simplicity, use recent swing lows/highs as S/R levels
        const recentPrices = marketData.ohlc.slice(-20).map(d => d.low); // Recent lows
        const recentHighs = marketData.ohlc.slice(-20).map(d => d.high); // Recent highs

        support = Math.min(...recentPrices) * 0.995; // 0.5% below recent low
        resistance = Math.max(...recentHighs) * 1.005; // 0.5% above recent high
      }
    } catch (error) {
      logger.debug({ error: error.message }, 'Failed to calculate S/R levels');
    }

    // Fallback to price-based levels if calculation fails
    if (support === 0 || resistance === 0) {
      const currentPrice = marketData.price;
      support = currentPrice * 0.95; // 5% below current price
      resistance = currentPrice * 1.05; // 5% above current price
    }

    return { support, resistance };
  }

  /**
   * Calculate hybrid SL/TP levels (support/resistance primary + % backup)
   */
  calculateHybridSLTP(
    marketData: MarketData,
    direction: 'BUY' | 'SELL',
    accuracy: number
  ): { stopLoss: number; takeProfit: number; atrMultiplier: number } {
    const currentPrice = marketData.price;
    const { support, resistance } = this.calculateSupportResistanceLevels(marketData);

    // Calculate ATR for dynamic adjustment
    let atrMultiplier = 1.5; // Default
    try {
      if (marketData.ohlc && marketData.ohlc.length > 0) {
        const volatility = tradingStrategies.calculateVolatility(marketData.ohlc);
        const atrPct = volatility.atrPct || 0;
        if (atrPct > 0) {
          atrMultiplier = Math.min(3, Math.max(1, atrPct * 20)); // ATR-based multiplier
        }
      }
    } catch (error) {
      logger.debug({ error: error.message }, 'Failed to calculate ATR multiplier');
    }

    let stopLoss = 0;
    let takeProfit = 0;

    if (direction === 'BUY') {
      // Primary: Use support as SL, next resistance as TP
      if (support > 0 && support < currentPrice * 0.9) { // Valid support level exists
        stopLoss = support;
        takeProfit = resistance > currentPrice ? resistance : currentPrice * 1.03; // Next resistance or 3% TP
      } else {
        // Backup: % based SL/TP
        const slPct = this.getSLTPPercentByAccuracy(accuracy, 'SL');
        const tpPct = this.getSLTPPercentByAccuracy(accuracy, 'TP');
        stopLoss = currentPrice * (1 - slPct / 100);
        takeProfit = currentPrice * (1 + tpPct / 100);
      }

      // ATR adjustment
      const atrSLDistance = currentPrice * (atrMultiplier * 0.01); // ATR-based distance
      if (currentPrice - stopLoss > atrSLDistance) {
        stopLoss = currentPrice - atrSLDistance; // Tighten if too wide
      }

    } else { // SELL
      // Primary: Use resistance as SL, next support as TP
      if (resistance > 0 && resistance > currentPrice * 1.1) { // Valid resistance level exists
        stopLoss = resistance;
        takeProfit = support < currentPrice && support > 0 ? support : currentPrice * 0.97; // Next support or 3% TP
      } else {
        // Backup: % based SL/TP
        const slPct = this.getSLTPPercentByAccuracy(accuracy, 'SL');
        const tpPct = this.getSLTPPercentByAccuracy(accuracy, 'TP');
        stopLoss = currentPrice * (1 + slPct / 100);
        takeProfit = currentPrice * (1 - tpPct / 100);
      }

      // ATR adjustment
      const atrSLDistance = currentPrice * (atrMultiplier * 0.01);
      if (stopLoss - currentPrice > atrSLDistance) {
        stopLoss = currentPrice + atrSLDistance; // Tighten if too wide
      }
    }

    return { stopLoss, takeProfit, atrMultiplier };
  }

  /**
   * Get SL/TP percentages based on accuracy bands
   */
  private getSLTPPercentByAccuracy(accuracy: number, type: 'SL' | 'TP'): number {
    if (type === 'SL') {
      // Tighter SL for higher accuracy (less risk needed)
      if (accuracy >= 95) return 2; // 2% SL
      if (accuracy >= 85) return 3; // 3% SL
      if (accuracy >= 75) return 5; // 5% SL
      return 7; // 7% SL for lower accuracy
    } else { // TP
      // Wider TP for higher accuracy (more potential)
      if (accuracy >= 95) return 6; // 6% TP (3:1 RR)
      if (accuracy >= 85) return 4; // 4% TP (1.3:1 RR)
      if (accuracy >= 75) return 3; // 3% TP (1:1 RR)
      return 2; // 2% TP for lower accuracy
    }
  }

  /**
   * Calculate position size based on accuracy bands
   */
  calculatePositionSize(
    equity: number,
    entryPrice: number,
    stopLoss: number,
    accuracy: number,
    perTradeRiskPct: number
  ): number {
    // Base risk amount = perTradeRiskPct% of equity
    const baseRiskAmount = equity * (perTradeRiskPct / 100);

    // Adjust risk based on accuracy bands
    let riskMultiplier = 1;
    if (accuracy >= 95) riskMultiplier = 2; // 50% allocation cap
    else if (accuracy >= 85) riskMultiplier = 1.5; // 30% allocation cap
    else if (accuracy >= 75) riskMultiplier = 1; // 15% allocation cap

    const adjustedRiskAmount = baseRiskAmount * riskMultiplier;

    // Stop loss distance in price terms
    const stopLossDistance = Math.abs(entryPrice - stopLoss);

    // Position size = risk amount / stop loss distance
    const positionSize = adjustedRiskAmount / stopLossDistance;

    // Round down to avoid over-leveraging and ensure minimum order size
    const roundedSize = Math.floor(positionSize * 10000) / 10000; // 4 decimal precision

    // Minimum order size check
    return Math.max(roundedSize, 0.0001);
  }

  /**
   * Check risk guards before placing order
   */
  async checkRiskGuards(uid: string, signal: TradeSignal): Promise<{ allowed: boolean; reason?: string }> {
    const engine = await this.getUserEngine(uid);
    const config = engine.config;

    // Check circuit breaker
    if (engine.circuitBreaker) {
      return { allowed: false, reason: 'Circuit breaker active - daily loss limit exceeded' };
    }

    // Check manual override
    if (config.manualOverride) {
      return { allowed: false, reason: 'Manual override active - trading paused' };
    }

    // Check if auto-trade is enabled
    if (!config.autoTradeEnabled) {
      return { allowed: false, reason: 'Auto-trade is disabled' };
    }

    // Check max concurrent trades
    if (engine.activeTrades.size >= config.maxConcurrentTrades) {
      return { allowed: false, reason: `Max concurrent trades (${config.maxConcurrentTrades}) reached` };
    }

    // Check daily loss limit
    const stats = config.stats || DEFAULT_CONFIG.stats!;
    if (stats.dailyPnL < 0 && Math.abs(stats.dailyPnL) >= (config.equitySnapshot || 1000) * (config.maxDailyLossPct / 100)) {
      engine.circuitBreaker = true;
      await this.logTradeEvent(uid, 'CIRCUIT_BREAKER_TRIGGERED', {
        reason: 'Daily loss limit exceeded',
        dailyPnL: stats.dailyPnL,
        maxDailyLossPct: config.maxDailyLossPct,
      });
      return { allowed: false, reason: 'Daily loss limit exceeded - circuit breaker activated' };
    }

    // Check if already have position in this symbol
    for (const trade of engine.activeTrades.values()) {
      if (trade.symbol === signal.symbol && trade.status === 'FILLED') {
        return { allowed: false, reason: `Already have active position in ${signal.symbol}` };
      }
    }

    return { allowed: true };
  }

  /**
   * Execute trade with full auto-trade flow
   */
  async executeAutoTrade(uid: string, symbol: string): Promise<{ success: boolean; trade?: TradeExecution; reason?: string }> {
    try {
      // Compute master signal
      const masterSignal = await this.computeMasterSignal(symbol, uid);

      // Check accuracy threshold (≥75%)
      if (masterSignal.accuracy < 75) {
        logger.info({ uid, symbol, accuracy: masterSignal.accuracy }, 'Trade rejected: accuracy below 75% threshold');
        return { success: false, reason: `Accuracy ${masterSignal.accuracy.toFixed(1)}% below 75% threshold` };
      }

      // Check signal agreement (at least 3 of 4 key strategies agree)
      const keyStrategies = ['trend', 'volume', 'sentiment', 'news'];
      const keySignals = masterSignal.strategySignals.filter(s => keyStrategies.includes(s.name));
      const agreeingSignals = keySignals.filter(s => s.signal === masterSignal.direction);

      if (agreeingSignals.length < 3) {
        logger.info({ uid, symbol, agreement: agreeingSignals.length, required: 3 }, 'Trade rejected: insufficient strategy agreement');
        return { success: false, reason: `Only ${agreeingSignals.length}/4 key strategies agree` };
      }

      // Only proceed if signal is BUY or SELL (not HOLD)
      if (masterSignal.direction === 'HOLD') {
        logger.info({ uid, symbol }, 'Trade rejected: signal is HOLD');
        return { success: false, reason: 'Signal is HOLD' };
      }

      // Check for recent negative news (last 30 minutes)
      const recentNews = await this.checkRecentNegativeNews(symbol, uid);
      if (recentNews.hasNegative) {
        logger.info({ uid, symbol }, 'Trade rejected: recent negative news detected');
        return { success: false, reason: 'Recent negative news detected' };
      }

      // Check extreme volatility (ATR > 5%)
      if (await this.checkExtremeVolatility(masterSignal.marketData)) {
        logger.info({ uid, symbol }, 'Trade rejected: extreme volatility detected');
        return { success: false, reason: 'Extreme volatility detected' };
      }

      // Convert master signal to trade signal
      const tradeSignal: TradeSignal = {
        symbol: masterSignal.symbol,
        signal: masterSignal.direction,
        entryPrice: masterSignal.marketData.price,
        accuracy: masterSignal.accuracy,
        stopLoss: 0, // Will be set by SL/TP logic
        takeProfit: 0, // Will be set by SL/TP logic
        reasoning: `Auto-trade: ${masterSignal.agreementCount} strategies agree (${masterSignal.accuracy.toFixed(1)}% accuracy)`,
        requestId: `auto_${Date.now()}_${symbol}_${uid}`,
        timestamp: masterSignal.timestamp
      };

      // Execute the trade
      const trade = await this.executeTrade(uid, tradeSignal);
      return { success: true, trade };

    } catch (error: any) {
      logger.error({ error: error.message, uid, symbol }, 'Auto-trade execution failed');
      return { success: false, reason: error.message };
    }
  }

  /**
   * Check for recent negative news
   */
  private async checkRecentNegativeNews(symbol: string, uid: string): Promise<{ hasNegative: boolean }> {
    try {
      const integrations = await firestoreAdapter.getEnabledIntegrations(uid);
      const news = await fetchNewsData(integrations.newsdata?.apiKey, symbol);

      if (!news.success || !news.articles) {
        return { hasNegative: false };
      }

      const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);

      for (const article of news.articles) {
        const publishedAt = new Date(article.publishedAt).getTime();
        if (publishedAt > thirtyMinutesAgo) {
          // Check for negative keywords in title
          const title = article.title.toLowerCase();
          if (title.includes('crash') || title.includes('dump') || title.includes('ban') ||
              title.includes('hack') || title.includes('exploit') || title.includes('scam')) {
            return { hasNegative: true };
          }
        }
      }

      return { hasNegative: false };
    } catch (error) {
      logger.debug({ error: error.message }, 'Failed to check recent news');
      return { hasNegative: false };
    }
  }

  /**
   * Check for extreme volatility
   */
  private async checkExtremeVolatility(marketData: MarketData): Promise<boolean> {
    try {
      if (!marketData.ohlc || marketData.ohlc.length === 0) {
        return false;
      }

      const volatility = tradingStrategies.calculateVolatility(marketData.ohlc);
      const atrPct = volatility.atrPct || 0;

      // ATR > 5% indicates extreme volatility
      return atrPct > 5;
    } catch (error) {
      logger.debug({ error: error.message }, 'Failed to check volatility');
      return false;
    }
  }

  /**
   * Execute trade
   */
  async executeTrade(uid: string, signal: TradeSignal): Promise<TradeExecution> {
    const requestId = signal.requestId || `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    logger.info({ uid, symbol: signal.symbol, requestId }, 'Starting trade execution');

    // ALWAYS load config fresh from Firestore before execution
    const config = await this.loadConfig(uid);
    const engine = await this.getUserEngine(uid);
    engine.config = config; // Update in-memory config

    // Check risk guards
    const riskCheck = await this.checkRiskGuards(uid, signal);
    if (!riskCheck.allowed) {
      await this.logTradeEvent(uid, 'TRADE_REJECTED', {
        signal,
        reason: riskCheck.reason,
      });
      throw new Error(riskCheck.reason || 'Trade rejected by risk guards');
    }

    // Initialize adapter if needed
    if (!engine.adapter) {
      await this.initializeAdapter(uid);
      if (!engine.adapter) {
        throw new Error('Failed to initialize exchange adapter');
      }
    }

    // Get current equity
    let equity = config.equitySnapshot || 1000; // Default fallback
    try {
      // Check if adapter has getAccount method (optional in interface)
      if (engine.adapter && typeof engine.adapter.getAccount === 'function') {
        const accountInfo = await engine.adapter.getAccount();
        
        // Handle different exchange response formats
        if (accountInfo.balances && Array.isArray(accountInfo.balances)) {
          // Binance format: balances array
          const usdtBalance = accountInfo.balances.find((b: any) => b.asset === 'USDT' || b.asset === 'USDT');
          if (usdtBalance) {
            const free = parseFloat(usdtBalance.free || usdtBalance.available || '0');
            const locked = parseFloat(usdtBalance.locked || usdtBalance.frozen || '0');
            equity = free + locked;
          }
        } else if (accountInfo.totalEquity) {
          // Some exchanges return totalEquity directly
          equity = parseFloat(accountInfo.totalEquity.toString());
        } else if (accountInfo.equity) {
          equity = parseFloat(accountInfo.equity.toString());
        }
        
        // If no valid equity found, use snapshot or default
        if (equity === 0 || isNaN(equity)) {
          equity = config.equitySnapshot || 1000;
        }
        
        // Update equity snapshot
        await this.saveConfig(uid, { equitySnapshot: equity });
        
        logger.info({ uid, equity, source: 'exchange' }, 'Equity fetched from exchange');
      } else {
        logger.debug({ uid }, 'Adapter does not support getAccount, using snapshot');
      }
    } catch (error: any) {
      logger.warn({ error: error.message, uid }, 'Could not fetch equity from exchange, using snapshot');
    }

    // Get market data for SL/TP calculation
    const marketData = await this.aggregateMarketData(signal.symbol, uid);

    // Calculate hybrid SL/TP levels
    const { stopLoss, takeProfit } = this.calculateHybridSLTP(marketData, signal.signal, signal.accuracy);

    // Calculate position size based on accuracy
    const quantity = this.calculatePositionSize(
      equity,
      signal.entryPrice,
      stopLoss,
      signal.accuracy,
      config.perTradeRiskPct
    );

    logger.info({
      uid,
      symbol: signal.symbol,
      equity,
      entryPrice: signal.entryPrice,
      accuracy: signal.accuracy,
      stopLoss,
      takeProfit,
      quantity,
      requestId
    }, 'Position size and SL/TP calculated');

    if (quantity <= 0) {
      throw new Error('Calculated position size is zero or negative');
    }

    // Create trade execution record
    const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const trade: TradeExecution = {
      tradeId,
      symbol: signal.symbol,
      side: signal.signal,
      quantity,
      entryPrice: signal.entryPrice,
      stopLoss,
      takeProfit,
      status: 'PENDING',
      timestamp: new Date(),
      mode: config.mode,
    };

    // Execute based on mode
    if (config.mode === 'AUTO' && !config.manualOverride) {
      // Live mode - place real order
      try {
        logger.info({ uid, symbol: signal.symbol, requestId }, 'Pre-trade validation: checking orderbook liquidity');
        
        // Pre-trade validation: orderbook liquidity & min notional
        const orderbook = await engine.adapter!.getOrderbook(signal.symbol, 5);
        const bestBid = parseFloat(orderbook.bids[0]?.price || '0');
        const bestAsk = parseFloat(orderbook.asks[0]?.price || '0');
        
        if (bestBid === 0 || bestAsk === 0) {
          throw new Error('Insufficient order book liquidity');
        }

        // Check min notional (e.g., $10 minimum for Binance)
        const notional = quantity * signal.entryPrice;
        if (notional < 10) {
          throw new Error(`Order notional (${notional.toFixed(2)}) below minimum (10)`);
        }

        logger.info({ 
          uid, 
          symbol: signal.symbol, 
          quantity, 
          entryPrice: signal.entryPrice, 
          notional,
          side: signal.signal,
          requestId 
        }, 'Placing live order');

        // Place order
        const orderResult = await engine.adapter!.placeOrder({
          symbol: signal.symbol,
          side: signal.signal,
          type: 'MARKET',
          quantity: quantity,
        });

        trade.status = 'FILLED';
        trade.orderId = orderResult.exchangeOrderId || orderResult.id;
        trade.fillPrice = parseFloat(orderResult.avgPrice?.toString() || orderResult.price?.toString() || signal.entryPrice.toString());

        await this.logTradeEvent(uid, 'TRADE_EXECUTED', {
          trade,
          signal,
          equity,
          quantity,
          orderResult,
          requestId,
          exchangeResponse: orderResult,
          config: {
            mode: config.mode,
            perTradeRiskPct: config.perTradeRiskPct,
            stopLossPct: config.stopLossPct,
            takeProfitPct: config.takeProfitPct,
          },
        });

        logger.info({ 
          uid, 
          tradeId, 
          symbol: signal.symbol, 
          orderId: trade.orderId, 
          fillPrice: trade.fillPrice,
          requestId,
          mode: 'AUTO' 
        }, 'Trade executed (LIVE mode)');
      } catch (error: any) {
        trade.status = 'REJECTED';
        await this.logTradeEvent(uid, 'TRADE_FAILED', {
          trade,
          signal,
          error: error.message,
          requestId,
          exchangeError: error.response?.data || error.message,
        });
        logger.error({ 
          uid, 
          tradeId, 
          symbol: signal.symbol, 
          error: error.message, 
          requestId 
        }, 'Trade execution failed');
        throw error;
      }
    } else {
      // Manual mode or override active - don't execute
      trade.status = 'CANCELLED';
      await this.logTradeEvent(uid, 'TRADE_CANCELLED', {
        trade,
        signal,
        reason: config.manualOverride ? 'Manual override active' : 'Manual mode',
        requestId,
      });
      logger.warn({ uid, symbol: signal.symbol, requestId, reason: config.manualOverride ? 'Manual override' : 'Manual mode' }, 'Trade cancelled');
      throw new Error('Trading is in manual mode or override is active');
    }

    // Store active trade
    engine.activeTrades.set(tradeId, trade);

    // Update stats
    await this.updateStats(uid, trade);

    return trade;
  }

  /**
   * Update trade statistics
   */
  async updateStats(uid: string, trade: TradeExecution): Promise<void> {
    const engine = await this.getUserEngine(uid);
    const config = engine.config;
    const stats = config.stats || DEFAULT_CONFIG.stats!;

    // Reset daily stats if new day
    const now = new Date();
    const lastRun = config.lastRun || new Date(0);
    if (now.toDateString() !== lastRun.toDateString()) {
      stats.dailyPnL = 0;
      stats.dailyTrades = 0;
      engine.circuitBreaker = false; // Reset circuit breaker for new day
    }

    stats.totalTrades += 1;
    stats.dailyTrades += 1;

    // Calculate PnL when trade is closed (simplified for now)
    if (trade.pnl !== undefined) {
      stats.totalPnL += trade.pnl;
      stats.dailyPnL += trade.pnl;
      
      if (trade.pnl > 0) {
        stats.winningTrades += 1;
      } else {
        stats.losingTrades += 1;
      }
    }

    await this.saveConfig(uid, { stats, lastRun: now });
  }

  /**
   * Log trade event to Firestore
   */
  async logTradeEvent(uid: string, eventType: string, data: any): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      await db.collection('users').doc(uid).collection('autoTradeLogs').add({
        eventType,
        data,
        timestamp: admin.firestore.Timestamp.now(),
        userId: uid,
      });
    } catch (error: any) {
      logger.error({ error: error.message, uid, eventType }, 'Error logging trade event');
    }
  }

  /**
   * Get engine status
   */
  async getStatus(uid: string): Promise<{
    enabled: boolean;
    mode: string;
    activeTrades: number;
    dailyPnL: number;
    dailyTrades: number;
    circuitBreaker: boolean;
    manualOverride: boolean;
    equity: number;
  }> {
    const engine = await this.getUserEngine(uid);
    const config = engine.config;
    
    // Try to get current equity from exchange if adapter is available
    let equity = config.equitySnapshot || 0;
    if (engine.adapter && typeof engine.adapter.getAccount === 'function') {
      try {
        const accountInfo = await engine.adapter.getAccount();
        
        // Handle different exchange response formats
        if (accountInfo.balances && Array.isArray(accountInfo.balances)) {
          const usdtBalance = accountInfo.balances.find((b: any) => b.asset === 'USDT');
          if (usdtBalance) {
            const free = parseFloat(usdtBalance.free || usdtBalance.available || '0');
            const locked = parseFloat(usdtBalance.locked || usdtBalance.frozen || '0');
            equity = free + locked;
          }
        } else if (accountInfo.totalEquity) {
          equity = parseFloat(accountInfo.totalEquity.toString());
        } else if (accountInfo.equity) {
          equity = parseFloat(accountInfo.equity.toString());
        }
        
        if (equity > 0 && !isNaN(equity)) {
          await this.saveConfig(uid, { equitySnapshot: equity });
        }
      } catch (error: any) {
        logger.warn({ error: error.message, uid }, 'Could not fetch equity for status');
      }
    }
    
    return {
      enabled: config.autoTradeEnabled,
      mode: config.mode,
      activeTrades: engine.activeTrades.size,
      dailyPnL: config.stats?.dailyPnL || 0,
      dailyTrades: config.stats?.dailyTrades || 0,
      circuitBreaker: engine.circuitBreaker,
      manualOverride: config.manualOverride,
      equity,
    };
  }

  /**
   * Auto-trade scheduler - runs one cycle for a user
   */
  async runAutoTradeCycle(uid: string): Promise<{
    success: boolean;
    tradesExecuted: number;
    symbolsChecked: number;
    errors: string[];
  }> {
    const cycleId = `cycle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    let tradesExecuted = 0;
    const errors: string[] = [];

    logger.info({ uid, cycleId }, 'Starting auto-trade cycle');

    try {
      // Load user config
      const config = await this.loadConfig(uid);

      // Check if auto-trade is enabled
      if (!config.autoTradeEnabled) {
        logger.info({ uid, cycleId }, 'Auto-trade disabled, skipping cycle');
        return { success: true, tradesExecuted: 0, symbolsChecked: 0, errors: [] };
      }

      // Check if we're in AUTO mode
      if (config.mode !== 'AUTO') {
        logger.info({ uid, cycleId, mode: config.mode }, 'Not in AUTO mode, skipping cycle');
        return { success: true, tradesExecuted: 0, symbolsChecked: 0, errors: [] };
      }

      // Check circuit breaker
      const engine = await this.getUserEngine(uid);
      if (engine.circuitBreaker) {
        logger.warn({ uid, cycleId }, 'Circuit breaker active, skipping cycle');
        return { success: false, tradesExecuted: 0, symbolsChecked: 0, errors: ['Circuit breaker active'] };
      }

      // Define symbols to check (can be expanded based on user preferences)
      const symbols = [
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'SOLUSDT',
        'DOTUSDT', 'LINKUSDT', 'AVAXUSDT', 'LTCUSDT', 'ALGOUSDT'
      ];

      let symbolsChecked = 0;

      // Check each symbol
      for (const symbol of symbols) {
        try {
          // Check if we already have an active trade for this symbol
          const hasActiveTrade = Array.from(engine.activeTrades.values())
            .some(trade => trade.symbol === symbol && trade.status === 'FILLED');

          if (hasActiveTrade) {
            logger.debug({ uid, symbol, cycleId }, 'Already have active trade for symbol, skipping');
            continue;
          }

          // Check if we can add more concurrent trades
          if (engine.activeTrades.size >= config.maxConcurrentTrades) {
            logger.info({ uid, cycleId }, 'Max concurrent trades reached, stopping cycle');
            break;
          }

          // Run auto-trade for this symbol
          const result = await this.executeAutoTrade(uid, symbol);

          if (result.success && result.trade) {
            tradesExecuted++;
            logger.info({ uid, symbol, cycleId, tradeId: result.trade.tradeId }, 'Auto-trade executed successfully');
          } else {
            logger.debug({ uid, symbol, cycleId, reason: result.reason }, 'Auto-trade skipped for symbol');
          }

          symbolsChecked++;

          // Small delay between symbols to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error: any) {
          const errorMsg = `Error processing ${symbol}: ${error.message}`;
          errors.push(errorMsg);
          logger.error({ error: error.message, uid, symbol, cycleId }, 'Error in auto-trade cycle for symbol');
        }
      }

      // Update last run timestamp
      await this.saveConfig(uid, { lastRun: new Date() });

      const duration = Date.now() - startTime;
      logger.info({
        uid,
        cycleId,
        tradesExecuted,
        symbolsChecked,
        errors: errors.length,
        duration
      }, 'Auto-trade cycle completed');

      return {
        success: true,
        tradesExecuted,
        symbolsChecked,
        errors
      };

    } catch (error: any) {
      const duration = Date.now() - startTime;
      logger.error({ error: error.message, uid, cycleId, duration }, 'Auto-trade cycle failed');

      return {
        success: false,
        tradesExecuted,
        symbolsChecked: 0,
        errors: [error.message]
      };
    }
  }

  /**
   * Get auto-trade cycle status and recent proposals
   */
  async getAutoTradeProposals(uid: string): Promise<{
    lastCycle?: Date;
    nextCycle?: Date;
    recentProposals: Array<{
      symbol: string;
      direction: 'BUY' | 'SELL';
      accuracy: number;
      entryPrice: number;
      stopLoss: number;
      takeProfit: number;
      positionSize: number;
      timestamp: Date;
      executed: boolean;
    }>;
  }> {
    try {
      const config = await this.loadConfig(uid);

      // Get recent proposals from logs (last 24 hours)
      const db = getFirebaseAdmin().firestore();
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const logsSnapshot = await db.collection('users').doc(uid)
        .collection('autoTradeLogs')
        .where('timestamp', '>', yesterday)
        .orderBy('timestamp', 'desc')
        .limit(50)
        .get();

      const recentProposals: any[] = [];

      logsSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.eventType === 'TRADE_EXECUTED' && data.data?.signal) {
          recentProposals.push({
            symbol: data.data.signal.symbol,
            direction: data.data.signal.signal,
            accuracy: data.data.signal.accuracy,
            entryPrice: data.data.signal.entryPrice,
            stopLoss: data.data.signal.stopLoss,
            takeProfit: data.data.signal.takeProfit,
            positionSize: data.data.quantity,
            timestamp: data.timestamp?.toDate() || new Date(),
            executed: true
          });
        }
      });

      // Calculate next cycle (every 10 minutes)
      const nextCycle = config.lastRun ?
        new Date(config.lastRun.getTime() + 10 * 60 * 1000) :
        new Date(Date.now() + 10 * 60 * 1000);

      return {
        lastCycle: config.lastRun,
        nextCycle,
        recentProposals
      };

    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to get auto-trade proposals');
      return {
        recentProposals: []
      };
    }
  }

  /**
   * Reset circuit breaker (admin only)
   */
  async resetCircuitBreaker(uid: string): Promise<void> {
    const engine = await this.getUserEngine(uid);
    engine.circuitBreaker = false;
    await this.logTradeEvent(uid, 'CIRCUIT_BREAKER_RESET', {});
  }
}

export const autoTradeEngine = new AutoTradeEngine();

