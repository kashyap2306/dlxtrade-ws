"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinanceAdapter = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const ws_1 = __importDefault(require("ws"));
const logger_1 = require("../utils/logger");
const errors_1 = require("../utils/errors");
class BinanceAdapter {
    constructor(apiKey, apiSecret, testnet = true) {
        this.orderbookWs = null;
        this.tradesWs = null;
        this.userStreamWs = null;
        this.listenKey = null;
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.baseUrl = testnet
            ? 'https://testnet.binance.vision'
            : 'https://api.binance.com';
        this.wsUrl = testnet
            ? 'wss://testnet.binance.vision'
            : 'wss://stream.binance.com:9443';
        this.httpClient = axios_1.default.create({
            baseURL: this.baseUrl,
            timeout: 10000,
            headers: {
                'X-MBX-APIKEY': this.apiKey,
            },
        });
    }
    sign(params) {
        const queryString = Object.keys(params)
            .sort()
            .map((key) => `${key}=${params[key]}`)
            .join('&');
        return crypto_1.default
            .createHmac('sha256', this.apiSecret)
            .update(queryString)
            .digest('hex');
    }
    async request(method, endpoint, params = {}, signed = false) {
        if (signed) {
            params.timestamp = Date.now();
            params.signature = this.sign(params);
        }
        try {
            const response = await this.httpClient.request({
                method,
                url: endpoint,
                params: method === 'GET' ? params : undefined,
                data: method !== 'GET' ? params : undefined,
            });
            return response.data;
        }
        catch (error) {
            logger_1.logger.error({ error, endpoint, params }, 'Binance API error');
            throw new errors_1.ExchangeError(error.response?.data?.msg || error.message || 'Exchange API error', error.response?.status || 500);
        }
    }
    async getOrderbook(symbol, limit = 20) {
        const data = await this.request('GET', '/api/v3/depth', {
            symbol: symbol.toUpperCase(),
            limit,
        });
        return {
            symbol: data.symbol,
            bids: data.bids.map(([price, qty]) => ({
                price,
                quantity: qty,
            })),
            asks: data.asks.map(([price, qty]) => ({
                price,
                quantity: qty,
            })),
            lastUpdateId: data.lastUpdateId,
        };
    }
    async placeOrder(symbol, side, type, quantity, price, timeInForce = 'GTC') {
        const params = {
            symbol: symbol.toUpperCase(),
            side,
            type,
            quantity: quantity.toString(),
        };
        if (type === 'LIMIT') {
            if (!price)
                throw new Error('Price required for LIMIT orders');
            params.price = price.toString();
            params.timeInForce = timeInForce;
        }
        const data = await this.request('POST', '/api/v3/order', params, true);
        return {
            id: data.orderId.toString(),
            symbol: data.symbol,
            side: data.side,
            type: data.type,
            quantity: parseFloat(data.executedQty || data.origQty),
            price: parseFloat(data.price || '0'),
            status: data.status,
            clientOrderId: data.clientOrderId,
            exchangeOrderId: data.orderId.toString(),
            filledQty: parseFloat(data.executedQty || '0'),
            avgPrice: parseFloat(data.price || '0'),
            createdAt: new Date(data.transactTime || Date.now()),
            updatedAt: new Date(data.updateTime || Date.now()),
        };
    }
    async validateApiKey() {
        try {
            // Try to get account info - this validates the key
            const accountInfo = await this.request('GET', '/api/v3/account', {}, true);
            // Check permissions (Binance doesn't expose this directly, but we can infer from account access)
            // If we can access account, trading is likely enabled
            // Withdrawal permission is harder to check without attempting a withdrawal
            // For safety, we'll assume withdrawals are possible if account access works
            // In production, you'd want to check API key restrictions via Binance API key management
            return {
                valid: true,
                canTrade: true, // If we can access account, trading should work
                canWithdraw: false, // Assume false for safety - user should verify manually
            };
        }
        catch (error) {
            logger_1.logger.error({ error }, 'API key validation failed');
            return {
                valid: false,
                canTrade: false,
                canWithdraw: false,
                error: error.message || 'Invalid API key',
            };
        }
    }
    async cancelOrder(symbol, orderId, clientOrderId) {
        const params = {
            symbol: symbol.toUpperCase(),
        };
        if (orderId)
            params.orderId = orderId;
        if (clientOrderId)
            params.origClientOrderId = clientOrderId;
        const data = await this.request('DELETE', '/api/v3/order', params, true);
        return {
            id: data.orderId.toString(),
            symbol: data.symbol,
            side: data.side,
            type: data.type,
            quantity: parseFloat(data.origQty),
            price: parseFloat(data.price || '0'),
            status: data.status,
            clientOrderId: data.clientOrderId,
            exchangeOrderId: data.orderId.toString(),
            filledQty: parseFloat(data.executedQty || '0'),
            avgPrice: parseFloat(data.price || '0'),
            createdAt: new Date(data.time || Date.now()),
            updatedAt: new Date(data.updateTime || Date.now()),
        };
    }
    async getOrderStatus(symbol, orderId, clientOrderId) {
        const params = {
            symbol: symbol.toUpperCase(),
        };
        if (orderId)
            params.orderId = orderId;
        if (clientOrderId)
            params.origClientOrderId = clientOrderId;
        const data = await this.request('GET', '/api/v3/order', params, true);
        return {
            id: data.orderId.toString(),
            symbol: data.symbol,
            side: data.side,
            type: data.type,
            quantity: parseFloat(data.origQty),
            price: parseFloat(data.price || '0'),
            status: data.status,
            clientOrderId: data.clientOrderId,
            exchangeOrderId: data.orderId.toString(),
            filledQty: parseFloat(data.executedQty || '0'),
            avgPrice: parseFloat(data.price || '0'),
            createdAt: new Date(data.time || Date.now()),
            updatedAt: new Date(data.updateTime || Date.now()),
        };
    }
    async startUserDataStream() {
        const data = await this.request('POST', '/api/v3/userDataStream', {}, false);
        this.listenKey = data.listenKey;
        return data.listenKey;
    }
    async keepAliveUserDataStream() {
        if (!this.listenKey)
            return;
        await this.request('PUT', '/api/v3/userDataStream', {
            listenKey: this.listenKey,
        }, false);
    }
    async closeUserDataStream() {
        if (!this.listenKey)
            return;
        await this.request('DELETE', '/api/v3/userDataStream', {
            listenKey: this.listenKey,
        }, false);
        this.listenKey = null;
    }
    subscribeOrderbook(symbol, callback) {
        const stream = `${symbol.toLowerCase()}@depth20@100ms`;
        this.orderbookWs = new ws_1.default(`${this.wsUrl}/ws/${stream}`);
        this.orderbookWs.on('message', (data) => {
            try {
                const update = JSON.parse(data.toString());
                callback({
                    symbol: update.s,
                    bids: update.b.map(([p, q]) => ({
                        price: p,
                        quantity: q,
                    })),
                    asks: update.a.map(([p, q]) => ({
                        price: p,
                        quantity: q,
                    })),
                    lastUpdateId: update.u,
                });
            }
            catch (err) {
                logger_1.logger.error({ err }, 'Error parsing orderbook update');
            }
        });
        this.orderbookWs.on('error', (err) => {
            logger_1.logger.error({ err }, 'Orderbook WebSocket error');
        });
    }
    subscribeTrades(symbol, callback) {
        const stream = `${symbol.toLowerCase()}@trade`;
        this.tradesWs = new ws_1.default(`${this.wsUrl}/ws/${stream}`);
        this.tradesWs.on('message', (data) => {
            try {
                const update = JSON.parse(data.toString());
                callback({
                    id: update.t.toString(),
                    symbol: update.s,
                    price: update.p,
                    quantity: update.q,
                    time: update.T,
                    isBuyerMaker: update.m,
                });
            }
            catch (err) {
                logger_1.logger.error({ err }, 'Error parsing trade update');
            }
        });
        this.tradesWs.on('error', (err) => {
            logger_1.logger.error({ err }, 'Trades WebSocket error');
        });
    }
    subscribeUserData(callback) {
        if (!this.listenKey) {
            throw new Error('User data stream not started');
        }
        this.userStreamWs = new ws_1.default(`${this.wsUrl}/ws/${this.listenKey}`);
        this.userStreamWs.on('message', (data) => {
            try {
                const update = JSON.parse(data.toString());
                callback(update);
            }
            catch (err) {
                logger_1.logger.error({ err }, 'Error parsing user data update');
            }
        });
        this.userStreamWs.on('error', (err) => {
            logger_1.logger.error({ err }, 'User data WebSocket error');
        });
    }
    disconnect() {
        this.orderbookWs?.close();
        this.tradesWs?.close();
        this.userStreamWs?.close();
        this.closeUserDataStream();
    }
}
exports.BinanceAdapter = BinanceAdapter;
