"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CryptoCompareAdapter = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
const apiUsageTracker_1 = require("./apiUsageTracker");
class CryptoCompareAdapter {
    constructor(apiKey) {
        this.baseUrl = 'https://min-api.cryptocompare.com';
        this.apiKey = apiKey;
        if (apiKey != null && typeof apiKey === 'string' && apiKey.trim() !== '') {
            this.apiKey = apiKey.trim();
            logger_1.logger.info({ apiKeyLength: this.apiKey.length, source: 'user_api_key' }, 'CryptoCompare adapter initialized with API key');
            this.httpClient = axios_1.default.create({
                baseURL: this.baseUrl,
                timeout: 10000,
                params: {
                    api_key: this.apiKey,
                },
            });
        }
        else {
            logger_1.logger.warn('CryptoCompare adapter initialized without API key - will return neutral defaults');
            this.httpClient = null;
        }
    }
    /**
     * Get whale activity data (using blockchain histo/day endpoint)
     */
    async getWhaleActivity(symbol) {
        // Map symbol to CryptoCompare format (e.g., BTCUSDT -> BTC)
        const baseSymbol = symbol.replace(/USDT$/i, '').replace(/USD$/i, '');
        // Add DNS retry logic (max 3 retries) for all requests
        let lastError = null;
        const maxRetries = 3;
        for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
            try {
                const response = await this.httpClient.get('/data/blockchain/histo/day', {
                    params: {
                        fsym: baseSymbol,
                        tsym: 'USD',
                        limit: 1,
                        api_key: this.apiKey,
                    },
                });
                // Track API usage
                apiUsageTracker_1.apiUsageTracker.increment('cryptocompare');
                // Extract whale activity score from blockchain data
                const data = response.data?.Data?.[0];
                if (!data)
                    return 0;
                // Use transaction volume as whale activity proxy
                const transactionVolume = data.transaction_volume || 0;
                const activeAddresses = data.active_addresses || 0;
                // Normalize to 0-100 scale
                const whaleScore = Math.min(100, Math.max(0, (transactionVolume / 1000000) + (activeAddresses / 1000)));
                return whaleScore;
            }
            catch (error) {
                const status = error.response?.status;
                const errorMessage = error.response?.data?.Message || error.message;
                const errorCode = error.code || error.response?.data?.code;
                lastError = error;
                // Handle authentication errors immediately (no retry)
                if (status === 401 || status === 403) {
                    logger_1.logger.warn({ status, errorMessage, symbol }, 'CryptoCompare API authentication failed, using fallback');
                    return 0;
                }
                // Handle ENOTFOUND and other network/DNS issues with retry
                if (errorCode === 'ENOTFOUND' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                    if (retryCount < maxRetries - 1) {
                        logger_1.logger.warn({ errorCode, errorMessage, symbol, retryCount: retryCount + 1, maxRetries }, 'CryptoCompare API unavailable - network/DNS issue, retrying...');
                        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Progressive delay
                        continue;
                    }
                    else {
                        logger_1.logger.warn({ errorCode, errorMessage, symbol, retryCount }, 'CryptoCompare API unavailable after all retries, using fallback');
                        return 0;
                    }
                }
                // For other errors, don't retry - return fallback
                logger_1.logger.warn({ error: errorMessage, status, symbol, errorCode }, 'CryptoCompare API error, using fallback');
                return 0;
            }
        }
        // If we get here, all retries failed - return fallback
        const errorMessage = lastError?.response?.data?.Message || lastError?.message || 'Unknown error';
        logger_1.logger.warn({ symbol, error: errorMessage }, 'CryptoCompare API failed after all retries, using fallback');
        return 0;
    }
    /**
     * Get exchange reserves data
     */
    async getExchangeReserves(symbol) {
        const baseSymbol = symbol.replace(/USDT$/i, '').replace(/USD$/i, '');
        let lastError = null;
        const maxRetries = 3;
        for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
            try {
                const response = await this.httpClient.get('/data/exchange/top/volumes', {
                    params: {
                        fsym: baseSymbol,
                        tsym: 'USDT',
                        limit: 10,
                        api_key: this.apiKey,
                    },
                });
                apiUsageTracker_1.apiUsageTracker.increment('cryptocompare');
                // Extract reserve change from top exchange volumes
                const exchanges = response.data?.Data || [];
                if (exchanges.length === 0)
                    return 0;
                // Calculate average volume change as reserve proxy
                let totalVolumeChange = 0;
                let count = 0;
                exchanges.forEach((exchange) => {
                    if (exchange.VOLUME24HOURTO && exchange.VOLUME24HOURTO > 0) {
                        const volumeChange = exchange.VOLUME24HOURTO;
                        totalVolumeChange += volumeChange;
                        count++;
                    }
                });
                const avgVolumeChange = count > 0 ? totalVolumeChange / count : 0;
                // Normalize to percentage change
                const reserveChange = Math.max(-50, Math.min(50, (avgVolumeChange / 1000000) - 1));
                return reserveChange;
            }
            catch (error) {
                const status = error.response?.status;
                const errorMessage = error.response?.data?.Message || error.message;
                const errorCode = error.code || error.response?.data?.code;
                lastError = error;
                if (status === 401 || status === 403) {
                    logger_1.logger.warn({ status, errorMessage, symbol }, 'CryptoCompare API authentication failed, using fallback');
                    return 0;
                }
                if (errorCode === 'ENOTFOUND' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                    if (retryCount < maxRetries - 1) {
                        logger_1.logger.warn({ errorCode, errorMessage, symbol, retryCount: retryCount + 1, maxRetries }, 'CryptoCompare API unavailable - network/DNS issue, retrying...');
                        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
                        continue;
                    }
                    else {
                        logger_1.logger.warn({ errorCode, errorMessage, symbol, retryCount }, 'CryptoCompare API unavailable after all retries, using fallback');
                        return 0;
                    }
                }
                logger_1.logger.warn({ error: errorMessage, status, symbol, errorCode }, 'CryptoCompare reserves API error, using fallback');
                return 0;
            }
        }
        const errorMessage = lastError?.response?.data?.Message || lastError?.message || 'Unknown error';
        const researchError = new Error(`CryptoCompare API error after retries: ${errorMessage}`);
        researchError.statusCode = 400;
        throw researchError;
    }
    /**
     * Get on-chain metrics (mining data)
     */
    async getOnChainMetrics(symbol) {
        const baseSymbol = symbol.replace(/USDT$/i, '').replace(/USD$/i, '');
        let lastError = null;
        const maxRetries = 3;
        for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
            try {
                const response = await this.httpClient.get('/data/blockchain/mining', {
                    params: {
                        fsym: baseSymbol,
                        tsym: 'USD',
                        api_key: this.apiKey,
                    },
                });
                apiUsageTracker_1.apiUsageTracker.increment('cryptocompare');
                // Extract miner outflow from mining data
                const data = response.data?.Data;
                if (!data)
                    return 0;
                // Use mining difficulty and hashrate as miner activity proxy
                const difficulty = data.difficulty || 0;
                const hashrate = data.hashrate || 0;
                // Normalize to 0-100 scale
                const minerOutflow = Math.min(100, Math.max(0, (difficulty / 1000000000000) + (hashrate / 1000000000000000)));
                return minerOutflow;
            }
            catch (error) {
                const status = error.response?.status;
                const errorMessage = error.response?.data?.Message || error.message;
                const errorCode = error.code || error.response?.data?.code;
                lastError = error;
                if (status === 401 || status === 403) {
                    logger_1.logger.warn({ status, errorMessage, symbol }, 'CryptoCompare API authentication failed, using fallback');
                    return 0;
                }
                if (errorCode === 'ENOTFOUND' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                    if (retryCount < maxRetries - 1) {
                        logger_1.logger.warn({ errorCode, errorMessage, symbol, retryCount: retryCount + 1, maxRetries }, 'CryptoCompare API unavailable - network/DNS issue, retrying...');
                        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
                        continue;
                    }
                    else {
                        logger_1.logger.warn({ errorCode, errorMessage, symbol, retryCount }, 'CryptoCompare API unavailable after all retries, using fallback');
                        return 0;
                    }
                }
                logger_1.logger.warn({ error: errorMessage, status, symbol, errorCode }, 'CryptoCompare on-chain API error, using fallback');
                return 0;
            }
        }
        const errorMessage = lastError?.response?.data?.Message || lastError?.message || 'Unknown error';
        logger_1.logger.warn({ symbol, error: errorMessage }, 'CryptoCompare on-chain API failed after all retries, using fallback');
        return 0;
    }
    /**
     * Get funding rate data
     */
    async getFundingRate(symbol) {
        const baseSymbol = symbol.replace(/USDT$/i, '').replace(/USD$/i, '');
        let lastError = null;
        const maxRetries = 3;
        for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
            try {
                const response = await this.httpClient.get('/data/futures', {
                    params: {
                        fsym: baseSymbol,
                        tsym: 'USDT',
                        api_key: this.apiKey,
                    },
                });
                apiUsageTracker_1.apiUsageTracker.increment('cryptocompare');
                // Extract funding rate from futures data
                const data = response.data?.Data;
                if (!data)
                    return 0;
                // Look for funding rate in the response
                let fundingRate = 0;
                if (Array.isArray(data)) {
                    const btcData = data.find((item) => item.symbol?.includes(baseSymbol));
                    if (btcData?.funding_rate) {
                        fundingRate = parseFloat(btcData.funding_rate) || 0;
                    }
                }
                else if (data.funding_rate) {
                    fundingRate = parseFloat(data.funding_rate) || 0;
                }
                // Convert to percentage and normalize
                return fundingRate * 100;
            }
            catch (error) {
                const status = error.response?.status;
                const errorMessage = error.response?.data?.Message || error.message;
                const errorCode = error.code || error.response?.data?.code;
                lastError = error;
                if (status === 401 || status === 403) {
                    logger_1.logger.warn({ status, errorMessage, symbol }, 'CryptoCompare API authentication failed');
                    throw new Error(`CryptoCompare API authentication failed: ${errorMessage}`);
                }
                if (errorCode === 'ENOTFOUND' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                    if (retryCount < maxRetries - 1) {
                        logger_1.logger.warn({ errorCode, errorMessage, symbol, retryCount: retryCount + 1, maxRetries }, 'CryptoCompare API unavailable - network/DNS issue, retrying...');
                        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
                        continue;
                    }
                    else {
                        logger_1.logger.error({ errorCode, errorMessage, symbol, retryCount }, 'CryptoCompare API unavailable after all retries');
                        const researchError = new Error('CryptoCompare API unavailable, please try again.');
                        researchError.statusCode = 400;
                        throw researchError;
                    }
                }
                logger_1.logger.warn({ error: errorMessage, status, symbol, errorCode }, 'CryptoCompare funding rate API error');
                throw new Error(`CryptoCompare API error: ${errorMessage}`);
            }
        }
        const errorMessage = lastError?.response?.data?.Message || lastError?.message || 'Unknown error';
        const researchError = new Error(`CryptoCompare API error after retries: ${errorMessage}`);
        researchError.statusCode = 400;
        throw researchError;
    }
    /**
     * Get liquidation data
     */
    async getLiquidationData(symbol) {
        const baseSymbol = symbol.replace(/USDT$/i, '').replace(/USD$/i, '');
        let lastError = null;
        const maxRetries = 3;
        for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
            try {
                const response = await this.httpClient.get('/data/v2/liquidation', {
                    params: {
                        fsym: baseSymbol,
                        tsym: 'USDT',
                        limit: 1,
                        api_key: this.apiKey,
                    },
                });
                apiUsageTracker_1.apiUsageTracker.increment('cryptocompare');
                // Extract liquidation data
                const data = response.data?.Data || [];
                if (data.length === 0)
                    return 0;
                const latestData = data[0];
                // Safely extract total liquidations with fallback
                const totalLiquidations = latestData?.total || 0;
                // Normalize to 0-100 scale based on liquidation volume
                const liquidations = Math.min(100, Math.max(0, totalLiquidations / 1000000));
                return liquidations;
            }
            catch (error) {
                const status = error.response?.status;
                const errorMessage = error.response?.data?.Message || error.message;
                const errorCode = error.code || error.response?.data?.code;
                lastError = error;
                if (status === 401 || status === 403) {
                    logger_1.logger.warn({ status, errorMessage, symbol }, 'CryptoCompare API authentication failed');
                    throw new Error(`CryptoCompare API authentication failed: ${errorMessage}`);
                }
                if (errorCode === 'ENOTFOUND' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                    if (retryCount < maxRetries - 1) {
                        logger_1.logger.warn({ errorCode, errorMessage, symbol, retryCount: retryCount + 1, maxRetries }, 'CryptoCompare API unavailable - network/DNS issue, retrying...');
                        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
                        continue;
                    }
                    else {
                        logger_1.logger.error({ errorCode, errorMessage, symbol, retryCount }, 'CryptoCompare API unavailable after all retries');
                        const researchError = new Error('CryptoCompare API unavailable, please try again.');
                        researchError.statusCode = 400;
                        throw researchError;
                    }
                }
                logger_1.logger.warn({ error: errorMessage, status, symbol, errorCode }, 'CryptoCompare liquidations API error');
                throw new Error(`CryptoCompare API error: ${errorMessage}`);
            }
        }
        const errorMessage = lastError?.response?.data?.Message || lastError?.message || 'Unknown error';
        const researchError = new Error(`CryptoCompare API error after retries: ${errorMessage}`);
        researchError.statusCode = 400;
        throw researchError;
    }
    /**
     * Get OHLC data and calculate indicators
     */
    async getAllMetrics(symbol) {
        // Return neutral defaults if no API key
        if (!this.apiKey || !this.httpClient) {
            logger_1.logger.debug({ symbol }, 'CryptoCompare returning neutral defaults (no API key)');
            return {
                ohlc: [],
                indicators: {
                    rsi: 50, // Neutral RSI
                    macd: { value: 0, signal: 0, histogram: 0 }, // Neutral MACD
                    ema12: null,
                    ema26: null,
                    sma20: null,
                },
                market: {},
            };
        }
        try {
            // Get OHLC data for the last 100 periods (5m intervals = ~8 hours)
            const ohlc = await this.getOHLC(symbol, '5m', 100);
            // If OHLC data is null (invalid format), return neutral defaults
            if (!ohlc) {
                return {
                    ohlc: [],
                    indicators: {
                        rsi: 50, // Neutral RSI
                        macd: { value: 0, signal: 0, histogram: 0 }, // Neutral MACD
                        ema12: null,
                        ema26: null,
                        sma20: null,
                    },
                    market: {},
                };
            }
            // Calculate indicators
            const indicators = this.calculateIndicators(ohlc);
            // Get market data
            const market = await this.getMarketData(symbol);
            return {
                ohlc,
                indicators,
                market,
            };
        }
        catch (error) {
            // Since we have an API key, we should not fall back to empty data - throw error instead
            logger_1.logger.warn({ error: error.message, symbol }, 'CryptoCompare data fetch failed');
            throw new Error(`CryptoCompare data fetch failed: ${error.message}`);
        }
    }
    /**
     * Get OHLC data from CryptoCompare for specific timeframes
     */
    async getOHLC(symbol, timeframe, limit = 200) {
        // Return fallback OHLC data if no API key
        if (!this.apiKey || !this.httpClient) {
            logger_1.logger.debug({ symbol, timeframe }, 'CryptoCompare OHLC returning fallback data (no API key)');
            return this.getFallbackOHLC(symbol, timeframe, limit);
        }
        try {
            // Map timeframe to CryptoCompare aggregate values
            const aggregateMap = {
                '5m': 5,
                '15m': 15,
                '1h': 60,
            };
            const response = await this.httpClient.get('/data/histominute', {
                params: {
                    fsym: symbol.replace('USDT', '').replace('USD', ''),
                    tsym: 'USD',
                    limit,
                    aggregate: aggregateMap[timeframe],
                },
            });
            apiUsageTracker_1.apiUsageTracker.increment('cryptocompare');
            // Try multiple possible data paths
            let raw = response.data?.Data?.Data?.Candles || response.data?.Data?.Data || response.data?.Data || [];
            if (!Array.isArray(raw)) {
                // Silently return null - let fallback handle gracefully without logging
                return null;
            }
            const result = raw.map((item) => ({
                time: item.time,
                open: parseFloat(item.open) || 0,
                high: parseFloat(item.high) || 0,
                low: parseFloat(item.low) || 0,
                close: parseFloat(item.close) || 0,
                volume: parseFloat(item.volumefrom) || 0,
            }));
            logger_1.logger.debug({ symbol, timeframe, count: result.length }, 'CryptoCompare OHLC data parsed successfully');
            return result;
        }
        catch (error) {
            logger_1.logger.warn({ symbol, timeframe, error: error.message }, 'Failed to get OHLC data from CryptoCompare');
            // Since we have an API key, we should not fall back to synthetic data - throw error instead
            throw new Error(`CryptoCompare OHLC data fetch failed: ${error.message}`);
        }
    }
    getFallbackOHLC(symbol, timeframe, limit) {
        // Generate synthetic OHLC data for fallback
        const now = Date.now();
        const intervalMs = timeframe === '5m' ? 5 * 60 * 1000 :
            timeframe === '15m' ? 15 * 60 * 1000 : 60 * 60 * 1000;
        const fallback = [];
        for (let i = 0; i < Math.min(limit, 50); i++) {
            const time = now - (i * intervalMs);
            const basePrice = 50000; // Neutral BTC price
            const variance = basePrice * 0.01; // 1% variance
            const open = basePrice + (Math.random() - 0.5) * variance;
            const close = basePrice + (Math.random() - 0.5) * variance;
            const high = Math.max(open, close) + Math.random() * variance * 0.5;
            const low = Math.min(open, close) - Math.random() * variance * 0.5;
            fallback.push({
                time: Math.floor(time / 1000),
                open,
                high,
                low,
                close,
                volume: Math.random() * 1000,
            });
        }
        logger_1.logger.debug({ symbol, timeframe, count: fallback.length }, 'Generated fallback OHLC data');
        return fallback.reverse(); // Return in chronological order
    }
    /**
     * Get MTF indicators for a specific timeframe
     */
    async getMTFIndicators(symbol, timeframe) {
        // Return neutral defaults if no API key
        if (!this.apiKey || !this.httpClient) {
            logger_1.logger.debug({ symbol, timeframe }, 'CryptoCompare MTF returning neutral defaults (no API key)');
            return {
                timeframe,
                rsi: 50, // Neutral RSI
                macd: { value: 0, signal: 0, histogram: 0 }, // Neutral MACD
                ema12: null,
                ema26: null,
                sma20: null,
            };
        }
        try {
            const ohlc = await this.getOHLC(symbol, timeframe, 200);
            if (!ohlc || ohlc.length < 26) { // Need at least 26 periods for MACD
                return {
                    timeframe,
                    rsi: null,
                    macd: null,
                    ema12: null,
                    ema26: null,
                    sma20: null,
                };
            }
            const closes = ohlc.map(c => c.close).filter(Number.isFinite);
            const rsi = this.calculateRSI(closes, 14);
            const macd = this.calculateMACD(closes, 12, 26, 9);
            const ema12 = this.calculateEMA(closes, 12);
            const ema26 = this.calculateEMA(closes, 26);
            const sma20 = this.calculateSMA(closes, 20);
            return {
                timeframe,
                rsi: rsi || null,
                macd: macd || null,
                ema12: ema12 || null,
                ema26: ema26 || null,
                sma20: sma20 || null,
            };
        }
        catch (error) {
            logger_1.logger.warn({ symbol, timeframe, error: error.message }, 'Failed to get MTF indicators from CryptoCompare');
            // Since we have an API key, we should not fall back to defaults - throw error instead
            throw new Error(`CryptoCompare MTF indicators failed: ${error.message}`);
        }
    }
    /**
     * Calculate MTF confluence score
     */
    calculateMTFConfluence(mtfData) {
        let points = 0;
        const details = {
            "5m": "No data",
            "15m": "No data",
            "1h": "No data",
        };
        // 5m RSI > 55
        if (mtfData["5m"].rsi && mtfData["5m"].rsi > 55) {
            points += 1;
            details["5m"] = `RSI ${mtfData["5m"].rsi?.toFixed(1)} > 55`;
        }
        else if (mtfData["5m"].rsi) {
            details["5m"] = `RSI ${mtfData["5m"].rsi?.toFixed(1)} ≤ 55`;
        }
        // 15m MACD histogram > 0
        if (mtfData["15m"].macd && mtfData["15m"].macd.histogram > 0) {
            points += 1;
            details["15m"] = `MACD hist ${mtfData["15m"].macd.histogram.toFixed(4)} > 0`;
        }
        else if (mtfData["15m"].macd) {
            details["15m"] = `MACD hist ${mtfData["15m"].macd?.histogram.toFixed(4)} ≤ 0`;
        }
        // 1h EMA12 > EMA26
        if (mtfData["1h"].ema12 && mtfData["1h"].ema26 && mtfData["1h"].ema12 > mtfData["1h"].ema26) {
            points += 1;
            details["1h"] = `EMA12 ${mtfData["1h"].ema12?.toFixed(2)} > EMA26 ${mtfData["1h"].ema26?.toFixed(2)}`;
        }
        else if (mtfData["1h"].ema12 && mtfData["1h"].ema26) {
            details["1h"] = `EMA12 ${mtfData["1h"].ema12?.toFixed(2)} ≤ EMA26 ${mtfData["1h"].ema26?.toFixed(2)}`;
        }
        return {
            score: points,
            maxScore: 3,
            label: `${points}/3`,
            details,
        };
    }
    /**
     * Calculate technical indicators from OHLC data
     */
    calculateIndicators(ohlc) {
        if (!ohlc || ohlc.length < 14) {
            return {};
        }
        const closes = ohlc.map(c => c.close).filter(Number.isFinite);
        const volumes = ohlc.map(c => c.volume).filter(Number.isFinite);
        if (closes.length < 14) {
            return {};
        }
        const indicators = {};
        try {
            // RSI (14 period)
            indicators.rsi = this.calculateRSI(closes, 14);
            // MACD (12, 26, 9)
            indicators.macd = this.calculateMACD(closes, 12, 26, 9);
            // EMA12
            indicators.ema12 = this.calculateEMA(closes, 12);
            // EMA26
            indicators.ema26 = this.calculateEMA(closes, 26);
            // SMA20
            indicators.sma20 = this.calculateSMA(closes, 20);
        }
        catch (error) {
            logger_1.logger.warn({ error: error.message }, 'Failed to calculate indicators');
        }
        return indicators;
    }
    /**
     * Get market data from CryptoCompare
     */
    async getMarketData(symbol) {
        try {
            const response = await this.httpClient.get('/data/pricemultifull', {
                params: {
                    fsyms: symbol.replace('USDT', '').replace('USD', ''),
                    tsyms: 'USD',
                },
            });
            apiUsageTracker_1.apiUsageTracker.increment('cryptocompare');
            const data = response.data?.RAW?.[symbol.replace('USDT', '').replace('USD', '')]?.USD;
            if (!data) {
                return {};
            }
            return {
                marketCap: parseFloat(data.MKTCAP) || undefined,
                priceChange24h: parseFloat(data.CHANGE24HOUR) || undefined,
                priceChangePercent24h: parseFloat(data.CHANGEPCT24HOUR) || undefined,
            };
        }
        catch (error) {
            logger_1.logger.warn({ symbol, error: error.message }, 'Failed to get market data from CryptoCompare');
            return {};
        }
    }
    /**
     * Calculate RSI
     */
    calculateRSI(prices, period = 14) {
        if (prices.length < period + 1)
            return undefined;
        const gains = [];
        const losses = [];
        for (let i = 1; i < prices.length; i++) {
            const change = prices[i] - prices[i - 1];
            gains.push(Math.max(change, 0));
            losses.push(Math.max(-change, 0));
        }
        // Calculate initial averages
        let avgGain = gains.slice(0, period).reduce((sum, gain) => sum + gain, 0) / period;
        let avgLoss = losses.slice(0, period).reduce((sum, loss) => sum + loss, 0) / period;
        // Smooth the averages
        for (let i = period; i < gains.length; i++) {
            avgGain = (avgGain * (period - 1) + gains[i]) / period;
            avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
        }
        if (avgLoss === 0)
            return 100;
        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        return Number.isFinite(rsi) ? rsi : undefined;
    }
    /**
     * Calculate MACD
     */
    calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        if (prices.length < slowPeriod + signalPeriod)
            return undefined;
        const ema12 = this.calculateEMA(prices, fastPeriod);
        const ema26 = this.calculateEMA(prices, slowPeriod);
        if (!ema12 || !ema26)
            return undefined;
        const macd = ema12 - ema26;
        // Calculate signal line (EMA9 of MACD)
        const macdValues = [];
        for (let i = slowPeriod - 1; i < prices.length; i++) {
            const fastEMA = this.calculateEMA(prices.slice(0, i + 1), fastPeriod);
            const slowEMA = this.calculateEMA(prices.slice(0, i + 1), slowPeriod);
            if (fastEMA && slowEMA) {
                macdValues.push(fastEMA - slowEMA);
            }
        }
        if (macdValues.length < signalPeriod)
            return undefined;
        const signal = this.calculateEMA(macdValues, signalPeriod);
        if (!signal)
            return undefined;
        const histogram = macd - signal;
        return {
            value: macd,
            signal,
            histogram,
        };
    }
    /**
     * Calculate EMA
     */
    calculateEMA(prices, period) {
        if (prices.length < period)
            return undefined;
        const multiplier = 2 / (period + 1);
        let ema = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
        for (let i = period; i < prices.length; i++) {
            ema = (prices[i] - ema) * multiplier + ema;
        }
        return Number.isFinite(ema) ? ema : undefined;
    }
    /**
     * Calculate SMA
     */
    calculateSMA(prices, period) {
        if (prices.length < period)
            return undefined;
        const sum = prices.slice(-period).reduce((acc, price) => acc + price, 0);
        const sma = sum / period;
        return Number.isFinite(sma) ? sma : undefined;
    }
}
exports.CryptoCompareAdapter = CryptoCompareAdapter;
