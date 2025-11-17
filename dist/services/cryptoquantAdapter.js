"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CryptoQuantAdapter = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
class CryptoQuantAdapter {
    constructor(apiKey) {
        this.baseUrl = 'https://api.cryptoquant.com/v1';
        this.apiKey = apiKey;
        this.httpClient = axios_1.default.create({
            baseURL: this.baseUrl,
            timeout: 10000,
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
            },
        });
    }
    async getExchangeFlow(symbol) {
        try {
            // Example endpoint - adjust based on actual CryptoQuant API
            const response = await this.httpClient.get('/exchange-flow', {
                params: {
                    market: symbol,
                    window: '1d',
                },
            });
            return {
                exchangeFlow: response.data?.net_flow || 0,
                exchangeInflow: response.data?.inflow || 0,
                exchangeOutflow: response.data?.outflow || 0,
            };
        }
        catch (error) {
            logger_1.logger.debug({ error, symbol }, 'CryptoQuant API error (non-critical)');
            // Return empty data on error - don't block research
            return {};
        }
    }
    async getOnChainMetrics(symbol) {
        try {
            // Example endpoint - adjust based on actual CryptoQuant API
            const response = await this.httpClient.get('/on-chain-metrics', {
                params: {
                    market: symbol,
                },
            });
            return {
                whaleTransactions: response.data?.whale_transactions || 0,
                activeAddresses: response.data?.active_addresses || 0,
            };
        }
        catch (error) {
            logger_1.logger.debug({ error, symbol }, 'CryptoQuant on-chain API error (non-critical)');
            return {};
        }
    }
}
exports.CryptoQuantAdapter = CryptoQuantAdapter;
