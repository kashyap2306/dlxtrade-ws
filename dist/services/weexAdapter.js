"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WeexAdapter = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = require("../utils/logger");
const errors_1 = require("../utils/errors");
class WeexAdapter {
    constructor(apiKey, apiSecret, passphrase, testnet = true) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.passphrase = passphrase;
        this.baseUrl = testnet
            ? 'https://api-demo.weex.com'
            : 'https://api.weex.com';
        this.httpClient = axios_1.default.create({
            baseURL: this.baseUrl,
            timeout: 10000,
            headers: {
                'X-API-KEY': this.apiKey,
                'Content-Type': 'application/json',
            },
        });
    }
    getExchangeName() {
        return 'weex';
    }
    sign(timestamp, method, requestPath, body = '') {
        const message = timestamp + method + requestPath + body;
        return crypto_1.default
            .createHmac('sha256', this.apiSecret)
            .update(message)
            .digest('hex');
    }
    async request(method, endpoint, params = {}, signed = false) {
        const timestamp = Date.now().toString();
        let body = '';
        if (method === 'GET') {
            const queryString = Object.keys(params)
                .map((key) => `${key}=${encodeURIComponent(params[key])}`)
                .join('&');
            endpoint = queryString ? `${endpoint}?${queryString}` : endpoint;
        }
        else {
            body = JSON.stringify(params);
        }
        const headers = {
            'X-API-KEY': this.apiKey,
            'X-TIMESTAMP': timestamp,
            'Content-Type': 'application/json',
        };
        if (signed) {
            const signature = this.sign(timestamp, method, endpoint, body);
            headers['X-SIGNATURE'] = signature;
            if (this.passphrase) {
                headers['X-PASSPHRASE'] = this.passphrase;
            }
        }
        try {
            const response = await this.httpClient.request({
                method,
                url: endpoint,
                data: method !== 'GET' ? body : undefined,
                headers,
            });
            return response.data;
        }
        catch (error) {
            logger_1.logger.error({ error, endpoint, params }, 'WEEX API error');
            throw new errors_1.ExchangeError(error.response?.data?.msg || error.message || 'WEEX API error', error.response?.status || 500);
        }
    }
    async getOrderbook(symbol, limit = 20) {
        const data = await this.request('GET', '/api/v1/market/depth', {
            symbol: symbol.toUpperCase(),
            limit,
        });
        return {
            symbol: data.symbol || symbol,
            bids: (data.bids || []).map(([price, qty]) => ({
                price,
                quantity: qty,
            })),
            asks: (data.asks || []).map(([price, qty]) => ({
                price,
                quantity: qty,
            })),
            lastUpdateId: data.ts || Date.now(),
        };
    }
    async getTicker(symbol) {
        if (symbol) {
            const data = await this.request('GET', '/api/v1/market/ticker', {
                symbol: symbol.toUpperCase(),
            });
            return data;
        }
        else {
            // Get all tickers
            const data = await this.request('GET', '/api/v1/market/tickers', {});
            return data.data || data || [];
        }
    }
    async getKlines(symbol, interval = '1m', limit = 100) {
        const data = await this.request('GET', '/api/v1/market/klines', {
            symbol: symbol.toUpperCase(),
            interval,
            limit,
        });
        return data || [];
    }
    async testConnection() {
        try {
            // Test with account info endpoint
            const response = await this.request('GET', '/api/v1/account/info', {}, true);
            if (response.code === 0 || response.data) {
                return { success: true, message: 'Connection successful' };
            }
            return { success: false, message: response.msg || 'Connection test failed' };
        }
        catch (error) {
            const message = error.message || 'Connection test failed';
            if (message.includes('401') || message.includes('Unauthorized')) {
                return { success: false, message: 'Invalid API key or secret' };
            }
            return { success: false, message };
        }
    }
    async getAccount() {
        try {
            return await this.request('GET', '/api/v1/account/info', {}, true);
        }
        catch (error) {
            logger_1.logger.error({ error }, 'Error getting Weex account');
            return { error: error.message || 'Failed to get account' };
        }
    }
    async placeOrder(params) {
        try {
            const { symbol, side, type = 'MARKET', quantity, price } = params;
            const orderParams = {
                symbol: symbol.toUpperCase(),
                side,
                orderType: type,
                quantity: quantity.toString(),
            };
            if (type === 'LIMIT' && price) {
                orderParams.price = price.toString();
            }
            const response = await this.request('POST', '/api/v1/order/place', orderParams, true);
            return {
                id: response.data?.orderId?.toString() || Date.now().toString(),
                symbol,
                side,
                type,
                quantity,
                price: price || 0,
                status: 'NEW',
                exchangeOrderId: response.data?.orderId?.toString() || '',
            };
        }
        catch (error) {
            logger_1.logger.error({ error }, 'Error placing Weex order');
            throw error;
        }
    }
}
exports.WeexAdapter = WeexAdapter;
