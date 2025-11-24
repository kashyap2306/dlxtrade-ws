"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExchangeConnectorFactory = exports.OkxAdapter = exports.MexcAdapter = exports.BybitAdapter = void 0;
const binanceAdapter_1 = require("./binanceAdapter");
const bitgetAdapter_1 = require("./bitgetAdapter");
const weexAdapter_1 = require("./weexAdapter");
const bingXAdapter_1 = require("./bingXAdapter");
const kucoinAdapter_1 = require("./kucoinAdapter");
// Stub adapters for exchanges not yet implemented
class BybitAdapter {
    constructor(apiKey, secret, testnet = true) {
        // Store credentials but throw error on actual usage
        this.apiKey = apiKey;
        this.secret = secret;
        this.testnet = testnet;
    }
    getExchangeName() {
        return 'bybit';
    }
    async getOrderbook(symbol, limit) {
        throw new Error('Bybit exchange integration not yet implemented');
    }
    async getTicker(symbol) {
        throw new Error('Bybit exchange integration not yet implemented');
    }
    async getKlines(symbol, interval, limit) {
        throw new Error('Bybit exchange integration not yet implemented');
    }
    async testConnection() {
        throw new Error('Bybit exchange integration not yet implemented');
    }
}
exports.BybitAdapter = BybitAdapter;
class MexcAdapter {
    constructor(apiKey, secret, testnet = true) {
        // Store credentials but throw error on actual usage
        this.apiKey = apiKey;
        this.secret = secret;
        this.testnet = testnet;
    }
    getExchangeName() {
        return 'mexc';
    }
    async getOrderbook(symbol, limit) {
        throw new Error('MEXC exchange integration not yet implemented');
    }
    async getTicker(symbol) {
        throw new Error('MEXC exchange integration not yet implemented');
    }
    async getKlines(symbol, interval, limit) {
        throw new Error('MEXC exchange integration not yet implemented');
    }
    async testConnection() {
        throw new Error('MEXC exchange integration not yet implemented');
    }
}
exports.MexcAdapter = MexcAdapter;
class OkxAdapter {
    constructor(apiKey, secret, testnet = true) {
        // Store credentials but throw error on actual usage
        this.apiKey = apiKey;
        this.secret = secret;
        this.testnet = testnet;
    }
    getExchangeName() {
        return 'okx';
    }
    async getOrderbook(symbol, limit) {
        throw new Error('OKX exchange integration not yet implemented');
    }
    async getTicker(symbol) {
        throw new Error('OKX exchange integration not yet implemented');
    }
    async getKlines(symbol, interval, limit) {
        throw new Error('OKX exchange integration not yet implemented');
    }
    async testConnection() {
        throw new Error('OKX exchange integration not yet implemented');
    }
}
exports.OkxAdapter = OkxAdapter;
class ExchangeConnectorFactory {
    static create(exchange, credentials) {
        switch (exchange) {
            case 'binance':
                return new binanceAdapter_1.BinanceAdapter(credentials.apiKey, credentials.secret, credentials.testnet ?? true);
            case 'bitget':
                if (!credentials.passphrase) {
                    throw new Error('Passphrase is required for Bitget');
                }
                return new bitgetAdapter_1.BitgetAdapter(credentials.apiKey, credentials.secret, credentials.passphrase, credentials.testnet ?? true);
            case 'weex':
                if (!credentials.passphrase) {
                    throw new Error('Passphrase is required for Weex');
                }
                return new weexAdapter_1.WeexAdapter(credentials.apiKey, credentials.secret, credentials.passphrase, credentials.testnet ?? true);
            case 'bingx':
                return new bingXAdapter_1.BingXAdapter(credentials.apiKey, credentials.secret, credentials.testnet ?? true);
            case 'kucoin':
                if (!credentials.passphrase) {
                    throw new Error('Passphrase is required for KuCoin');
                }
                return new kucoinAdapter_1.KucoinAdapter(credentials.apiKey, credentials.secret, credentials.passphrase, credentials.testnet ?? false);
            case 'bybit':
                return new BybitAdapter(credentials.apiKey, credentials.secret, credentials.testnet ?? true);
            case 'mexc':
                return new MexcAdapter(credentials.apiKey, credentials.secret, credentials.testnet ?? true);
            case 'okx':
                return new OkxAdapter(credentials.apiKey, credentials.secret, credentials.testnet ?? true);
            default:
                throw new Error(`Unsupported exchange: ${exchange}`);
        }
    }
    static getRequiredFields(exchange) {
        switch (exchange) {
            case 'binance':
                return ['apiKey', 'secret'];
            case 'bitget':
                return ['apiKey', 'secret', 'passphrase'];
            case 'weex':
                return ['apiKey', 'secret'];
            case 'bingx':
                return ['apiKey', 'secret'];
            case 'kucoin':
                return ['apiKey', 'secret', 'passphrase'];
            case 'bybit':
                return ['apiKey', 'secret'];
            case 'mexc':
                return ['apiKey', 'secret'];
            case 'okx':
                return ['apiKey', 'secret'];
            default:
                return [];
        }
    }
    static getBaseUrl(exchange, testnet = true) {
        switch (exchange) {
            case 'binance':
                return testnet ? 'https://testnet.binance.vision' : 'https://api.binance.com';
            case 'bitget':
                return testnet ? 'https://api-demo.bitget.com' : 'https://api.bitget.com';
            case 'weex':
                return testnet ? 'https://api-demo.weex.com' : 'https://api.weex.com';
            case 'bingx':
                return testnet ? 'https://open-api-sandbox.bingx.com' : 'https://open-api.bingx.com';
            case 'kucoin':
                return testnet ? 'https://openapi-sandbox.kucoin.com' : 'https://api.kucoin.com';
            case 'bybit':
                return testnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
            case 'mexc':
                return testnet ? 'https://contract.mexc.com' : 'https://api.mexc.com';
            case 'okx':
                return testnet ? 'https://www.okx.com' : 'https://www.okx.com';
            default:
                throw new Error(`Unsupported exchange: ${exchange}`);
        }
    }
}
exports.ExchangeConnectorFactory = ExchangeConnectorFactory;
