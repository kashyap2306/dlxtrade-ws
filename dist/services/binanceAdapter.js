"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinanceAdapter = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
class BinanceAdapter {
    constructor(apiKey, secret, testnet = false) {
        this.apiKey = apiKey;
        this.secret = secret;
        this.testnet = testnet;
        // Use testnet URL if testnet is enabled
        const baseURL = testnet
            ? 'https://testnet.binance.vision/api/v3'
            : 'https://api.binance.com/api/v3';
        this.httpClient = axios_1.default.create({
            baseURL,
            timeout: 10000,
        });
    }
    getExchangeName() {
        return 'binance';
    }
    async getOrderbook(symbol, limit = 20) {
        const finalSymbol = symbol.replace('-', '').toUpperCase();
        const params = { symbol: finalSymbol, limit: Math.min(Math.max(limit, 5), 1000) };
        try {
            const response = await this.httpClient.get('/depth', { params });
            const data = response.data;
            return {
                symbol: data.symbol || finalSymbol,
                bids: (data.bids || []).map(([price, quantity]) => ({ price, quantity })),
                asks: (data.asks || []).map(([price, quantity]) => ({ price, quantity })),
                lastUpdateId: data.lastUpdateId || Date.now(),
            };
        }
        catch (error) {
            logger_1.logger.warn({ symbol, error: error.message }, '[BinanceAdapter] getOrderbook failed');
            throw error;
        }
    }
    async getTicker(symbol) {
        try {
            const params = symbol ? { symbol: symbol.replace('-', '').toUpperCase() } : undefined;
            const response = await this.httpClient.get('/ticker/24hr', { params });
            return response.data;
        }
        catch (error) {
            logger_1.logger.warn({ symbol, error: error.message }, '[BinanceAdapter] getTicker failed');
            throw error;
        }
    }
    async getBookTicker(symbol) {
        try {
            const params = { symbol: symbol.replace('-', '').toUpperCase() };
            const response = await this.httpClient.get('/ticker/bookTicker', { params });
            return response.data;
        }
        catch (error) {
            logger_1.logger.warn({ symbol, error: error.message }, '[BinanceAdapter] getBookTicker failed');
            throw error;
        }
    }
    async getKlines(symbol, interval, limit = 500) {
        try {
            const finalSymbol = symbol.replace('-', '').toUpperCase();
            const response = await this.httpClient.get('/klines', {
                params: {
                    symbol: finalSymbol,
                    interval,
                    limit: Math.min(limit, 1000)
                }
            });
            return response.data;
        }
        catch (error) {
            logger_1.logger.warn({ symbol, interval, error: error.message }, '[BinanceAdapter] getKlines failed');
            throw error;
        }
    }
    async getVolatility(symbol) {
        try {
            // Fetch 5m candles for last 100 periods (about 8.3 hours)
            const candles = await this.getKlines(symbol, '5m', 100);
            if (!candles || candles.length < 10) {
                return null;
            }
            // Calculate log returns
            const returns = [];
            for (let i = 1; i < candles.length; i++) {
                const prevClose = parseFloat(candles[i - 1][4]); // close price
                const currClose = parseFloat(candles[i][4]); // close price
                if (prevClose > 0 && currClose > 0) {
                    const logReturn = Math.log(currClose / prevClose);
                    if (Number.isFinite(logReturn)) {
                        returns.push(logReturn);
                    }
                }
            }
            if (returns.length < 10) {
                return null;
            }
            // Calculate standard deviation of returns
            const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
            const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
            const dailyVolatility = Math.sqrt(variance);
            // Annualize volatility: sqrt(1440/5) = sqrt(288) ≈ 16.97
            // This converts 5-minute volatility to daily volatility
            const annualizedVolatility = dailyVolatility * Math.sqrt(1440 / 5);
            return Number.isFinite(annualizedVolatility) ? annualizedVolatility : null;
        }
        catch (error) {
            logger_1.logger.warn({ symbol, error: error.message }, '[BinanceAdapter] getVolatility failed');
            return null;
        }
    }
    async testConnection() {
        try {
            await this.getTicker('BTCUSDT');
            return { success: true, message: 'Connection successful' };
        }
        catch (error) {
            return { success: false, message: error.message };
        }
    }
    // For public API, account access is not available
    async getAccount() {
        throw new Error('Binance public API does not support account access. Use authenticated exchange connection instead.');
    }
    // Validate API key (not applicable for public API)
    async validateApiKey() {
        throw new Error('Binance public API does not require API key validation.');
    }
    // Trading methods - not supported for public API
    async placeOrder(params) {
        throw new Error('Binance public API does not support trading operations.');
    }
    async cancelOrder(symbol, orderId, clientOrderId) {
        throw new Error('Binance public API does not support trading operations.');
    }
    async getBalance() {
        throw new Error('Binance public API does not support account operations.');
    }
    async getPositions(symbol) {
        throw new Error('Binance public API does not support account operations.');
    }
    // WebSocket methods - not supported for public API
    subscribeOrderbook(symbol, callback) {
        throw new Error('Binance public API does not support WebSocket subscriptions.');
    }
    subscribeTrades(symbol, callback) {
        throw new Error('Binance public API does not support WebSocket subscriptions.');
    }
    startUserDataStream() {
        throw new Error('Binance public API does not support user data streams.');
    }
    subscribeUserData(callback) {
        throw new Error('Binance public API does not support user data streams.');
    }
    keepAliveUserDataStream() {
        throw new Error('Binance public API does not support user data streams.');
    }
    closeUserDataStream() {
        throw new Error('Binance public API does not support user data streams.');
    }
    disconnect() {
        // No-op for public API
    }
    /**
     * Get market data (price, volume, etc.) - replaces CoinAPI market data
     */
    async getMarketData(symbol) {
        try {
            // Binance uses different symbol format (BTCUSDT instead of BTC_USDT)
            const binanceSymbol = symbol.toUpperCase();
            const response = await this.httpClient.get('/ticker/24hr', {
                params: { symbol: binanceSymbol }
            });
            const data = response.data;
            if (!data) {
                return {};
            }
            return {
                price: parseFloat(data.lastPrice || '0'),
                volume24h: parseFloat(data.volume || '0'),
                priceChange24h: parseFloat(data.priceChange || '0'),
                priceChangePercent24h: parseFloat(data.priceChangePercent || '0'),
            };
        }
        catch (error) {
            logger_1.logger.warn({
                error: error.message,
                status: error.response?.status,
                symbol
            }, 'Binance market data API error');
            return {};
        }
    }
}
exports.BinanceAdapter = BinanceAdapter;
