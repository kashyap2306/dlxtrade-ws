"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExchangeConnectorFactory = void 0;
const binanceAdapter_1 = require("./binanceAdapter");
const bitgetAdapter_1 = require("./bitgetAdapter");
const weexAdapter_1 = require("./weexAdapter");
const bingXAdapter_1 = require("./bingXAdapter");
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
                return new weexAdapter_1.WeexAdapter(credentials.apiKey, credentials.secret, credentials.passphrase, credentials.testnet ?? true);
            case 'bingx':
                return new bingXAdapter_1.BingXAdapter(credentials.apiKey, credentials.secret, credentials.testnet ?? true);
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
            default:
                throw new Error(`Unsupported exchange: ${exchange}`);
        }
    }
}
exports.ExchangeConnectorFactory = ExchangeConnectorFactory;
