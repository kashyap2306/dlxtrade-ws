"use strict";
/**
 * CoinGlass Data Connector
 * Fetches funding rates, open interest, and liquidation data
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoinGlassConnector = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../../utils/logger");
const apiUsageTracker_1 = require("../apiUsageTracker");
class CoinGlassConnector {
    constructor(apiKey) {
        this.baseUrl = 'https://open-api.coinglass.com/public/v2';
        this.apiKey = apiKey;
        this.httpClient = axios_1.default.create({
            baseURL: this.baseUrl,
            timeout: 10000,
            headers: this.apiKey ? {
                'coinglassSecret': this.apiKey,
            } : {},
        });
    }
    /**
     * Get funding rate for a symbol
     */
    async getFundingRate(symbol) {
        try {
            // Map symbol format (BTCUSDT -> BTC)
            const baseSymbol = symbol.replace('USDT', '').replace('USD', '');
            const response = await this.httpClient.get('/funding-rate', {
                params: {
                    symbol: baseSymbol,
                    type: 'futures',
                },
            });
            apiUsageTracker_1.apiUsageTracker.increment('coinglass');
            const data = response.data?.data?.[0];
            if (!data) {
                return {};
            }
            return {
                fundingRate: data.fundingRate ? parseFloat(data.fundingRate) : undefined,
                openInterest: data.openInterest ? parseFloat(data.openInterest) : undefined,
                openInterestChange24h: data.openInterestChange24h ? parseFloat(data.openInterestChange24h) : undefined,
                timestamp: Date.now(),
            };
        }
        catch (error) {
            logger_1.logger.warn({ error: error.message, symbol }, 'CoinGlass funding rate fetch failed');
            return {};
        }
    }
    /**
     * Get liquidation data
     */
    async getLiquidations(symbol) {
        try {
            const baseSymbol = symbol.replace('USDT', '').replace('USD', '');
            const response = await this.httpClient.get('/liquidation', {
                params: {
                    symbol: baseSymbol,
                    timeType: '24h',
                },
            });
            apiUsageTracker_1.apiUsageTracker.increment('coinglass');
            const data = response.data?.data;
            if (!data) {
                return {};
            }
            return {
                liquidation24h: data.totalLiquidation ? parseFloat(data.totalLiquidation) : undefined,
                longLiquidation24h: data.longLiquidation ? parseFloat(data.longLiquidation) : undefined,
                shortLiquidation24h: data.shortLiquidation ? parseFloat(data.shortLiquidation) : undefined,
                timestamp: Date.now(),
            };
        }
        catch (error) {
            logger_1.logger.warn({ error: error.message, symbol }, 'CoinGlass liquidation fetch failed');
            return {};
        }
    }
    /**
     * Get open interest data
     */
    async getOpenInterest(symbol) {
        try {
            const baseSymbol = symbol.replace('USDT', '').replace('USD', '');
            const response = await this.httpClient.get('/open-interest', {
                params: {
                    symbol: baseSymbol,
                },
            });
            apiUsageTracker_1.apiUsageTracker.increment('coinglass');
            const data = response.data?.data?.[0];
            if (!data) {
                return {};
            }
            return {
                openInterest: data.openInterest ? parseFloat(data.openInterest) : undefined,
                openInterestChange24h: data.change24h ? parseFloat(data.change24h) : undefined,
                timestamp: Date.now(),
            };
        }
        catch (error) {
            logger_1.logger.warn({ error: error.message, symbol }, 'CoinGlass open interest fetch failed');
            return {};
        }
    }
    /**
     * Get all derivatives data
     */
    async getAllDerivativesData(symbol) {
        try {
            const [funding, liquidations, oi] = await Promise.allSettled([
                this.getFundingRate(symbol),
                this.getLiquidations(symbol),
                this.getOpenInterest(symbol),
            ]);
            return {
                ...(funding.status === 'fulfilled' ? funding.value : {}),
                ...(liquidations.status === 'fulfilled' ? liquidations.value : {}),
                ...(oi.status === 'fulfilled' ? oi.value : {}),
                timestamp: Date.now(),
            };
        }
        catch (error) {
            logger_1.logger.error({ error: error.message, symbol }, 'CoinGlass all data fetch failed');
            return {};
        }
    }
}
exports.CoinGlassConnector = CoinGlassConnector;
