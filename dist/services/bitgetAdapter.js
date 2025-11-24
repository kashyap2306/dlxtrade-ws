"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BitgetAdapter = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = require("../utils/logger");
const errors_1 = require("../utils/errors");
const apiUsageTracker_1 = require("./apiUsageTracker");
class BitgetAdapter {
    constructor(apiKey, apiSecret, passphrase, testnet = true) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.passphrase = passphrase;
        this.baseUrl = 'https://api.bitget.com';
        this.httpClient = axios_1.default.create({
            baseURL: this.baseUrl,
            timeout: 10000,
            headers: {
                'ACCESS-KEY': this.apiKey,
                'Content-Type': 'application/json',
            },
        });
    }
    getExchangeName() {
        return 'bitget';
    }
    sign(timestamp, method, requestPath, body = '') {
        const message = timestamp + method + requestPath + body;
        return crypto_1.default
            .createHmac('sha256', this.apiSecret)
            .update(message)
            .digest('base64');
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
            'ACCESS-KEY': this.apiKey,
            'ACCESS-TIMESTAMP': timestamp,
            'ACCESS-PASSPHRASE': this.passphrase,
            'Content-Type': 'application/json',
        };
        if (signed) {
            const signature = this.sign(timestamp, method, endpoint, body);
            headers['ACCESS-SIGN'] = signature;
        }
        try {
            const response = await this.httpClient.request({
                method,
                url: endpoint,
                data: method !== 'GET' ? body : undefined,
                headers,
            });
            // Track API usage
            apiUsageTracker_1.apiUsageTracker.increment('bitget');
            return response.data;
        }
        catch (error) {
            logger_1.logger.error({ error, endpoint, params }, 'Bitget API error');
            throw new errors_1.ExchangeError(error.response?.data?.msg || error.message || 'Bitget API error', error.response?.status || 500);
        }
    }
    async getOrderbook(symbol, limit = 20) {
        const finalSymbol = `${symbol.toUpperCase().replace('-', '')}_SPBL`;
        const safeLimit = Math.min(Math.max(limit || 20, 1), 100);
        const data = await this.request('GET', '/api/spot/v1/market/depth', {
            symbol: finalSymbol,
            limit: safeLimit.toString(),
            type: 'step0',
        });
        const bids = (data.data?.bids || []).map((level) => {
            if (Array.isArray(level)) {
                return { price: level[0], quantity: level[1] };
            }
            return { price: level.price ?? level[0], quantity: level.size ?? level[1] };
        });
        const asks = (data.data?.asks || []).map((level) => {
            if (Array.isArray(level)) {
                return { price: level[0], quantity: level[1] };
            }
            return { price: level.price ?? level[0], quantity: level.size ?? level[1] };
        });
        return {
            symbol: finalSymbol,
            bids,
            asks,
            lastUpdateId: data.data?.ts || Date.now(),
        };
    }
    async getTicker(symbol) {
        if (symbol) {
            const data = await this.request('GET', '/api/mix/v1/market/ticker', {
                symbol: symbol.toUpperCase(),
            });
            return data.data;
        }
        else {
            // Get all tickers - Bitget uses allTicker endpoint
            const data = await this.request('GET', '/api/mix/v1/market/allTicker', {});
            return data.data || [];
        }
    }
    /**
     * Convert timeframe string to Bitget granularity (seconds)
     * 1m → 60, 5m → 300, 15m → 900, 1h → 3600, etc.
     */
    timeframeToGranularity(timeframe) {
        const tf = timeframe.toLowerCase().trim();
        const mapping = {
            '1m': 60,
            '3m': 180,
            '5m': 300,
            '15m': 900,
            '30m': 1800,
            '1h': 3600,
            '2h': 7200,
            '4h': 14400,
            '6h': 21600,
            '8h': 28800,
            '12h': 43200,
            '1d': 86400,
            '3d': 259200,
            '1w': 604800,
            '1M': 2592000,
        };
        if (mapping[tf]) {
            return mapping[tf];
        }
        // Try to parse if it's in format like "5m", "1h"
        const match = tf.match(/^(\d+)([mhdwM])$/);
        if (match) {
            const value = parseInt(match[1]);
            const unit = match[2];
            const multipliers = {
                'm': 60,
                'h': 3600,
                'd': 86400,
                'w': 604800,
                'M': 2592000,
            };
            if (multipliers[unit]) {
                return value * multipliers[unit];
            }
        }
        // Default to 1 minute if unknown
        logger_1.logger.warn({ timeframe }, 'Unknown Bitget timeframe, defaulting to 60 seconds');
        return 60;
    }
    async getKlines(symbol, interval = '1m', limit = 100) {
        const logs = [];
        logs.push('1) BITGET KLINES CALLED');
        logs.push(`2) original timeframe: ${interval}`);
        const periodMap = {
            '1m': '1min',
            '5m': '5min',
            '15m': '15min',
            '30m': '30min',
            '1h': '1h',
            '4h': '4h',
            '1d': '1day',
        };
        const period = periodMap[interval] || '1min';
        logs.push(`3) final period sent: ${period}`);
        // Map symbol for spot: BTCUSDT -> BTCUSDT_SPBL
        const finalSymbol = `${symbol.toUpperCase().replace('-', '')}_SPBL`;
        const safeLimit = Math.min(Math.max(limit || 100, 1), 100);
        const endpoint = '/api/spot/v1/market/candles';
        const finalUrl = `${this.baseUrl}${endpoint}?symbol=${finalSymbol}&period=${period}&limit=${safeLimit}`;
        logs.push(`4) final URL sent: ${finalUrl}`);
        let candles = [];
        try {
            const data = await this.request('GET', endpoint, {
                symbol: finalSymbol,
                period,
                limit: safeLimit.toString(),
            });
            const rawResponse = JSON.stringify(data);
            logs.push(`5) raw response body: ${rawResponse}`);
            if (Array.isArray(data.data)) {
                candles = data.data.map((x) => {
                    if (Array.isArray(x)) {
                        return {
                            timestamp: parseInt(x[0]),
                            open: parseFloat(x[1]),
                            high: parseFloat(x[2]),
                            low: parseFloat(x[3]),
                            close: parseFloat(x[4]),
                            volume: parseFloat(x[5]),
                        };
                    }
                    return {
                        timestamp: parseInt(x.ts ?? x[0]),
                        open: parseFloat(x.open ?? x[1]),
                        high: parseFloat(x.high ?? x[2]),
                        low: parseFloat(x.low ?? x[3]),
                        close: parseFloat(x.close ?? x[4]),
                        volume: parseFloat(x.baseVol ?? x.volume ?? x[5] ?? '0'),
                    };
                });
            }
            logs.push(`7) candles.length after parsing: ${candles.length}`);
            return candles;
        }
        catch (error) {
            logs.push(`6) error (if any): ${error && error.message ? error.message : String(error)}`);
            throw error;
        }
        finally {
            // Only these 7 logs!
            console.log(logs.join('\n'));
        }
    }
    async testConnection() {
        try {
            // Test with account info endpoint
            const response = await this.request('GET', '/api/mix/v1/account/accounts', {}, true);
            if (response.code === '00000' || response.data) {
                return { success: true, message: 'Connection successful' };
            }
            return { success: false, message: response.msg || 'Connection test failed' };
        }
        catch (error) {
            const message = error.message || 'Connection test failed';
            if (message.includes('401') || message.includes('Unauthorized')) {
                return { success: false, message: 'Invalid API key or secret' };
            }
            if (message.includes('passphrase')) {
                return { success: false, message: 'Invalid passphrase' };
            }
            return { success: false, message };
        }
    }
    async getAccount() {
        try {
            return await this.request('GET', '/api/mix/v1/account/accounts', {}, true);
        }
        catch (error) {
            logger_1.logger.error({ error }, 'Error getting Bitget account');
            return { error: error.message || 'Failed to get account' };
        }
    }
    async getBalance() {
        try {
            const data = await this.request('GET', '/api/mix/v1/account/accounts', { productType: 'UMCBL' }, true);
            return data.data || data;
        }
        catch (error) {
            logger_1.logger.error({ error }, 'Error getting Bitget balance');
            throw error;
        }
    }
    async getPositions(symbol) {
        try {
            const params = { productType: 'UMCBL' };
            if (symbol) {
                params.symbol = `${symbol.toUpperCase().replace('-', '')}_UMCBL`;
            }
            const data = await this.request('GET', '/api/mix/v1/position/list', params, true);
            return data.data || [];
        }
        catch (error) {
            logger_1.logger.error({ error }, 'Error getting Bitget positions');
            throw error;
        }
    }
    /**
     * Get funding rate for futures symbol
     */
    async getDerivativesSnapshot(symbol) {
        const futuresSymbol = `${symbol.toUpperCase().replace('-', '')}_UMCBL`;
        const retryDelays = [200, 600, 1200];
        const errorId = crypto_1.default.randomBytes(4).toString('hex');
        const fetchEndpoint = async (endpoint, params) => {
            try {
                return await this.request('GET', endpoint, params);
            }
            catch (error) {
                error.endpoint = endpoint;
                throw error;
            }
        };
        for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
            if (attempt > 0) {
                await this.sleep(retryDelays[attempt - 1]);
            }
            try {
                const now = Date.now();
                const startTime = now - 24 * 60 * 60 * 1000;
                const [fundingRaw, oiRaw, liqRaw] = await Promise.all([
                    fetchEndpoint('/api/mix/v1/market/current-fundRate', { symbol: futuresSymbol }),
                    fetchEndpoint('/api/mix/v1/market/open-interest', { symbol: futuresSymbol }),
                    fetchEndpoint('/api/mix/v1/market/liquidation', {
                        symbol: futuresSymbol,
                        startTime: startTime.toString(),
                        endTime: now.toString(),
                    }),
                ]);
                const fundingRate = {
                    fundingRate: parseFloat(fundingRaw.data?.fundingRate || '0'),
                    nextFundingTime: fundingRaw.data?.nextSettleTime ? parseInt(fundingRaw.data.nextSettleTime) : undefined,
                };
                const oiAmount = parseFloat(oiRaw.data?.amount || '0');
                const oiPrice = parseFloat(oiRaw.data?.price || '0');
                const openInterest = {
                    openInterest: Number.isFinite(oiAmount) ? oiAmount : 0,
                    openInterestValue: Number.isFinite(oiAmount * oiPrice) ? oiAmount * oiPrice : 0,
                };
                let longLiq = 0;
                let shortLiq = 0;
                if (Array.isArray(liqRaw.data)) {
                    liqRaw.data.forEach((liq) => {
                        const qty = parseFloat(liq.size || '0');
                        const price = parseFloat(liq.price || '0');
                        const value = (Number.isFinite(qty) ? qty : 0) * (Number.isFinite(price) ? price : 0);
                        if (liq.side === 'sell') {
                            longLiq += value;
                        }
                        else if (liq.side === 'buy') {
                            shortLiq += value;
                        }
                    });
                }
                const liquidationData = {
                    longLiquidation24h: longLiq,
                    shortLiquidation24h: shortLiq,
                    totalLiquidation24h: longLiq + shortLiq,
                };
                return {
                    available: true,
                    fundingRate,
                    openInterest,
                    liquidationData,
                };
            }
            catch (error) {
                const status = error?.statusCode || error?.response?.status;
                const context = {
                    symbol: futuresSymbol,
                    errorId,
                    attempt: attempt + 1,
                    status,
                    endpoint: error?.endpoint,
                };
                if (status === 404) {
                    logger_1.logger.warn(context, 'Bitget derivatives data unavailable (404)');
                    return { available: false, errorId };
                }
                logger_1.logger.error({ ...context, message: error?.message }, 'Bitget derivatives snapshot fetch failed');
                if (attempt === retryDelays.length) {
                    return { available: false, errorId };
                }
            }
        }
        return { available: false, errorId };
    }
    async getFundingRate(symbol) {
        try {
            const futuresSymbol = `${symbol.toUpperCase().replace('-', '')}_UMCBL`;
            const data = await this.request('GET', '/api/mix/v1/market/current-fundRate', {
                symbol: futuresSymbol,
            });
            return {
                fundingRate: parseFloat(data.data?.fundingRate || '0'),
                nextFundingTime: data.data?.nextSettleTime ? parseInt(data.data.nextSettleTime) : undefined,
            };
        }
        catch (error) {
            logger_1.logger.debug({ error, symbol }, 'Bitget funding rate fetch failed (non-critical)');
            return null;
        }
    }
    /**
     * Get open interest for futures symbol
     */
    async getOpenInterest(symbol) {
        try {
            const futuresSymbol = `${symbol.toUpperCase().replace('-', '')}_UMCBL`;
            const data = await this.request('GET', '/api/mix/v1/market/open-interest', {
                symbol: futuresSymbol,
            });
            return {
                openInterest: parseFloat(data.data?.amount || '0'),
                openInterestValue: parseFloat(data.data?.amount || '0') * parseFloat(data.data?.price || '0'),
            };
        }
        catch (error) {
            logger_1.logger.debug({ error, symbol }, 'Bitget open interest fetch failed (non-critical)');
            return null;
        }
    }
    /**
     * Get liquidations for futures symbol (24h)
     */
    async getLiquidations(symbol, since) {
        try {
            const futuresSymbol = `${symbol.toUpperCase().replace('-', '')}_UMCBL`;
            const endTime = since ? since + (24 * 60 * 60 * 1000) : Date.now();
            const startTime = since || (Date.now() - 24 * 60 * 60 * 1000);
            const data = await this.request('GET', '/api/mix/v1/market/liquidation', {
                symbol: futuresSymbol,
                startTime: startTime.toString(),
                endTime: endTime.toString(),
            });
            let longLiq = 0;
            let shortLiq = 0;
            if (data.data && Array.isArray(data.data)) {
                data.data.forEach((liq) => {
                    const qty = parseFloat(liq.size || '0');
                    const price = parseFloat(liq.price || '0');
                    const value = qty * price;
                    if (liq.side === 'sell') {
                        longLiq += value;
                    }
                    else if (liq.side === 'buy') {
                        shortLiq += value;
                    }
                });
            }
            return {
                longLiquidation24h: longLiq,
                shortLiquidation24h: shortLiq,
                totalLiquidation24h: longLiq + shortLiq,
            };
        }
        catch (error) {
            logger_1.logger.debug({ error, symbol }, 'Bitget liquidations fetch failed (non-critical)');
            return null;
        }
    }
    async placeOrder(params) {
        try {
            const { symbol, side, type = 'MARKET', quantity, price } = params;
            const orderParams = {
                symbol: symbol.toUpperCase(),
                side,
                orderType: type,
                size: quantity.toString(),
            };
            if (type === 'LIMIT' && price) {
                orderParams.price = price.toString();
            }
            const response = await this.request('POST', '/api/mix/v1/order/placeOrder', orderParams, true);
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
            logger_1.logger.error({ error }, 'Error placing Bitget order');
            throw error;
        }
    }
    async sleep(ms) {
        if (ms <= 0) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, ms));
    }
}
exports.BitgetAdapter = BitgetAdapter;
