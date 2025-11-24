"use strict";
/**
 * IntoTheBlock Data Connector
 * Fetches on-chain metrics including whale movements and large transactions
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntoTheBlockConnector = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../../utils/logger");
const apiUsageTracker_1 = require("../apiUsageTracker");
class IntoTheBlockConnector {
    constructor(apiKey) {
        this.baseUrl = 'https://api.intotheblock.com';
        this.apiKey = apiKey;
        this.httpClient = axios_1.default.create({
            baseURL: this.baseUrl,
            timeout: 10000,
            headers: this.apiKey ? {
                'X-API-Key': this.apiKey,
            } : {},
        });
    }
    /**
     * Get large transactions (whale movements)
     */
    async getLargeTransactions(symbol) {
        try {
            // Map symbol to coin identifier (BTCUSDT -> BTC)
            const coinId = symbol.replace('USDT', '').replace('USD', '').toLowerCase();
            // Note: IntoTheBlock API structure may vary - this is a template
            const response = await this.httpClient.get(`/coins/${coinId}/transactions/large`, {
                params: {
                    timeFrame: '24h',
                },
            });
            apiUsageTracker_1.apiUsageTracker.increment('intotheblock');
            const data = response.data?.data;
            if (!data) {
                return {};
            }
            return {
                largeTransactions: data.count || 0,
                whaleMovements: data.whaleCount || 0,
                timestamp: Date.now(),
            };
        }
        catch (error) {
            logger_1.logger.warn({ error: error.message, symbol }, 'IntoTheBlock large transactions fetch failed');
            return {};
        }
    }
    /**
     * Get exchange flows
     */
    async getExchangeFlows(symbol) {
        try {
            const coinId = symbol.replace('USDT', '').replace('USD', '').toLowerCase();
            const response = await this.httpClient.get(`/coins/${coinId}/flows/exchange`, {
                params: {
                    timeFrame: '24h',
                },
            });
            apiUsageTracker_1.apiUsageTracker.increment('intotheblock');
            const data = response.data?.data;
            if (!data) {
                return {};
            }
            return {
                exchangeInflow: data.inflow ? parseFloat(data.inflow) : undefined,
                exchangeOutflow: data.outflow ? parseFloat(data.outflow) : undefined,
                netFlow: data.netFlow ? parseFloat(data.netFlow) : undefined,
                timestamp: Date.now(),
            };
        }
        catch (error) {
            logger_1.logger.warn({ error: error.message, symbol }, 'IntoTheBlock exchange flows fetch failed');
            return {};
        }
    }
    /**
     * Get all on-chain data
     */
    async getAllOnChainData(symbol) {
        try {
            const [transactions, flows] = await Promise.allSettled([
                this.getLargeTransactions(symbol),
                this.getExchangeFlows(symbol),
            ]);
            return {
                ...(transactions.status === 'fulfilled' ? transactions.value : {}),
                ...(flows.status === 'fulfilled' ? flows.value : {}),
                timestamp: Date.now(),
            };
        }
        catch (error) {
            logger_1.logger.error({ error: error.message, symbol }, 'IntoTheBlock all data fetch failed');
            return {};
        }
    }
}
exports.IntoTheBlockConnector = IntoTheBlockConnector;
