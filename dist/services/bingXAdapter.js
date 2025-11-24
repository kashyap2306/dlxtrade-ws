"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BingXAdapter = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = require("../utils/logger");
const errors_1 = require("../utils/errors");
class BingXAdapter {
    constructor(apiKey, apiSecret, testnet = true) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.baseUrl = testnet
            ? 'https://open-api-sandbox.bingx.com'
            : 'https://open-api.bingx.com';
        this.httpClient = axios_1.default.create({
            baseURL: this.baseUrl,
            timeout: 10000,
            headers: {
                'X-BX-APIKEY': this.apiKey,
                'Content-Type': 'application/json',
            },
        });
    }
    getExchangeName() {
        return 'bingx';
    }
    sign(timestamp, queryString) {
        const message = timestamp + queryString;
        return crypto_1.default
            .createHmac('sha256', this.apiSecret)
            .update(message)
            .digest('hex');
    }
    async request(method, endpoint, params = {}, signed = false) {
        const timestamp = Date.now().toString();
        let queryString = '';
        if (method === 'GET') {
            queryString = Object.keys(params)
                .map((key) => `${key}=${encodeURIComponent(params[key])}`)
                .join('&');
            endpoint = queryString ? `${endpoint}?${queryString}` : endpoint;
        }
        const headers = {
            'X-BX-APIKEY': this.apiKey,
            'X-BX-TIMESTAMP': timestamp,
            'Content-Type': 'application/json',
        };
        if (signed) {
            const signature = this.sign(timestamp, queryString);
            headers['X-BX-SIGNATURE'] = signature;
        }
        try {
            const response = await this.httpClient.request({
                method,
                url: endpoint,
                params: method === 'GET' ? undefined : params,
                data: method !== 'GET' ? params : undefined,
                headers,
            });
            return response.data;
        }
        catch (error) {
            logger_1.logger.error({ error, endpoint, params }, 'BingX API error');
            throw new errors_1.ExchangeError(error.response?.data?.msg || error.message || 'BingX API error', error.response?.status || 500);
        }
    }
    async getOrderbook(symbol, limit = 20) {
        const data = await this.request('GET', '/openApi/spot/v1/market/depth', {
            symbol: symbol.toUpperCase(),
            limit,
        });
        return {
            symbol: data.data?.symbol || symbol,
            bids: (data.data?.bids || []).map(([price, qty]) => ({
                price,
                quantity: qty,
            })),
            asks: (data.data?.asks || []).map(([price, qty]) => ({
                price,
                quantity: qty,
            })),
            lastUpdateId: data.data?.lastUpdateId || Date.now(),
        };
    }
    async getTicker(symbol) {
        if (symbol) {
            const data = await this.request('GET', '/openApi/spot/v1/ticker/24hr', {
                symbol: symbol.toUpperCase(),
            });
            return data.data;
        }
        else {
            // Get all tickers
            const data = await this.request('GET', '/openApi/spot/v1/ticker/24hr', {});
            return data.data || [];
        }
    }
    async getKlines(symbol, interval = '1m', limit = 100) {
        const data = await this.request('GET', '/openApi/spot/v1/market/klines', {
            symbol: symbol.toUpperCase(),
            interval,
            limit,
        });
        return data.data || [];
    }
    async testConnection() {
        try {
            // Test with account info endpoint
            const response = await this.request('GET', '/openApi/account/v1/info', {}, true);
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
            return await this.request('GET', '/openApi/account/v1/info', {}, true);
        }
        catch (error) {
            logger_1.logger.error({ error }, 'Error getting BingX account');
            return { error: error.message || 'Failed to get account' };
        }
    }
    async placeOrder(params) {
        try {
            const { symbol, side, type = 'MARKET', quantity, price } = params;
            const orderParams = {
                symbol: symbol.toUpperCase(),
                side,
                type,
                quantity: quantity.toString(),
            };
            if (type === 'LIMIT' && price) {
                orderParams.price = price.toString();
            }
            const response = await this.request('POST', '/openApi/spot/v1/trade', orderParams, true);
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
            logger_1.logger.error({ error }, 'Error placing BingX order');
            throw error;
        }
    }
}
exports.BingXAdapter = BingXAdapter;
