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
        this.httpClient = null;
        this.disabled = false;
        // Validate API key - throw clear error if missing
        if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '' || apiKey === 'undefined' || apiKey === 'null') {
            this.disabled = true;
            this.apiKey = '';
            const errorMsg = 'CryptoQuant API key missing or invalid';
            logger_1.logger.error({ apiKeyProvided: !!apiKey, apiKeyType: typeof apiKey }, errorMsg);
            throw new Error(errorMsg);
        }
        this.apiKey = apiKey.trim();
        // Log API key status (for testing - shows if key is loaded, not the actual key)
        logger_1.logger.info({ apiKeyLoaded: true, apiKeyLength: this.apiKey.length }, 'CryptoQuant API key loaded');
        this.httpClient = axios_1.default.create({
            baseURL: this.baseUrl,
            timeout: 10000,
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
            },
        });
        logger_1.logger.debug({ baseUrl: this.baseUrl, hasAuthHeader: true }, 'CryptoQuant HTTP client initialized');
    }
    async getExchangeFlow(symbol) {
        // Skip if disabled
        if (this.disabled || !this.httpClient) {
            logger_1.logger.warn('CryptoQuant adapter is disabled - cannot fetch exchange flow');
            return {};
        }
        // Verify API key is still valid before making request
        if (!this.apiKey || this.apiKey.trim() === '') {
            logger_1.logger.error('CryptoQuant API key is missing during getExchangeFlow call');
            throw new Error('CryptoQuant API key missing');
        }
        try {
            const url = '/exchange-flow';
            logger_1.logger.debug({ url, symbol, hasApiKey: !!this.apiKey }, 'CryptoQuant getExchangeFlow request');
            const response = await this.httpClient.get(url, {
                params: {
                    market: symbol,
                    window: '1d',
                },
            });
            logger_1.logger.debug({ status: response.status, symbol }, 'CryptoQuant getExchangeFlow success');
            return {
                exchangeFlow: response.data?.net_flow || 0,
                exchangeInflow: response.data?.inflow || 0,
                exchangeOutflow: response.data?.outflow || 0,
            };
        }
        catch (error) {
            const status = error.response?.status;
            const statusText = error.response?.statusText;
            const errorMessage = error.response?.data?.message || error.message;
            // Log 401 errors with details
            if (status === 401) {
                logger_1.logger.error({
                    status,
                    statusText,
                    errorMessage,
                    symbol,
                    hasApiKey: !!this.apiKey,
                    apiKeyLength: this.apiKey?.length || 0,
                }, 'CryptoQuant 401 Unauthorized - Token does not exist or is invalid');
                throw new Error(`CryptoQuant API authentication failed: ${errorMessage || 'Token does not exist'}`);
            }
            logger_1.logger.error({ error: errorMessage, status, symbol }, 'CryptoQuant API error');
            throw error;
        }
    }
    async getOnChainMetrics(symbol) {
        // Skip if disabled
        if (this.disabled || !this.httpClient) {
            logger_1.logger.warn('CryptoQuant adapter is disabled - cannot fetch on-chain metrics');
            return {};
        }
        // Verify API key is still valid before making request
        if (!this.apiKey || this.apiKey.trim() === '') {
            logger_1.logger.error('CryptoQuant API key is missing during getOnChainMetrics call');
            throw new Error('CryptoQuant API key missing');
        }
        try {
            const url = '/on-chain-metrics';
            logger_1.logger.debug({ url, symbol, hasApiKey: !!this.apiKey }, 'CryptoQuant getOnChainMetrics request');
            const response = await this.httpClient.get(url, {
                params: {
                    market: symbol,
                },
            });
            logger_1.logger.debug({ status: response.status, symbol }, 'CryptoQuant getOnChainMetrics success');
            return {
                whaleTransactions: response.data?.whale_transactions || 0,
                activeAddresses: response.data?.active_addresses || 0,
            };
        }
        catch (error) {
            const status = error.response?.status;
            const statusText = error.response?.statusText;
            const errorMessage = error.response?.data?.message || error.message;
            // Log 401 errors with details
            if (status === 401) {
                logger_1.logger.error({
                    status,
                    statusText,
                    errorMessage,
                    symbol,
                    hasApiKey: !!this.apiKey,
                    apiKeyLength: this.apiKey?.length || 0,
                }, 'CryptoQuant 401 Unauthorized - Token does not exist or is invalid');
                throw new Error(`CryptoQuant API authentication failed: ${errorMessage || 'Token does not exist'}`);
            }
            logger_1.logger.error({ error: errorMessage, status, symbol }, 'CryptoQuant on-chain API error');
            throw error;
        }
    }
}
exports.CryptoQuantAdapter = CryptoQuantAdapter;
