"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoinAPIAdapter = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
class CoinAPIAdapter {
    constructor(apiKey, apiType) {
        this.apiKey = apiKey;
        this.apiType = apiType;
        // Base URLs for different CoinAPI types
        if (apiType === 'market') {
            this.baseUrl = 'https://rest.coinapi.io/v1';
        }
        else if (apiType === 'flatfile') {
            this.baseUrl = 'https://rest.coinapi.io/v1';
        }
        else {
            this.baseUrl = 'https://rest.coinapi.io/v1';
        }
        this.httpClient = axios_1.default.create({
            baseURL: this.baseUrl,
            timeout: 10000,
            headers: {
                'X-CoinAPI-Key': this.apiKey,
            },
        });
    }
    async getMarketData(symbol) {
        if (this.apiType !== 'market') {
            return {};
        }
        try {
            // Map symbol to CoinAPI format (e.g., BTCUSDT -> BINANCE_SPOT_BTC_USDT)
            const coinapiSymbol = `BINANCE_SPOT_${symbol.replace('USDT', '_USDT')}`;
            const response = await this.httpClient.get(`/quotes/current`, {
                params: {
                    symbol_id: coinapiSymbol,
                },
            });
            const data = response.data?.[0];
            if (!data) {
                return {};
            }
            return {
                price: data.ask_price || data.bid_price || 0,
                volume24h: data.volume_24h || 0,
                priceChange24h: data.price_change_24h || 0,
                priceChangePercent24h: data.price_change_percent_24h || 0,
            };
        }
        catch (error) {
            logger_1.logger.debug({ error, symbol, apiType: this.apiType }, 'CoinAPI market API error (non-critical)');
            return {};
        }
    }
    async getHistoricalData(symbol, days = 7) {
        if (this.apiType !== 'flatfile') {
            return {};
        }
        try {
            const coinapiSymbol = `BINANCE_SPOT_${symbol.replace('USDT', '_USDT')}`;
            const endTime = new Date().toISOString();
            const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
            const response = await this.httpClient.get(`/ohlcv/${coinapiSymbol}/history`, {
                params: {
                    period_id: '1DAY',
                    time_start: startTime,
                    time_end: endTime,
                },
            });
            const historicalData = (response.data || []).map((item) => ({
                time: item.time_period_start,
                price: item.price_close || 0,
            }));
            return {
                historicalData,
            };
        }
        catch (error) {
            logger_1.logger.debug({ error, symbol, apiType: this.apiType }, 'CoinAPI historical API error (non-critical)');
            return {};
        }
    }
    async getExchangeRate(baseAsset, quoteAsset = 'USD') {
        if (this.apiType !== 'exchangerate') {
            return {};
        }
        try {
            const response = await this.httpClient.get(`/exchangerate/${baseAsset}/${quoteAsset}`);
            return {
                exchangeRate: response.data?.rate || 0,
            };
        }
        catch (error) {
            logger_1.logger.debug({ error, baseAsset, quoteAsset, apiType: this.apiType }, 'CoinAPI exchange rate API error (non-critical)');
            return {};
        }
    }
}
exports.CoinAPIAdapter = CoinAPIAdapter;
