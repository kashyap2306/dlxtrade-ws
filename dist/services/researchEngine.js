"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.researchEngine = exports.ResearchEngine = void 0;
const logger_1 = require("../utils/logger");
const firestoreAdapter_1 = require("./firestoreAdapter");
const cryptoquantAdapter_1 = require("./cryptoquantAdapter");
const lunarcrushAdapter_1 = require("./lunarcrushAdapter");
const coinapiAdapter_1 = require("./coinapiAdapter");
class ResearchEngine {
    constructor() {
        this.recentTrades = new Map();
        this.orderbookHistory = new Map();
        this.spreadHistory = new Map();
        this.volumeHistory = new Map();
        this.depthHistory = new Map();
        this.imbalanceHistory = new Map();
    }
    async runResearch(symbol, uid, adapter) {
        // If adapter is provided, use it; otherwise try to get from user engine
        let binanceAdapter = adapter;
        if (!binanceAdapter) {
            // Fallback: try to get adapter from user engine manager
            try {
                const { userEngineManager } = await Promise.resolve().then(() => __importStar(require('./userEngineManager')));
                const engine = userEngineManager.getUserEngine(uid);
                if (engine) {
                    binanceAdapter = engine.adapter;
                }
            }
            catch (err) {
                logger_1.logger.debug({ err, uid }, 'Could not get adapter from user engine');
            }
        }
        if (!binanceAdapter) {
            throw new Error('Binance adapter not available');
        }
        // Get current orderbook
        const orderbook = await binanceAdapter.getOrderbook(symbol, 20);
        // Calculate orderbook imbalance
        const imbalance = this.calculateOrderbookImbalance(orderbook);
        // Get micro-signals
        const microSignals = this.calculateMicroSignals(symbol, orderbook);
        // Persist snapshot for momentum/history-based features (after computing micro-signals)
        this.addOrderbook(symbol, orderbook);
        // Calculate accuracy based on historical data and all available sources
        let accuracy = await this.calculateAccuracy(symbol, imbalance, microSignals, uid);
        // Liquidity filters: dynamically block low-liquidity / high-spread conditions
        if (this.shouldBlockForLiquidity(symbol, microSignals)) {
            accuracy = Math.min(accuracy, 0.49);
        }
        // Determine signal using dynamic thresholds
        const signal = this.determineSignalDynamic(symbol, imbalance, microSignals, accuracy);
        // Recommended action
        const recommendedAction = this.getRecommendedAction(signal, accuracy);
        const result = {
            symbol,
            signal,
            accuracy,
            orderbookImbalance: imbalance,
            recommendedAction,
            microSignals,
        };
        // Save to Firestore
        await firestoreAdapter_1.firestoreAdapter.saveResearchLog(uid, {
            symbol,
            timestamp: require('firebase-admin').firestore.Timestamp.now(),
            signal,
            accuracy,
            orderbookImbalance: imbalance,
            recommendedAction,
            microSignals,
        });
        logger_1.logger.info({ symbol, signal, accuracy }, 'Research completed');
        return result;
    }
    calculateOrderbookImbalance(orderbook) {
        if (orderbook.bids.length === 0 || orderbook.asks.length === 0) {
            return 0;
        }
        const bidVolume = orderbook.bids.slice(0, 10).reduce((sum, bid) => {
            return sum + parseFloat(bid.quantity);
        }, 0);
        const askVolume = orderbook.asks.slice(0, 10).reduce((sum, ask) => {
            return sum + parseFloat(ask.quantity);
        }, 0);
        const totalVolume = bidVolume + askVolume;
        if (totalVolume === 0)
            return 0;
        // Imbalance: positive = more bids (bullish), negative = more asks (bearish)
        return (bidVolume - askVolume) / totalVolume;
    }
    calculateMicroSignals(symbol, orderbook) {
        const bestBid = parseFloat(orderbook.bids[0]?.price || '0');
        const bestAsk = parseFloat(orderbook.asks[0]?.price || '0');
        const spread = bestAsk - bestBid;
        const midPrice = (bestBid + bestAsk) / 2;
        const spreadPct = midPrice > 0 ? (spread / midPrice) * 100 : 0;
        const bidDepth = orderbook.bids.slice(0, 5).reduce((sum, bid) => {
            return sum + parseFloat(bid.quantity) * parseFloat(bid.price);
        }, 0);
        const askDepth = orderbook.asks.slice(0, 5).reduce((sum, ask) => {
            return sum + parseFloat(ask.quantity) * parseFloat(ask.price);
        }, 0);
        // Simple volume calculation
        const volume = bidDepth + askDepth;
        // Price momentum from per-symbol history: (currentMid - prevMid) / prevMid
        let priceMomentum = 0;
        const history = this.orderbookHistory.get(symbol);
        if (midPrice > 0 && history && history.length >= 1) {
            const prev = history[history.length - 1];
            const prevBid = parseFloat(prev.bids[0]?.price || '0');
            const prevAsk = parseFloat(prev.asks[0]?.price || '0');
            const prevMid = prevBid > 0 && prevAsk > 0 ? (prevBid + prevAsk) / 2 : 0;
            if (prevMid > 0) {
                priceMomentum = (midPrice - prevMid) / prevMid;
            }
        }
        // Rolling volatility (stddev of mid returns) over last N snapshots
        const volatility = this.computeVolatility(symbol, 20);
        return {
            spread: spreadPct,
            volume,
            priceMomentum,
            orderbookDepth: bidDepth + askDepth,
            // @ts-ignore: extend runtime shape
            volatility,
        };
    }
    async calculateAccuracy(symbol, imbalance, microSignals, uid) {
        // Multi-source accuracy calculation using all available data sources
        let accuracy = 0.5; // Base accuracy
        // 1. Orderbook imbalance strength (Binance data)
        const imbalanceStrength = Math.abs(imbalance);
        if (imbalanceStrength > 0.3) {
            accuracy += 0.15;
        }
        else if (imbalanceStrength > 0.15) {
            accuracy += 0.1;
        }
        else if (imbalanceStrength > 0.05) {
            accuracy += 0.05;
        }
        // 2. Spread analysis (tighter spread = higher confidence)
        if (microSignals.spread < 0.05) {
            accuracy += 0.15; // Very tight spread
        }
        else if (microSignals.spread < 0.1) {
            accuracy += 0.1;
        }
        else if (microSignals.spread < 0.2) {
            accuracy += 0.05;
        }
        // 3. Volume depth analysis
        if (microSignals.volume > 500000) {
            accuracy += 0.15; // Very high volume
        }
        else if (microSignals.volume > 100000) {
            accuracy += 0.1;
        }
        else if (microSignals.volume > 50000) {
            accuracy += 0.05;
        }
        // 4. Orderbook depth analysis
        if (microSignals.orderbookDepth > 1000000) {
            accuracy += 0.1;
        }
        else if (microSignals.orderbookDepth > 500000) {
            accuracy += 0.05;
        }
        // 5. Fetch external data sources if integrations are available
        if (uid) {
            try {
                const integrations = await firestoreAdapter_1.firestoreAdapter.getEnabledIntegrations(uid);
                // CryptoQuant data (if available)
                if (integrations.cryptoquant) {
                    try {
                        const cryptoquantAdapter = new cryptoquantAdapter_1.CryptoQuantAdapter(integrations.cryptoquant.apiKey);
                        const onChainData = await cryptoquantAdapter.getOnChainMetrics(symbol);
                        const flowData = await cryptoquantAdapter.getExchangeFlow(symbol);
                        // Positive exchange flow (more inflow than outflow) is bullish
                        if (flowData.exchangeFlow && flowData.exchangeFlow > 0) {
                            accuracy += 0.05;
                        }
                        // High whale transactions indicate strong interest
                        if (onChainData.whaleTransactions && onChainData.whaleTransactions > 10) {
                            accuracy += 0.03;
                        }
                        // Active addresses indicate network activity
                        if (onChainData.activeAddresses && onChainData.activeAddresses > 100000) {
                            accuracy += 0.02;
                        }
                    }
                    catch (err) {
                        logger_1.logger.debug({ err, symbol }, 'CryptoQuant fetch error (non-critical)');
                    }
                }
                // LunarCrush sentiment data (if available)
                if (integrations.lunarcrush) {
                    try {
                        const lunarcrushAdapter = new lunarcrushAdapter_1.LunarCrushAdapter(integrations.lunarcrush.apiKey);
                        const sentimentData = await lunarcrushAdapter.getCoinData(symbol);
                        // Positive sentiment boosts accuracy
                        if (sentimentData.sentiment && sentimentData.sentiment > 0.3) {
                            accuracy += 0.05;
                        }
                        else if (sentimentData.sentiment && sentimentData.sentiment < -0.3) {
                            // Negative sentiment reduces accuracy
                            accuracy -= 0.03;
                        }
                        // High social volume indicates interest
                        if (sentimentData.socialVolume && sentimentData.socialVolume > 1000) {
                            accuracy += 0.03;
                        }
                        // Bullish sentiment percentage
                        if (sentimentData.bullishSentiment && sentimentData.bullishSentiment > 0.6) {
                            accuracy += 0.02;
                        }
                    }
                    catch (err) {
                        logger_1.logger.debug({ err, symbol }, 'LunarCrush fetch error (non-critical)');
                    }
                }
                // CoinAPI historical data (if available)
                // Check for all CoinAPI sub-types
                const coinapiMarket = integrations['coinapi_market'];
                const coinapiFlatfile = integrations['coinapi_flatfile'];
                const coinapiExchangerate = integrations['coinapi_exchangerate'];
                if (coinapiMarket || coinapiFlatfile || coinapiExchangerate) {
                    try {
                        // Try market data first
                        if (coinapiMarket) {
                            const marketAdapter = new coinapiAdapter_1.CoinAPIAdapter(coinapiMarket.apiKey, 'market');
                            const marketData = await marketAdapter.getMarketData(symbol);
                            // Positive 24h price change is bullish
                            if (marketData.priceChangePercent24h && marketData.priceChangePercent24h > 2) {
                                accuracy += 0.03;
                            }
                            // High volume indicates liquidity
                            if (marketData.volume24h && marketData.volume24h > 1000000) {
                                accuracy += 0.02;
                            }
                        }
                        // Try historical data for trend analysis
                        if (coinapiFlatfile) {
                            const flatfileAdapter = new coinapiAdapter_1.CoinAPIAdapter(coinapiFlatfile.apiKey, 'flatfile');
                            const historicalData = await flatfileAdapter.getHistoricalData(symbol, 7);
                            // Analyze trend from historical data
                            if (historicalData.historicalData && historicalData.historicalData.length >= 2) {
                                const recent = historicalData.historicalData[historicalData.historicalData.length - 1];
                                const previous = historicalData.historicalData[historicalData.historicalData.length - 2];
                                const trend = (recent.price - previous.price) / previous.price;
                                if (trend > 0.02) {
                                    accuracy += 0.03; // Uptrend
                                }
                                else if (trend < -0.02) {
                                    accuracy -= 0.02; // Downtrend
                                }
                            }
                        }
                        // Exchange rate data (less critical for accuracy, but can be used)
                        if (coinapiExchangerate) {
                            const baseAsset = symbol.replace('USDT', '').replace('USD', '');
                            const exchangerateAdapter = new coinapiAdapter_1.CoinAPIAdapter(coinapiExchangerate.apiKey, 'exchangerate');
                            const rateData = await exchangerateAdapter.getExchangeRate(baseAsset, 'USD');
                            // Could use exchange rate for additional validation
                        }
                    }
                    catch (err) {
                        logger_1.logger.debug({ err, symbol }, 'CoinAPI fetch error (non-critical)');
                    }
                }
            }
            catch (err) {
                logger_1.logger.debug({ err }, 'Error fetching external data sources for accuracy');
            }
        }
        // 6. Price momentum (if we have historical data)
        if (this.orderbookHistory.has(symbol)) {
            const history = this.orderbookHistory.get(symbol);
            if (history.length >= 2) {
                const recent = history[history.length - 1];
                const previous = history[history.length - 2];
                const recentMid = (parseFloat(recent.bids[0]?.price || '0') + parseFloat(recent.asks[0]?.price || '0')) / 2;
                const previousMid = (parseFloat(previous.bids[0]?.price || '0') + parseFloat(previous.asks[0]?.price || '0')) / 2;
                const momentum = (recentMid - previousMid) / previousMid;
                // Strong momentum in direction of signal increases confidence
                if (Math.abs(momentum) > 0.001) {
                    accuracy += 0.05;
                }
            }
        }
        // Cap at 0.95 max (never 100% confidence)
        return Math.min(0.95, Math.max(0.1, accuracy));
    }
    determineSignalDynamic(symbol, imbalance, microSignals, accuracy) {
        if (accuracy < 0.5) {
            return 'HOLD';
        }
        const dynamic = this.computeDynamicThresholds(symbol);
        const thr = Math.max(0.05, Math.min(0.4, dynamic.imbalanceThreshold));
        if (imbalance > thr) {
            return 'BUY';
        }
        else if (imbalance < -thr) {
            return 'SELL';
        }
        return 'HOLD';
    }
    getRecommendedAction(signal, accuracy) {
        if (signal === 'HOLD') {
            return 'Wait for better signal';
        }
        if (accuracy >= 0.85) {
            return `Execute ${signal} trade (high confidence)`;
        }
        else if (accuracy >= 0.7) {
            return `Consider ${signal} trade (moderate confidence)`;
        }
        else {
            return `Monitor ${signal} signal (low confidence)`;
        }
    }
    addTrade(symbol, trade) {
        if (!this.recentTrades.has(symbol)) {
            this.recentTrades.set(symbol, []);
        }
        const trades = this.recentTrades.get(symbol);
        trades.push(trade);
        // Keep only last 100 trades
        if (trades.length > 100) {
            trades.shift();
        }
    }
    addOrderbook(symbol, orderbook) {
        if (!this.orderbookHistory.has(symbol)) {
            this.orderbookHistory.set(symbol, []);
        }
        const history = this.orderbookHistory.get(symbol);
        history.push(orderbook);
        // Keep only last 50 snapshots
        if (history.length > 50) {
            history.shift();
        }
    }
    updateSignalHistories(symbol, micro, imbalance) {
        const pushWithCap = (map, value, cap = 200) => {
            if (!map.has(symbol))
                map.set(symbol, []);
            const arr = map.get(symbol);
            arr.push(value);
            if (arr.length > cap)
                arr.shift();
        };
        pushWithCap(this.spreadHistory, micro.spread);
        pushWithCap(this.volumeHistory, micro.volume);
        pushWithCap(this.depthHistory, micro.orderbookDepth);
        pushWithCap(this.imbalanceHistory, Math.abs(imbalance));
    }
    computeVolatility(symbol, window = 20) {
        const history = this.orderbookHistory.get(symbol);
        if (!history || history.length < 2)
            return 0;
        const mids = history.map((ob) => {
            const b = parseFloat(ob.bids[0]?.price || '0');
            const a = parseFloat(ob.asks[0]?.price || '0');
            return b > 0 && a > 0 ? (b + a) / 2 : 0;
        }).filter((m) => m > 0);
        if (mids.length < 2)
            return 0;
        const rets = [];
        const start = Math.max(1, mids.length - window);
        for (let i = start; i < mids.length; i++) {
            const r = (mids[i] - mids[i - 1]) / mids[i - 1];
            rets.push(r);
        }
        if (rets.length === 0)
            return 0;
        const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
        const variance = rets.reduce((s, v) => s + (v - mean) * (v - mean), 0) / rets.length;
        return Math.sqrt(variance);
    }
    percentile(values, p) {
        if (!values.length)
            return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
        return sorted[idx];
    }
    median(values) {
        if (!values.length)
            return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    computeDynamicThresholds(symbol) {
        const spreads = this.spreadHistory.get(symbol) || [];
        const volumes = this.volumeHistory.get(symbol) || [];
        const depths = this.depthHistory.get(symbol) || [];
        const imbs = this.imbalanceHistory.get(symbol) || [];
        const spreadP20 = this.percentile(spreads, 20);
        const spreadP40 = this.percentile(spreads, 40);
        const spreadP60 = this.percentile(spreads, 60);
        const volumeMedian = this.median(volumes);
        const depthMedian = this.median(depths);
        const imbMean = imbs.length ? imbs.reduce((s, v) => s + v, 0) / imbs.length : 0;
        const imbVar = imbs.length ? imbs.reduce((s, v) => s + (v - imbMean) * (v - imbMean), 0) / imbs.length : 0;
        const imbalanceStd = Math.sqrt(imbVar);
        const imbP70 = this.percentile(imbs, 70);
        const imbalanceThreshold = imbP70 || 0.2;
        return { spreadP20, spreadP40, spreadP60, volumeMedian, depthMedian, imbalanceStd, imbalanceThreshold };
    }
    shouldBlockForLiquidity(symbol, micro) {
        const dynamic = this.computeDynamicThresholds(symbol);
        const spread80 = this.percentile(this.spreadHistory.get(symbol) || [micro.spread], 80);
        const spreadTooWide = spread80 > 0 ? micro.spread > spread80 : false;
        const depthTooLow = dynamic.depthMedian > 0 ? micro.orderbookDepth < dynamic.depthMedian * 0.5 : false;
        const volumeTooLow = dynamic.volumeMedian > 0 ? micro.volume < dynamic.volumeMedian * 0.5 : false;
        return spreadTooWide || depthTooLow || volumeTooLow;
    }
}
exports.ResearchEngine = ResearchEngine;
exports.researchEngine = new ResearchEngine();
