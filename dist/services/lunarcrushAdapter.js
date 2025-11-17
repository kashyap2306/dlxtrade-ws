"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LunarCrushAdapter = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
class LunarCrushAdapter {
    constructor(apiKey) {
        this.baseUrl = 'https://api.lunarcrush.com/v2';
        this.apiKey = apiKey;
        this.httpClient = axios_1.default.create({
            baseURL: this.baseUrl,
            timeout: 10000,
            params: {
                key: this.apiKey,
            },
        });
    }
    async getCoinData(symbol) {
        try {
            // Map symbol to LunarCrush format (e.g., BTCUSDT -> BTC)
            const coinSymbol = symbol.replace('USDT', '').replace('USD', '');
            const response = await this.httpClient.get('/assets/coin', {
                params: {
                    symbol: coinSymbol,
                    data_points: 1,
                },
            });
            const data = response.data?.data?.[0];
            if (!data) {
                return {};
            }
            return {
                socialScore: data.social_score || 0,
                socialVolume: data.social_volume || 0,
                marketCapRank: data.market_cap_rank || 0,
                altRank: data.alt_rank || 0,
                sentiment: data.sentiment || 0,
                bullishSentiment: data.bullish_sentiment || 0,
            };
        }
        catch (error) {
            logger_1.logger.debug({ error, symbol }, 'LunarCrush API error (non-critical)');
            // Return empty data on error - don't block research
            return {};
        }
    }
}
exports.LunarCrushAdapter = LunarCrushAdapter;
