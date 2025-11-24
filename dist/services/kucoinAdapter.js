"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KucoinAdapter = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const apiUsageTracker_1 = require("./apiUsageTracker");
const logger_1 = require("../utils/logger");
class KucoinAdapter {
    constructor(apiKey, apiSecret, passphrase, testnet = false) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.passphrase = passphrase;
        const baseURL = testnet ? 'https://openapi-sandbox.kucoin.com' : 'https://api.kucoin.com';
        this.httpClient = axios_1.default.create({
            baseURL,
            timeout: 10000,
        });
    }
    getExchangeName() {
        return 'kucoin';
    }
    sign(timestamp, method, endpoint, params, body) {
        const serializedParams = method.toUpperCase() === 'GET' && Object.keys(params).length > 0
            ? `?${Object.keys(params)
                .map((key) => `${key}=${encodeURIComponent(params[key])}`)
                .join('&')}`
            : '';
        const requestPath = `${endpoint}${serializedParams}`;
        const payload = method.toUpperCase() === 'GET' ? '' : JSON.stringify(body ?? {});
        const preSign = `${timestamp}${method.toUpperCase()}${requestPath}${payload}`;
        return crypto_1.default.createHmac('sha256', this.apiSecret).update(preSign).digest('base64');
    }
    signPassphrase() {
        return crypto_1.default.createHmac('sha256', this.apiSecret).update(this.passphrase).digest('base64');
    }
    async request(method, endpoint, params = {}, body, signed = false) {
        const timestamp = Date.now().toString();
        const headers = {};
        if (signed) {
            headers['KC-API-KEY'] = this.apiKey;
            headers['KC-API-TIMESTAMP'] = timestamp;
            headers['KC-API-SIGN'] = this.sign(timestamp, method, endpoint, params, body);
            headers['KC-API-PASSPHRASE'] = this.signPassphrase();
            headers['KC-API-KEY-VERSION'] = '2';
        }
        try {
            const response = await this.httpClient.request({
                method,
                url: endpoint,
                params: method === 'GET' ? params : undefined,
                data: method === 'POST' ? body : undefined,
                headers,
            });
            apiUsageTracker_1.apiUsageTracker.increment('kucoin');
            return response.data?.data ?? response.data;
        }
        catch (error) {
            logger_1.logger.error({ endpoint, params, error: error.message }, 'KuCoin API request failed');
            throw error;
        }
    }
    normalizeSymbol(symbol) {
        if (symbol.includes('-'))
            return symbol.toUpperCase();
        const upper = symbol.toUpperCase();
        if (upper.endsWith('USDT')) {
            return `${upper.slice(0, -4)}-USDT`;
        }
        return upper;
    }
    async getOrderbook(symbol, limit = 20) {
        const normalized = this.normalizeSymbol(symbol);
        const clampedLimit = Math.min(Math.max(limit, 5), 100);
        const level = clampedLimit <= 20 ? 'level2_20' : 'level2_100';
        const data = await this.request('GET', `/api/v1/market/orderbook/${level}`, { symbol: normalized });
        const bids = (data?.bids || []).map(([price, quantity]) => ({ price, quantity }));
        const asks = (data?.asks || []).map(([price, quantity]) => ({ price, quantity }));
        return {
            symbol: normalized,
            bids,
            asks,
            lastUpdateId: parseInt(data?.sequence || Date.now(), 10),
        };
    }
    async getTicker(symbol) {
        if (symbol) {
            const normalized = this.normalizeSymbol(symbol);
            return this.request('GET', '/api/v1/market/orderbook/level1', { symbol: normalized });
        }
        return this.request('GET', '/api/v1/market/allTickers');
    }
    mapTimeframe(timeframe) {
        const mapping = {
            '1m': '1min',
            '3m': '3min',
            '5m': '5min',
            '15m': '15min',
            '30m': '30min',
            '1h': '1hour',
            '2h': '2hour',
            '4h': '4hour',
            '6h': '6hour',
            '8h': '8hour',
            '12h': '12hour',
            '1d': '1day',
            '1w': '1week',
        };
        return mapping[timeframe.toLowerCase()] || '5min';
    }
    async getKlines(symbol, interval = '1m', limit = 100) {
        const normalized = this.normalizeSymbol(symbol);
        const data = await this.request('GET', '/api/v1/market/candles', {
            symbol: normalized,
            type: this.mapTimeframe(interval),
            limit: Math.min(Math.max(limit, 1), 1500),
        });
        return data || [];
    }
    async testConnection() {
        try {
            await this.getAccount();
            return { success: true, message: 'KuCoin API connection successful' };
        }
        catch (error) {
            return { success: false, message: error.message || 'KuCoin API validation failed' };
        }
    }
    async getAccount() {
        return this.request('GET', '/api/v1/accounts', {}, undefined, true);
    }
}
exports.KucoinAdapter = KucoinAdapter;
